import { test } from "node:test";
import assert from "node:assert/strict";
import { formatLabel, senderThreadOf, timeKeyOf } from "../lib/format.ts";

const now = new Date(2026, 9, 31, 14, 0);

test("labels today, yesterday, this year and older", () => {
  assert.equal(formatLabel(new Date(2026, 9, 31, 9, 5).getTime(), now, "en-US"), "Today, 9:05 AM");
  assert.equal(formatLabel(new Date(2026, 9, 30, 22, 10).getTime(), now, "en-US"), "Yesterday, 10:10 PM");
  assert.equal(formatLabel(new Date(2026, 9, 3, 9, 15).getTime(), now, "en-US"), "Oct 3, 9:15 AM");
  assert.equal(formatLabel(new Date(2025, 9, 3, 9, 15).getTime(), now, "en-US"), "Oct 3, 2025, 9:15 AM");
});

test("follows a 24-hour locale", () => {
  assert.equal(formatLabel(new Date(2026, 9, 31, 14, 30).getTime(), now, "en-GB"), "Today, 14:30");
});

test("yesterday crosses month boundaries", () => {
  const first = new Date(2026, 10, 1, 8, 0);
  assert.equal(formatLabel(new Date(2026, 9, 31, 23, 0).getTime(), first, "en-GB"), "Yesterday, 23:00");
});

test("finds the time key in outline ids", () => {
  assert.deepEqual(timeKeyOf("thr_a:user-seed:36095"), { kind: "user", seq: "36095" });
  assert.deepEqual(
    timeKeyOf("thr_a:assistant:kind:assistant|turn:da0-t85|parent:root|item:da0-i513"),
    { kind: "item", itemId: "da0-i513" },
  );
  assert.equal(timeKeyOf("something else"), null);
});

test("finds the sender thread of a thread message", () => {
  assert.equal(senderThreadOf("[bb message from thread:thr_cqw7gb868c] R: hi"), "thr_cqw7gb868c");
  assert.equal(senderThreadOf("[bb message from thread:thr_x;reply=1] hi"), "thr_x");
  assert.equal(senderThreadOf("[bb system] done"), null);
});
