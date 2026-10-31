// bb-plugin-system-messages-tab - frontend entry.
//
// BB's thread outline (the rail on the right of a thread, which opens a
// popover with "Agent messages" and "Your messages" tabs) lists BB's own
// "[bb system] ..." notices and messages from other agent threads under
// "Your messages", because BB delivers both to the agent as user turns. This
// plugin adds a third "System messages" tab that holds them and hides them
// from "Your messages".
//
// The Plugin SDK has no slot for the outline, so a content script works on
// the rendered popover: it appends one button to the tab row, hides list
// entries with an attribute, and repaints the "Your messages" button while
// "System messages" is selected. BB keeps owning its own tab state; the tab
// rides on top of BB's "Your messages" list, which already holds every entry
// this plugin sorts. Disposal removes every node, attribute, class change,
// listener and style the plugin added.
//
// A BB update can change the outline's markup. The plugin then finds nothing
// to change and the outline keeps working as BB ships it.
//
// Each entry's id and full text come from React's props for the entry,
// because the outline replaces a thread message's "[bb message from
// thread:...]" header with a sender chip; the rendered text is the fallback.
//
// The plugin also puts a date-and-time line above every outline entry, in
// all three tabs, and replaces the "Agent" chip BB shows for sender threads
// it has not loaded with the thread's real title. The outline carries
// neither, so the backend (server.ts) reads them from the thread's event log;
// a small app-wide overlay hands its RPC client to the content script.
import { useEffect } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import { isSystemLabel, isVisible, type Tab } from "./lib/classify";
import { formatLabel, senderThreadOf, timeKeyOf } from "./lib/format";

const TOC_SELECTOR = "[data-thread-toc]";
const PANEL_SELECTOR = '[id^="thread-toc-panel-"]';
const USER_TAB_LABEL = "Your messages";
const SYSTEM_TAB_LABEL = "System messages";
const MAX_FIBER_DEPTH = 6;

const TAB_ATTR = "data-smt-tab";
const HIDDEN_ATTR = "data-smt-hidden";
const PAINTED_ATTR = "data-smt-painted";
const TIME_ATTR = "data-smt-time";
const CHIP_ATTR = "data-smt-chip";
const FALLBACK_SENDER = "Agent";
const REFETCH_MS = 5_000;
const REFRESH_MS = 60_000;
const STYLE_ID = "bb-plugin-system-messages-tab-style";

// The classes BB's own outline tab button uses, so the added tab matches it.
const TAB_BASE =
  "flex h-7 flex-1 cursor-pointer items-center justify-center rounded-md text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const TAB_ACTIVE = ["bg-state-hover", "text-foreground"];
const TAB_INACTIVE = ["text-muted-foreground", "hover:bg-state-hover"];

// BB sizes the popover for two tabs. With a third, widen it so all three
// labels fit on one line.
const STYLE = `
[${HIDDEN_ATTR}] { display: none !important; }
${PANEL_SELECTOR}:has(button[${TAB_ATTR}]) { width: 24rem; }
${PANEL_SELECTOR}:has(button[${TAB_ATTR}]) > * > :first-child > button { white-space: nowrap; padding: 0 8px; }
button[${TIME_ATTR}] { flex-direction: column; align-items: stretch; }
button[${TIME_ATTR}]::before {
  content: attr(${TIME_ATTR});
  display: block;
  margin-bottom: 2px;
  font-size: 10px;
  line-height: 14px;
  font-variant-numeric: tabular-nums;
  color: var(--muted-foreground, #888);
  opacity: 0.8;
  white-space: nowrap;
  pointer-events: none;
  user-select: none;
}
`;

type OutlineMeta = {
  userTimes: Record<string, number>;
  itemTimes: Record<string, number>;
  senderTitles: Record<string, string>;
};
type FetchMeta = (threadId: string) => Promise<OutlineMeta>;

// The content script has no React context, so the overlay below hands it the
// plugin's RPC client through this variable.
let fetchMeta: FetchMeta | null = null;
const bridgeListeners = new Set<() => void>();

function RpcBridge() {
  const rpc = useRpc<typeof rpcContract>();
  useEffect(() => {
    fetchMeta = (threadId) => rpc.call("outline_meta", { threadId });
    for (const listener of bridgeListeners) listener();
    return () => {
      fetchMeta = null;
    };
  }, [rpc]);
  return null;
}

type Fiber = { memoizedProps?: unknown; return?: Fiber | null };

function fiberOf(element: Element): Fiber | null {
  for (const key of Object.keys(element)) {
    if (key.startsWith("__reactFiber$")) {
      return (element as unknown as Record<string, Fiber>)[key] ?? null;
    }
  }
  return null;
}

type Entry = { id: string | null; label: string };

/** The entry's id and full outline label, from the component that renders it. */
function readEntry(item: Element): Entry | null {
  const inner = item.querySelector("button span span") ?? item.querySelector("button span");
  let fiber = inner ? fiberOf(inner) : null;
  for (let depth = 0; fiber && depth < MAX_FIBER_DEPTH; depth++) {
    const props = fiber.memoizedProps;
    if (props && typeof props === "object" && "item" in props) {
      const entry = (props as { item?: { id?: unknown; label?: unknown } }).item;
      if (typeof entry?.label === "string") {
        return { id: typeof entry.id === "string" ? entry.id : null, label: entry.label };
      }
    }
    fiber = fiber.return ?? null;
  }
  return null;
}

