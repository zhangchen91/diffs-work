/**
 * Markdown structure diff tests — fixtures are the two contract samples the
 * website ships, so the review sees the same behaviour on diffs.work.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const md = await import(path.join(HERE, "../.test/bundle.mjs"));

const read = (p) => readFile(path.join(ROOT, p), "utf8");

test("parses headings, lists, tables, code fences, quotes", () => {
  const src = [
    "# 标题",
    "",
    "正文段落。",
    "",
    "## 二级",
    "- 条目一",
    "- 条目二",
    "",
    "| 名称 | 值 |",
    "| --- | --- |",
    "| a | 1 |",
    "",
    "```ts",
    "const x = 1;",
    "```",
    "",
    "> 引用",
  ].join("\n");
  const doc = md.parseMarkdown(src);
  const kinds = doc.blocks.filter((b) => b.kind !== "blank").map((b) => b.kind);
  assert.deepEqual(kinds, ["heading", "paragraph", "heading", "list", "table", "code", "quote"]);
  const table = doc.blocks.find((b) => b.kind === "table");
  assert.deepEqual(table.rows[0], ["名称", "值"]);
  assert.deepEqual(table.rows[1], ["a", "1"]);
});

test("inline marks light up the changed phrase, not the whole paragraph", () => {
  // The fixture sentence changes one phrase; the words around it must stay unmarked.
  const a = "# T\n\nA normal week is under 40 hours.\n";
  const b = "# T\n\nA normal week is under 45 hours.\n";
  const d = md.diffMarkdown(a, b);
  const change = d.hunks.flatMap((h) => h.lines).find((l) => l.kind === "insert");
  assert.ok(change, "the changed sentence is reported");
  const inserted = change.inline.filter((s) => s.op === "insert").map((s) => s.text).join("");
  assert.match(inserted, /45/);
  assert.doesNotMatch(inserted, /normal week is under/, "unchanged words must not be marked");
});

test("structure stats understand what changed", async () => {
  const d = md.diffMarkdown(await read("examples/code/hours-v1.md"), await read("examples/code/hours-v2.md"));
  assert.ok(d.summary.changed >= 1);
  assert.ok(d.structure.headings.new >= d.structure.headings.old);
  assert.match(md.summarizeMarkdown(d), /块改写/);
});

test("a moved clause is reported as a move, not delete+insert", () => {
  const a = "# A\n\n保留段落\n\n会被移动的一段\n\n结尾\n";
  const b = "# A\n\n会被移动的一段\n\n保留段落\n\n结尾\n";
  const d = md.diffMarkdown(a, b);
  const kinds = d.hunks.flatMap((h) => h.lines).map((l) => l.kind);
  assert.ok(kinds.includes("move"), `kinds=${kinds.join(",")}`);
  assert.ok(d.summary.moved >= 1);
});

test("table row edits diff per row", () => {
  const a = "| 名 | 值 |\n| --- | --- |\n| a | 1 |\n| b | 2 |\n";
  const b = "| 名 | 值 |\n| --- | --- |\n| a | 1 |\n| b | 22 |\n| c | 3 |\n";
  const d = md.diffMarkdown(a, b);
  const lines = d.hunks[0].lines;
  assert.ok(lines.some((l) => l.kind === "insert" && l.text.includes("| c | 3 |")));
  assert.ok(lines.some((l) => l.deleted || l.kind === "delete" && l.text.includes("| b | 2 |")));
});

test("identical documents produce zero hunks", () => {
  const src = "# 一样\n\n内容\n";
  const d = md.diffMarkdown(src, src);
  assert.equal(d.hunks.length, 0);
  assert.equal(md.summarizeMarkdown(d), "两份文档结构一致");
});

test("emphasis-only change counts as style, not content", () => {
  const d = md.diffMarkdown("价格 **100** 元\n", "价格 100 元\n");
  assert.equal(d.summary.styleOnly, 1);
  assert.equal(d.summary.changed, 0);
});