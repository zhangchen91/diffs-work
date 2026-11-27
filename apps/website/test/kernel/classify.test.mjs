/**
 * The four states, one tiny input each. If this file goes red, no sample can look right:
 * every case here is the smallest version of something a reviewer must be able to trust.
 *
 *   增  an added line with no deletion beside it
 *   删  a removed line with no addition beside it
 *   改  an add+delete pair that is clearly the same line, changed
 *   移  identical content at a different position (wins over 增/删)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../..");
const WASM_PATH = path.join(ROOT, "apps/website/public/engine/rules-core/diffs-engine.wasm");
const ENGINE_AVAILABLE = existsSync(WASM_PATH);
const SKIP_NO_ENGINE = ENGINE_AVAILABLE ? false : "engine binary not built";

let cached = null;
function load() {
  const ex = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(WASM_PATH)), {}).exports;
  return (req) => {
    const bytes = new TextEncoder().encode(JSON.stringify(req));
    const p = ex.diffs_alloc(bytes.length);
    new Uint8Array(ex.memory.buffer, p, bytes.length).set(bytes);
    const out = ex.diffs_handle(p, bytes.length);
    const len = ex.diffs_box_len(out);
    const text = new TextDecoder().decode(new Uint8Array(ex.memory.buffer, out + 4, len));
    ex.diffs_free(out, len + 4);
    ex.diffs_free(p, bytes.length);
    return JSON.parse(text);
  };
}
const call = (req) => (cached ??= load())(req);
const diff = (a, b, filename = "x.ts") => call({ cmd: "sem_diff", a, b, filename });

test("增: one added line, nothing deleted", { skip: SKIP_NO_ENGINE }, () => {
  const r = diff("a\nb\n", "a\nNEW\nb\n");
  assert.equal(r.inserts, 1);
  assert.equal(r.deletes, 0);
  assert.equal(r.updates, 0);
});

test("删: one removed line, nothing added", { skip: SKIP_NO_ENGINE }, () => {
  const r = diff("a\nb\nc\n", "a\nc\n");
  assert.equal(r.deletes, 1);
  assert.equal(r.inserts, 0);
  assert.equal(r.updates, 0);
});

test("改: the same statement with one value changed", { skip: SKIP_NO_ENGINE }, () => {
  const r = diff("a\nlet rate = 5;\nb\n", "a\nlet rate = 8;\nb\n");
  assert.equal(r.updates, 1);
  assert.equal(r.inserts, 0);
  assert.equal(r.deletes, 0);
  const rows = r.hunks[0].lines.filter((l) => l.kind.startsWith("upd"));
  assert.equal(rows.length, 2);
  assert.ok(rows[0].segments?.length, "the changed words are marked inline");
});

test("改: a renamed function is an update (reference behaviour)", { skip: SKIP_NO_ENGINE }, () => {
  // reference's port pairs rows by position inside a replace block, so a one-line rename is
  // an update with an inline word diff, not a delete plus an insert.
  const r = diff("a\nfunction old() {\nb\n", "a\nfunction renamed() {\nb\n");
  assert.equal(r.updates, 1);
  assert.equal(r.inserts, 0);
  assert.equal(r.deletes, 0);
  const rows = r.hunks[0].lines.filter((l) => l.kind.startsWith("upd"));
  assert.ok(rows[0].segments?.length, "the renamed word is marked inline");
});

test("移: identical block at a new position, reported once and not as add+delete", { skip: SKIP_NO_ENGINE }, () => {
  const r = diff("a\nX1\nX2\nX3\nb\n", "a\nb\nX1\nX2\nX3\n");
  // Two relocations in opposite directions: the block goes down one row, `b` goes up three.
  // Both are moves, so both are reported -- what matters is that neither is also an add/delete.
  assert.equal(r.moves, 2, JSON.stringify(r.moveBlocks));
  const block = r.moveBlocks.find((m) => m.text.startsWith("X1"));
  assert.ok(block, JSON.stringify(r.moveBlocks));
  assert.equal(block.fromStart, 2);
  assert.equal(block.toStart, 3);
  // the moved block is context on both sides; a shift of the surrounding lines is either
  // not shown at all or shown as context, never as an add/delete pair of the moved text
  // A moved row appears in the move's own hunk, marked `move`; it must not also appear as an
  // addition or a deletion anywhere.
  const changedRows = r.hunks.flatMap((h) => h.lines.filter((l) => l.kind && l.kind !== "ctx" && l.kind !== "move").map((l) => l.text.trim()));
  for (const moved of ["X1", "X2", "X3"]) {
    assert.ok(!changedRows.includes(moved), `${moved} is both moved and changed: ${changedRows}`);
  }
  assert.equal(r.inserts + r.deletes, 0, `a pure move adds nothing: ${JSON.stringify(r.hunks)}`);
});

test("移 beats 改: a moved block that also had one line edited", { skip: SKIP_NO_ENGINE }, () => {
  const r = diff("a\nfunction f() {\n  return 1;\n}\nb\n", "a\nb\nfunction f() {\n  return 2;\n}\n");
  // The function moved as one block; `b` also moved (the other way). The point of this test is
  // that the block is reported whole, not split around the line that changed inside it.
  const block = r.moveBlocks.find((m) => m.text.includes("function f"));
  assert.ok(block, JSON.stringify(r.moveBlocks));
  assert.equal(block.fromStart, 2);
  assert.equal(block.fromEnd, 4);
  assert.equal(block.toStart, 3);
  const edits = r.hunks.flatMap((h) => h.lines.filter((l) => l.kind.startsWith("upd") || l.kind === "ins" || l.kind === "del"));
  // the edited value is allowed to show up as its own change, but the braces and the
  // signature must not be reported twice
  assert.ok(edits.every((l) => !l.text.includes("function f")), JSON.stringify(edits.map((l) => l.text)));
});

test("empty lines never become a change of their own", { skip: SKIP_NO_ENGINE }, () => {
  const r = diff("a\n\nb\n", "a\n\n\nb\n");
  const rows = r.hunks.flatMap((h) => h.lines.filter((l) => l.kind !== "ctx" && l.text.trim() === ""));
  assert.equal(rows.length, 0, JSON.stringify(rows));
});

test("a heading rewrite is one update even across a blank line", { skip: SKIP_NO_ENGINE }, () => {
  const r = diff("## Known gaps\ntext\n", "## Open questions\ntext\n");
  assert.equal(r.updates, 1, JSON.stringify(r.hunks));
});

test("a deleted function next to an added one is not a fake update", { skip: SKIP_NO_ENGINE }, () => {
  const r = diff("a\nexport function legacyTax(t: number): number {\n  return t * 0.06;\n}\nb\n", "a\nb\nexport function taxIncluded(t: number, r: number): boolean {\n  return r > 0;\n}\n");
  assert.equal(r.updates, 0, `different declarations must not pair: ${JSON.stringify(r.hunks)}`);
});
