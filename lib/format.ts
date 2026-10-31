// Date-and-time labels for outline entries: "Today, 2:34 PM",
// "Yesterday, 22:10", "Oct 3, 9:15 AM", and "Oct 3, 2025, 9:15 AM" for
// another year. Language and clock follow the computer's locale.

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function formatLabel(ms: number, now: Date, locale?: string): string {
  const date = new Date(ms);
  const time = date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  if (sameDay(date, now)) return `Today, ${time}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(date, yesterday)) return `Yesterday, ${time}`;
  const day = date.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
  return `${day}, ${time}`;
}

/** Where to find an outline entry's time in the backend's maps, from its id. */
export type TimeKey = { kind: "user"; seq: string } | { kind: "item"; itemId: string };

export function timeKeyOf(outlineId: string): TimeKey | null {
  const user = /:user-seed:(\d+)$/.exec(outlineId);
  if (user) return { kind: "user", seq: user[1] };
  const item = /\|item:([^|]+)$/.exec(outlineId);
  if (item) return { kind: "item", itemId: item[1] };
  return null;
}

/** The sender thread of a "[bb message from thread:<id>]" entry. */
export function senderThreadOf(label: string): string | null {
  return /^\s*\[bb message from thread:([^;\]\s]+)/.exec(label)?.[1] ?? null;
}
