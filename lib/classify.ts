// Which entries of BB's "Your messages" outline are not really the user's.
//
// BB delivers its own notices (child thread finished, failed, was
// interrupted, ...) to the agent as user turns whose text starts with
// "[bb system]", so the thread outline lists them under "Your messages".

export const SYSTEM_PREFIX = "[bb system]";

/** True when an outline entry's text is a BB system notice. */
export function isSystemLabel(text: string | null | undefined): boolean {
  return (text ?? "").trimStart().startsWith(SYSTEM_PREFIX);
}

export type Tab = "user" | "system";

/** Whether an outline entry stays visible while `tab` is selected. */
export function isVisible(tab: Tab, system: boolean): boolean {
  return tab === "system" ? system : !system;
}
