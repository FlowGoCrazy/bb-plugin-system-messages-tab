// bb-plugin-system-messages-tab - frontend entry.
//
// BB's thread outline (the rail on the right of a thread, which opens a
// popover with "Agent messages" and "Your messages" tabs) lists "[bb system]"
// notices and messages from other agent threads under "Your messages",
// because BB delivers both to the agent as user turns. This plugin:
// - adds a "System messages" tab that holds them and hides them from
//   "Your messages";
// - puts a date-and-time line above every entry, in all three tabs;
// - replaces the "Agent" chip BB shows for sender threads the app has not
//   loaded with the thread's real title.
//
// A content script works on the rendered popover (see lib/outline-dom.ts).
// BB keeps owning its own tab state: the "System messages" tab filters BB's
// "Your messages" list, which already holds every entry this plugin sorts.
// Times and sender titles come from the backend (server.ts), whose RPC client
// a small app-wide overlay hands to the content script. Disposal removes
// every node, attribute, class change, listener and style the plugin added.
import { useEffect } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import type { OutlineMeta, rpcContract } from "./server";
import { isSystemLabel, isVisible, type Tab } from "./lib/classify";
import { formatLabel, senderThreadOf, timeKeyOf } from "./lib/format";
import {
  PANEL_SELECTOR,
  TAB_ATTR,
  TOC_SELECTOR,
  createTab,
  fallbackChipText,
  findParts,
  isPressed,
  paintTab,
  readEntry,
  setAttr,
  type Entry,
  type OutlineParts,
} from "./lib/outline-dom";

const SYSTEM_TAB_LABEL = "System messages";
const HIDDEN_ATTR = "data-smt-hidden";
const PAINTED_ATTR = "data-smt-painted";
const TIME_ATTR = "data-smt-time";
const STYLE_ID = "bb-plugin-system-messages-tab-style";
/** How long to wait before asking again for times of entries still missing one. */
const REFETCH_MS = 5_000;
/** Relabels "Today" as "Yesterday" after midnight without any DOM change. */
const RELABEL_MS = 60_000;
/** Renamed chips to keep before forgetting ones that left the page. */
const RENAMED_PRUNE_SIZE = 500;

