/**
 * Character-level diff, which is what makes an edited clause readable.
 *
 * "投前估值 15 亿，投后 16.07 亿美元" → "... 16.80 亿美元" differs in two digits. Without
 * character marking the reader compares two long paragraphs by eye.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const bundle = await import(path.join(HERE, "../../.test/bundle.mjs"));
const { charDiff } = bundle;

test("only the changed characters are marked", () => {
  const segs = charDiff("估值 16.07 亿美元", "估值 16.80 亿美元");
  const del = segs.filter((s) => s.op === "del").map((s) => s.text).join("");
  const ins = segs.filter((s) => s.op === "ins").map((s) => s.text).join("");
  // The LCS keeps the shared `0`, so the marks are `7` → `8`; marking one character instead
  // of two is the better outcome, not a miss.
  assert.equal(del, "7");
  assert.equal(ins, "8");
  // and the untouched part is one piece, not a character-by-character stream
  assert.ok(segs.some((s) => s.op === "same" && s.text.length > 5), "no long unchanged run");
});

test("identical text is a single unchanged segment", () => {
  assert.deepEqual(charDiff("一样", "一样"), [{ op: "same", text: "一样" }]);
});

test("a pure addition and a pure deletion stay separate", () => {
  assert.deepEqual(charDiff("", "新"), [{ op: "ins", text: "新" }]);
  assert.deepEqual(charDiff("旧", ""), [{ op: "del", text: "旧" }]);
});

test("very long cells fall back instead of building a huge table", () => {
  const a = "甲".repeat(2000);
  const b = "乙".repeat(2000);
  const segs = charDiff(a, b);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].op, "del");
  assert.equal(segs[1].op, "ins");
});

test("adjacent segments of the same kind are merged", () => {
  const segs = charDiff("abc", "xyz");
  assert.equal(segs.filter((s) => s.op === "del").length, 1, "deletions split into pieces");
  assert.equal(segs.filter((s) => s.op === "ins").length, 1, "insertions split into pieces");
});
