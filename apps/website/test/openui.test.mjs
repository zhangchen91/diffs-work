import assert from "node:assert/strict";
import test from "node:test";
import { parseOpenUI } from "../../../packages/diff-ui/src/views/openui-parse.ts";
import { toOpenUI } from "../../../packages/diff-tool/src/openui.ts";

test("an OpenUI card parses into a tree", () => {
  const n = parseOpenUI(`summary = Text("2 hunk(s)")
rows = Table({ columns: ["a", "b"] }, [
  ["1", "删除"],
  ["1", "新增"]
])
root = Card({ title: "x" }, [summary, rows])`);
  assert.equal(n.type, "Card");
  assert.deepEqual(n.children.map((c) => c.type), ["Text", "Table"]);
  assert.equal(n.children[1].items.length, 2, "a multi-line table keeps its rows");
});

test("a comparison becomes a card with one row per change", () => {
  const src = toOpenUI({
    schema: "diffs.work/portable@1",
    kind: "code",
    summary: "+1/-1",
    oldLabel: "a.ts",
    newLabel: "b.ts",
    added: 1,
    removed: 1,
    hunks: [
      {
        header: "@@ -1 +1 @@",
        lines: [
          { kind: "update", oldLine: 1, newLine: 1, text: "old" },
          { kind: "insert", oldLine: null, newLine: 2, text: "new" },
        ],
      },
    ],
    truncated: false,
  });
  const n = parseOpenUI(src);
  assert.equal(n.type, "Card");
  const table = n.children.find((c) => c.type === "Table");
  assert.ok(table, "the card carries a table of changes");
  assert.equal(table.items.length, 2);
});

test("a pair with no change says so instead of drawing an empty table", () => {
  const src = toOpenUI({
    schema: "diffs.work/portable@1",
    kind: "code",
    summary: "no change",
    oldLabel: "a",
    newLabel: "b",
    added: 0,
    removed: 0,
    hunks: [],
    truncated: false,
  });
  assert.match(src, /两版内容一致/);
});