type Parts = {
  tabRow: Element;
  userButton: HTMLButtonElement;
  items: HTMLLIElement[];
};

/** The open outline popover's pieces, or null when it is closed or unfamiliar. */
function findParts(toc: Element): Parts | null {
  const panel = toc.querySelector(PANEL_SELECTOR);
  const card = panel?.firstElementChild;
  const tabRow = card?.firstElementChild;
  if (!tabRow) return null;
  const userButton = Array.from(tabRow.querySelectorAll("button")).find(
    (button) => !button.hasAttribute(TAB_ATTR) && button.textContent?.trim() === USER_TAB_LABEL,
  );
  if (!userButton) return null;
  const list = card.querySelector("ul");
  const items = list ? Array.from(list.children).filter((child) => child instanceof HTMLLIElement) : [];
  return { tabRow, userButton, items };
}

function paint(button: HTMLElement, active: boolean) {
  const add = active ? TAB_ACTIVE : TAB_INACTIVE;
  const remove = active ? TAB_INACTIVE : TAB_ACTIVE;
  if (remove.some((name) => button.classList.contains(name))) button.classList.remove(...remove);
  if (add.some((name) => !button.classList.contains(name))) button.classList.add(...add);
}

function makeSystemButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute(TAB_ATTR, "");
  button.className = TAB_BASE;
  button.textContent = SYSTEM_TAB_LABEL;
  return button;
}

/** The text node holding "Agent" in an entry's sender chip, if it shows that. */
function fallbackChipText(item: Element): Text | null {
  const chip = item.querySelector("button > span > span")?.firstElementChild;
  if (!chip || chip.textContent?.trim() !== FALLBACK_SENDER) return null;
  const walker = document.createTreeWalker(chip, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeValue?.trim() === FALLBACK_SENDER) return node as Text;
  }
  return null;
}

