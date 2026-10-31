import { test } from "node:test";
import assert from "node:assert/strict";
import { isSystemLabel, isVisible } from "../lib/classify.ts";

test("recognises bb system notices", () => {
  assert.equal(isSystemLabel("[bb system] @thread:thr_abc completed: done"), true);
  assert.equal(isSystemLabel("  [bb system] leading whitespace"), true);
});

test("recognises messages from other agent threads", () => {
  assert.equal(isSystemLabel("[bb message from thread:thr_abc] R: why rounds exist"), true);
  assert.equal(isSystemLabel("[bb message from thread:thr_abc;reply=1]\n\nhi"), true);
});

test("leaves the user's own messages alone", () => {
  assert.equal(isSystemLabel("give me the full context"), false);
  assert.equal(isSystemLabel("what does [bb system] mean?"), false);
  assert.equal(isSystemLabel("[bb message from thread:] no id"), false);
  assert.equal(isSystemLabel(""), false);
  assert.equal(isSystemLabel(null), false);
});

test("each tab shows only its own entries", () => {
  assert.equal(isVisible("user", false), true);
  assert.equal(isVisible("user", true), false);
  assert.equal(isVisible("system", true), true);
  assert.equal(isVisible("system", false), false);
});