// BB sizes the popover for two tabs; with a third, widen it so all three
// labels fit on one line.
const STYLE = `
[${HIDDEN_ATTR}] { display: none !important; }
${PANEL_SELECTOR}:has(button[${TAB_ATTR}]) { width: 24rem; }
${PANEL_SELECTOR}:has(button[${TAB_ATTR}]) > * > :first-child > button {
  white-space: nowrap;
  padding: 0 8px;
}
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

// The content script has no React context, so RpcBridge hands it the plugin's
// RPC client through this variable and wakes it once the client is ready.
type FetchMeta = (threadId: string) => Promise<OutlineMeta>;
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

type MetaState = { meta: OutlineMeta | null; fetchedAt: number; pending: boolean };

function mountOutline(signal: AbortSignal): () => void {
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.appendChild(style);

  // Per outline element, which lives as long as the thread view: the selected
  // tab while BB shows "Your messages", and whether the thread has any system
  // message. Both survive the popover closing and reopening.
  const tabs = new WeakMap<Element, Tab>();
  const hasSystem = new WeakMap<Element, boolean>();
  // An entry element keeps its id and label for life; read React's tree once.
  const entries = new WeakMap<Element, Entry>();
  const metas = new Map<string, MetaState>();
  // Chip text nodes this plugin renamed, with BB's original text.
  const renamed = new Map<Text, string>();
  let frame = 0;
  let forwarding = false;

  const entryOf = (item: Element): Entry => {
    let entry = entries.get(item);
    if (!entry) {
      entry = readEntry(item);
      entries.set(item, entry);
    }
    return entry;
  };

  /** Fetches a thread's times and titles when never fetched, or when some are missing. */
  const requestMeta = (threadId: string, missing: boolean): void => {
    const state = metas.get(threadId);
    if (!fetchMeta || state?.pending) return;
    if (state && !(missing && Date.now() - state.fetchedAt > REFETCH_MS)) return;
    const next: MetaState = { meta: state?.meta ?? null, fetchedAt: Date.now(), pending: true };
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
  };

  /** Hides the entries that belong to the other of "Your messages" and "System messages". */
  const sortEntries = (toc: Element, { items }: OutlineParts, showingUser: boolean): void => {
    const tab = tabs.get(toc) ?? "user";
    let systemCount = 0;
    for (const item of items) {
      const system = isSystemLabel(entryOf(item).label);
      if (system) systemCount += 1;
      setAttr(item, HIDDEN_ATTR, showingUser && !isVisible(tab, system) ? "" : null);
    }
    // Only the "Your messages" list can tell; keep the last answer otherwise.
    if (showingUser) hasSystem.set(toc, systemCount > 0);
  };

  /** Adds, removes and paints the "System messages" tab. */
  const syncTabs = (toc: Element, parts: OutlineParts, showingUser: boolean): void => {
    const { tabRow, userButton } = parts;
    const tab = tabs.get(toc) ?? "user";
    let systemButton = tabRow.querySelector<HTMLButtonElement>(`button[${TAB_ATTR}]`);
    if (!hasSystem.get(toc) && tab !== "system") {
      systemButton?.remove();
      if (userButton.hasAttribute(PAINTED_ATTR)) {
        userButton.removeAttribute(PAINTED_ATTR);
        paintTab(userButton, showingUser);
      }
      return;
    }
    if (!systemButton) {
      systemButton = createTab(SYSTEM_TAB_LABEL);
      tabRow.appendChild(systemButton);
    }
    const systemActive = showingUser && tab === "system";
    paintTab(systemButton, systemActive);
    setAttr(systemButton, "aria-pressed", String(systemActive));
    if (showingUser) {
      // BB still considers "Your messages" selected; show it as unselected
      // while "System messages" is the tab in view.
      paintTab(userButton, tab === "user");
      setAttr(userButton, PAINTED_ATTR, "");
    }
  };

  /** Time line above each entry, and real titles on "Agent" sender chips. */
  const decorate = ({ threadId, items }: OutlineParts): void => {
    if (items.length === 0) return;
    const meta = metas.get(threadId)?.meta ?? null;
    const now = new Date();
    let missing = false;
    for (const item of items) {
      const button = item.querySelector("button");
      if (!button) continue;
      const entry = entryOf(item);
      const key = entry.id ? timeKeyOf(entry.id) : null;
      let ms: number | undefined;
      if (key && meta) {
        ms = key.kind === "user" ? meta.userTimes[key.seq] : meta.itemTimes[key.itemId];
      }
      if (key && ms === undefined) missing = true;
      setAttr(button, TIME_ATTR, ms === undefined ? null : formatLabel(ms, now));

      const sender = senderThreadOf(entry.label);
      const title = sender ? meta?.senderTitles[sender] : undefined;
      const text = title ? fallbackChipText(item) : null;
      if (text && title) {
        if (renamed.size > RENAMED_PRUNE_SIZE) {
          for (const node of renamed.keys()) if (!node.isConnected) renamed.delete(node);
        }
        renamed.set(text, text.nodeValue ?? "");
        text.nodeValue = title;
      }
    }
    requestMeta(threadId, missing);
  };

  const scan = (): void => {
    frame = 0;
    if (signal.aborted) return;
    for (const toc of document.querySelectorAll(TOC_SELECTOR)) {
      const parts = findParts(toc);
      if (!parts) continue;
      const showingUser = isPressed(parts.userButton);
      sortEntries(toc, parts, showingUser);
      syncTabs(toc, parts, showingUser);
      decorate(parts);
    }
  };

  const schedule = (): void => {
    if (frame === 0 && !signal.aborted) frame = requestAnimationFrame(scan);
  };

  // Track which tab the user picks. Capture phase, so this runs before BB's
  // own handlers re-render the popover.
  const onClick = (event: MouseEvent): void => {
    if (forwarding || !(event.target instanceof Element)) return;
    const button = event.target.closest("button");
    const toc = button?.closest(TOC_SELECTOR);
    if (!button || !toc) return;
    const parts = findParts(toc);
    if (!parts || button.parentElement !== parts.tabRow) return;
    if (button.hasAttribute(TAB_ATTR)) {
      tabs.set(toc, "system");
      // "System messages" filters BB's "Your messages" list, so switch BB to it.
      if (!isPressed(parts.userButton)) {
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
  // Scans write only on a change and only to attributes BB does not watch,
  // so a scan settles instead of retriggering itself.
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-pressed"],
  });
  const relabel = window.setInterval(schedule, RELABEL_MS);
  bridgeListeners.add(schedule);
  schedule();

  return () => {
    observer.disconnect();
    document.removeEventListener("click", onClick, true);
    window.clearInterval(relabel);
    bridgeListeners.delete(schedule);
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;

    for (const button of document.querySelectorAll(`button[${TAB_ATTR}]`)) button.remove();
    for (const item of document.querySelectorAll(`[${HIDDEN_ATTR}]`)) {
      item.removeAttribute(HIDDEN_ATTR);
    }
    for (const button of document.querySelectorAll<HTMLElement>(`[${PAINTED_ATTR}]`)) {
      button.removeAttribute(PAINTED_ATTR);
      paintTab(button, isPressed(button));
    }
    for (const button of document.querySelectorAll(`[${TIME_ATTR}]`)) {
      button.removeAttribute(TIME_ATTR);
    }
    for (const [text, original] of renamed) {
      if (text.isConnected) text.nodeValue = original;
    }
    renamed.clear();
    style.remove();
  };
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "rpc-bridge", component: RpcBridge });
  app.contentScripts.register({
    id: "system-messages-tab",
    mount: ({ signal }) => mountOutline(signal),
  });
});
