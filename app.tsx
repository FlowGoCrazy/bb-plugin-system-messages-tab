// bb-plugin-system-messages-tab - frontend entry.
//
// BB's thread outline (the rail on the right of a thread, which opens a
// popover with "Agent messages" and "Your messages" tabs) lists BB's own
// "[bb system] ..." notices under "Your messages", because BB delivers them
// to the agent as user turns. This plugin adds a third "System" tab that
// holds those notices and hides them from "Your messages".
//
// The Plugin SDK has no slot for the outline, so a content script works on
// the rendered popover: it appends one button to the tab row, hides list
// entries with an attribute, and repaints the "Your messages" button while
// "System" is selected. BB keeps owning its own tab state; the "System" tab
// rides on top of BB's "Your messages" list, which already holds every entry
// this plugin sorts. Disposal removes every node, attribute, class change,
// listener and style the plugin added.
//
// A BB update can change the outline's markup. The plugin then finds nothing
// to change and the outline keeps working as BB ships it.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { isSystemLabel, isVisible, type Tab } from "./lib/classify";

const TOC_SELECTOR = "[data-thread-toc]";
const PANEL_SELECTOR = '[id^="thread-toc-panel-"]';
const USER_TAB_LABEL = "Your messages";
const SYSTEM_TAB_LABEL = "System";

const TAB_ATTR = "data-smt-tab";
const HIDDEN_ATTR = "data-smt-hidden";
const PAINTED_ATTR = "data-smt-painted";
const STYLE_ID = "bb-plugin-system-messages-tab-style";

// The classes BB's own outline tab button uses, so the added tab matches it.
const TAB_BASE =
  "flex h-7 flex-1 cursor-pointer items-center justify-center rounded-md text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const TAB_ACTIVE = ["bg-state-hover", "text-foreground"];
const TAB_INACTIVE = ["text-muted-foreground", "hover:bg-state-hover"];

// BB's two tabs share the row equally; a third equal tab would wrap
// "Agent messages", so the added one only takes the width of its label.
const STYLE = `
[${HIDDEN_ATTR}] { display: none !important; }
button[${TAB_ATTR}] { flex: 0 0 auto; padding: 0 10px; }
`;

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
  let frame = 0;
  let forwarding = false;

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
        const system = isSystemLabel(item.textContent);
        if (system) systemCount += 1;
        const hide = showingUser && !isVisible(tab, system);
        if (hide !== item.hasAttribute(HIDDEN_ATTR)) item.toggleAttribute(HIDDEN_ATTR, hide);
      }
      // Only the "Your messages" list can tell; keep the last answer otherwise.
      if (showingUser) hasSystem.set(toc, systemCount > 0);

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
        // while the "System" tab is the one in view.
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
      // "System" filters BB's "Your messages" list, so switch BB to it first.
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
  schedule();

  return () => {
    observer.disconnect();
    document.removeEventListener("click", onClick, true);
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
  app.contentScripts.register({
    id: "system-messages-tab",
    mount: ({ signal }) => mountSystemTab(signal),
  });
});
