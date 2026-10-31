// Which entries of BB's "Your messages" outline are not really the user's.
//
// BB delivers two kinds of messages to the agent as user turns, so the
// thread outline lists them under "Your messages":
// - its own notices (child thread finished, failed, was interrupted, ...),
//   whose text starts with "[bb system]";
// - messages from other agent threads (`bb thread tell`), whose text starts
//   with "[bb message from thread:<id>]". The outline strips that header and
//   shows the sender thread as a chip instead.

export const SYSTEM_PREFIX = "[bb system]";
const THREAD_MESSAGE_HEADER = /^\[bb message from thread:[^;\]\s]+(?:;[^\]]*)?\]/;

/** True when an outline entry's full text did not come from the user. */
export function isSystemLabel(text: string | null | undefined): boolean {
  const trimmed = (text ?? "").trimStart();
  return trimmed.startsWith(SYSTEM_PREFIX) || THREAD_MESSAGE_HEADER.test(trimmed);
}

export type Tab = "user" | "system";

/** Whether an outline entry stays visible while `tab` is selected. */
export function isVisible(tab: Tab, system: boolean): boolean {
  return tab === "system" ? system : !system;
}
