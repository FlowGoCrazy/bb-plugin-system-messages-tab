// Reading and adjusting BB's rendered thread outline.
//
// The Plugin SDK has no slot for the outline, so everything here depends on
// the markup BB 0.48 renders. Each lookup returns null when the markup is not
// what it expects, so a BB update leaves the outline untouched instead of
// breaking it.

export const TOC_SELECTOR = "[data-thread-toc]";
const PANEL_ID_PREFIX = "thread-toc-panel-";
export const PANEL_SELECTOR = `[id^="${PANEL_ID_PREFIX}"]`;
const USER_TAB_LABEL = "Your messages";
const FALLBACK_SENDER = "Agent";
const MAX_FIBER_DEPTH = 6;

/** Marks the tab button this plugin adds. */
export const TAB_ATTR = "data-smt-tab";

// The classes BB's own outline tab button uses, so the added tab matches it.
const TAB_BASE =
  "flex h-7 flex-1 cursor-pointer items-center justify-center rounded-md text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const TAB_ACTIVE = ["bg-state-hover", "text-foreground"];
const TAB_INACTIVE = ["text-muted-foreground", "hover:bg-state-hover"];

export type OutlineParts = {
  threadId: string;
  tabRow: Element;
  userButton: HTMLButtonElement;
  /** The entry list; its parent is the element that scrolls. */
  list: HTMLUListElement | null;
  items: HTMLLIElement[];
};

/** The open outline popover's pieces, or null when it is closed or unfamiliar. */
export function findParts(toc: Element): OutlineParts | null {
  const panel = toc.querySelector(PANEL_SELECTOR);
  const card = panel?.firstElementChild;
  const tabRow = card?.firstElementChild;
  if (!panel || !card || !tabRow) return null;
  const userButton = Array.from(tabRow.querySelectorAll("button")).find(
    (button) => !button.hasAttribute(TAB_ATTR) && button.textContent?.trim() === USER_TAB_LABEL,
  );
  if (!userButton) return null;
  const list = card.querySelector("ul");
  const items = list
    ? Array.from(list.children).filter((child) => child instanceof HTMLLIElement)
    : [];
  return { threadId: panel.id.slice(PANEL_ID_PREFIX.length), tabRow, userButton, list, items };
}

export function isPressed(button: Element): boolean {
  return button.getAttribute("aria-pressed") === "true";
}

/** Gives a tab button BB's selected or unselected look. */
export function paintTab(button: HTMLElement, active: boolean): void {
  const add = active ? TAB_ACTIVE : TAB_INACTIVE;
  const remove = active ? TAB_INACTIVE : TAB_ACTIVE;
  if (remove.some((name) => button.classList.contains(name))) button.classList.remove(...remove);
  if (add.some((name) => !button.classList.contains(name))) button.classList.add(...add);
}

export function createTab(label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute(TAB_ATTR, "");
  button.className = TAB_BASE;
  button.textContent = label;
  return button;
}

export type Entry = { id: string | null; label: string };

type Fiber = { memoizedProps?: unknown; return?: Fiber | null };

function fiberOf(element: Element): Fiber | null {
  for (const key of Object.keys(element)) {
    if (key.startsWith("__reactFiber$")) {
      return (element as unknown as Record<string, Fiber>)[key] ?? null;
    }
  }
  return null;
}

/**
 * An outline entry's id and full label. The outline replaces a thread
 * message's "[bb message from thread:...]" header with a sender chip, so the
 * label comes from the props of the component that renders the entry; the
 * rendered text is the fallback.
 */
export function readEntry(item: Element): Entry {
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
  return { id: null, label: item.textContent ?? "" };
}

/** The text node of an entry's sender chip when BB shows its "Agent" fallback. */
export function fallbackChipText(item: Element): Text | null {
  const chip = item.querySelector("button > span > span")?.firstElementChild;
  if (!chip || chip.textContent?.trim() !== FALLBACK_SENDER) return null;
  const walker = document.createTreeWalker(chip, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeValue?.trim() === FALLBACK_SENDER) return node as Text;
  }
  return null;
}

/** Sets or removes an attribute, writing only on a change. */
export function setAttr(element: Element, name: string, value: string | null): void {
  if (value === null) {
    if (element.hasAttribute(name)) element.removeAttribute(name);
  } else if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}