function setAttr(element: Element, name: string, value: string | null) {
  if (value === null) {
    if (element.hasAttribute(name)) element.removeAttribute(name);
  } else if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

function mountSystemTab(signal: AbortSignal): () => void {
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.appendChild(style);

  // Per outline: the selected tab while BB shows "Your messages", and whether
  // the thread has any system notice. The outline element lives as long as
  // the thread view, so both survive the popover closing and reopening.
  const tabs = new WeakMap<Element, Tab>();
  const hasSystem = new WeakMap<Element, boolean>();
  // An entry element keeps its id and label for life; read React's tree once
  // per entry.
  const entries = new WeakMap<Element, Entry>();
  // Event-log times and sender titles per thread, and when each was fetched.
  const metas = new Map<string, { meta: OutlineMeta | null; fetchedAt: number; pending: boolean }>();
  // Chip text nodes this plugin renamed, with BB's original text.
  const renamed = new Map<Text, string>();
  let frame = 0;
  let forwarding = false;

  /** Cached metadata for a thread; fetches it when missing, stale or incomplete. */
  const metaFor = (threadId: string, missing: boolean): OutlineMeta | null => {
    const state = metas.get(threadId);
    const due = !state || (missing && Date.now() - state.fetchedAt > REFETCH_MS);
    if (due && !state?.pending && fetchMeta) {
      const next = { meta: state?.meta ?? null, fetchedAt: Date.now(), pending: true };
      metas.set(threadId, next);
      fetchMeta(threadId).then(
        (meta) => {
          next.meta = meta;
          next.pending = false;
          next.fetchedAt = Date.now();
          schedule();
        },
        () => {
          next.pending = false;
          next.fetchedAt = Date.now();
        },
      );
    }
    return state?.meta ?? null;
  };

  /** Time line above each entry, and real titles on "Agent" sender chips. */
  const decorate = (toc: Element, items: HTMLLIElement[]) => {
    const threadId = toc.querySelector(PANEL_SELECTOR)?.id.slice("thread-toc-panel-".length);
    if (!threadId || items.length === 0) return;
    const now = new Date();
    let missing = false;
    const meta = metas.get(threadId)?.meta ?? null;
    for (const item of items) {
      const entry = entries.get(item);
      const button = item.querySelector("button");
      if (!entry || !button) continue;
      const key = entry.id ? timeKeyOf(entry.id) : null;
      const ms = !key || !meta ? undefined : key.kind === "user" ? meta.userTimes[key.seq] : meta.itemTimes[key.itemId];
      if (key && ms === undefined) missing = true;
      setAttr(button, TIME_ATTR, ms === undefined ? null : formatLabel(ms, now));

      const sender = senderThreadOf(entry.label);
      const title = sender ? meta?.senderTitles[sender] : undefined;
      const text = title ? fallbackChipText(item) : null;
      if (text && title) {
        if (renamed.size > 500) {
          for (const node of renamed.keys()) if (!node.isConnected) renamed.delete(node);
        }
        renamed.set(text, text.nodeValue ?? FALLBACK_SENDER);
        text.nodeValue = title;
        setAttr(text.parentElement ?? item, CHIP_ATTR, "");
      }
    }
    metaFor(threadId, missing);
  };

  const scan = () => {
    frame = 0;
    if (signal.aborted) return;
    for (const toc of document.querySelectorAll(TOC_SELECTOR)) {
      const parts = findParts(toc);
      if (!parts) continue;
      const { tabRow, userButton, items } = parts;
      const showingUser = userButton.getAttribute("aria-pressed") === "true";
      const tab = tabs.get(toc) ?? "user";

      let systemCount = 0;
      for (const item of items) {
        let entry = entries.get(item);
        if (entry === undefined) {
          entry = readEntry(item) ?? { id: null, label: item.textContent ?? "" };
          entries.set(item, entry);
        }
        const system = isSystemLabel(entry.label);
        if (system) systemCount += 1;
        const hide = showingUser && !isVisible(tab, system);
        if (hide !== item.hasAttribute(HIDDEN_ATTR)) item.toggleAttribute(HIDDEN_ATTR, hide);
      }
      // Only the "Your messages" list can tell; keep the last answer otherwise.
      if (showingUser) hasSystem.set(toc, systemCount > 0);
      decorate(toc, items);

      let systemButton = tabRow.querySelector<HTMLButtonElement>(`button[${TAB_ATTR}]`);
      const wantButton = hasSystem.get(toc) === true || tab === "system";
      if (!wantButton) {
        systemButton?.remove();
        if (userButton.hasAttribute(PAINTED_ATTR)) {
          userButton.removeAttribute(PAINTED_ATTR);
          paint(userButton, showingUser);
        }
        continue;
      }
      if (!systemButton) {
        systemButton = makeSystemButton();
        tabRow.appendChild(systemButton);
      }
      const systemActive = showingUser && tab === "system";
      paint(systemButton, systemActive);
      if (systemButton.getAttribute("aria-pressed") !== String(systemActive)) {
        systemButton.setAttribute("aria-pressed", String(systemActive));
      }
      if (showingUser) {
        // BB still considers "Your messages" selected; show it as unselected
        // while "System messages" is the tab in view.
        paint(userButton, tab === "user");
        if (!userButton.hasAttribute(PAINTED_ATTR)) userButton.setAttribute(PAINTED_ATTR, "");
      }
    }
  };

  const schedule = () => {
    if (frame === 0 && !signal.aborted) frame = requestAnimationFrame(scan);
  };

  // Track which tab the user picks. Capture phase, so this runs before BB's
  // own handlers re-render the popover.
  const onClick = (event: MouseEvent) => {
    if (forwarding || !(event.target instanceof Element)) return;
    const button = event.target.closest("button");
    const toc = button?.closest(TOC_SELECTOR);
    if (!button || !toc) return;
    const parts = findParts(toc);
    if (!parts || button.parentElement !== parts.tabRow) return;
    if (button.hasAttribute(TAB_ATTR)) {
      tabs.set(toc, "system");
      // "System messages" filters BB's "Your messages" list, so switch BB to
      // it first.
      if (parts.userButton.getAttribute("aria-pressed") !== "true") {
        forwarding = true;
        try {
          parts.userButton.click();
        } finally {
          forwarding = false;
        }
      }
    } else {
      // "Your messages", or "Agent messages", after which coming back to
      // "Your messages" should show the user's own messages again.
      tabs.set(toc, "user");
    }
    schedule();
  };

  document.addEventListener("click", onClick, true);
  // Our own writes only touch attributes BB does not watch, and each write
  // happens only on a change, so a scan settles instead of retriggering.
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-pressed"],
  });
  // "Today" becomes "Yesterday" after midnight without any DOM change.
  const refresh = window.setInterval(schedule, REFRESH_MS);
  bridgeListeners.add(schedule);
  schedule();

  return () => {
    observer.disconnect();
    document.removeEventListener("click", onClick, true);
    window.clearInterval(refresh);
    bridgeListeners.delete(schedule);
    for (const button of document.querySelectorAll(`[${TIME_ATTR}]`)) button.removeAttribute(TIME_ATTR);
    for (const [text, original] of renamed) {
      if (text.isConnected) text.nodeValue = original;
    }
    renamed.clear();
    for (const chip of document.querySelectorAll(`[${CHIP_ATTR}]`)) chip.removeAttribute(CHIP_ATTR);
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    for (const button of document.querySelectorAll(`button[${TAB_ATTR}]`)) button.remove();
    for (const item of document.querySelectorAll(`[${HIDDEN_ATTR}]`)) item.removeAttribute(HIDDEN_ATTR);
    for (const button of document.querySelectorAll<HTMLElement>(`[${PAINTED_ATTR}]`)) {
      button.removeAttribute(PAINTED_ATTR);
      paint(button, button.getAttribute("aria-pressed") === "true");
    }
    style.remove();
  };
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "rpc-bridge", component: RpcBridge });
  app.contentScripts.register({
    id: "system-messages-tab",
    mount: ({ signal }) => mountSystemTab(signal),
  });
});
