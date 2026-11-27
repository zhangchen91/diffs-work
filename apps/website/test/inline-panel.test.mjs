import assert from "node:assert/strict";
import test from "node:test";
import { lineDiff } from "../../chrome-extension/src/inline-panel.ts";

const shape = (a, b) => lineDiff(a, b).map((r) => `${r.op}:${r.text}`);

test("the panel's diff names additions, deletions and unchanged lines", () => {
  // The extension drew this comparison in a new tab until now; the same rows have to be right on
  // the page, because there is no second chance to show them once the panel is dismissed.
  assert.deepEqual(shape("a\nb\nc", "a\nB\nc\nd"), [
    "same:a",
    "add:B",
    "del:b",
    "same:c",
    "add:d",
  ]);
});

test("line numbers follow each side independently", () => {
  const rows = lineDiff("one\ntwo", "zero\none\ntwo");
  assert.deepEqual(
    rows.map((r) => [r.op, r.oldNo, r.newNo]),
    [
      ["add", null, 1],
      ["same", 1, 2],
      ["same", 2, 3],
    ],
  );
});

test("an empty side is all additions, not a crash", () => {
  assert.deepEqual(shape("", "x"), ["add:x", "del:"].sort());
});
