/**
 * Semantic diff (reference model) through the published wasm.
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
const SKIP_NO_ENGINE = ENGINE_AVAILABLE ? false : "engine binary not built (pnpm build:rules)";

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
// Lazy: without the binary the file still imports cleanly and every test skips.
let cached = null;
const call = (req) => (cached ??= load())(req);
const T = (v) => v.join("\n");

test("a changed line is one update with word marks, not add+delete noise", { skip: SKIP_NO_ENGINE }, () => {
  const r = call({ cmd: "sem_diff", a: T(["a", "amount: 8000", "c"]), b: T(["a", "amount: 8500", "c"]), filename: "x.ts" });
  assert.equal(r.updates, 1);
  assert.equal(r.inserts + r.deletes, 0);
  const hunk = r.hunks.find((h) => h.operation === "update");
  assert.ok(hunk, JSON.stringify(r.hunks.map((h) => h.operation)));
  const kinds = hunk.lines.map((l) => l.kind);
  assert.ok(kinds.includes("upd-del") && kinds.includes("upd-ins"), kinds.join(","));
  const marked = hunk.lines.flatMap((l) => l.segments || []).filter((s) => s.op !== "same");
  // the mark is the changed characters ("0" → "5"), which is what the view highlights
  assert.ok(marked.length >= 2, JSON.stringify(marked));
  assert.ok(marked.some((s) => s.op === "del") && marked.some((s) => s.op === "ins"), JSON.stringify(marked));
});

test("a moved block is reported with both positions", { skip: SKIP_NO_ENGINE }, () => {
  const a = T(["head", "moved a", "moved b", "middle", "tail"]);
  const b = T(["head", "middle", "moved a", "moved b", "tail"]);
  const r = call({ cmd: "sem_diff", a, b, filename: "x.md" });
  assert.equal(r.moves, 1, JSON.stringify(r.moveBlocks));
  assert.equal(r.moveBlocks[0].toStart, 3);
  assert.match(r.moveBlocks[0].text, /moved a/);
});

test("adds and deletes keep their own operation", { skip: SKIP_NO_ENGINE }, () => {
  const r = call({ cmd: "sem_diff", a: T(["a", "b"]), b: T(["a", "new", "b"]), filename: "x.txt" });
  assert.equal(r.inserts, 1);
  assert.equal(r.deletes, 0);
  const r2 = call({ cmd: "sem_diff", a: T(["a", "gone", "b"]), b: T(["a", "b"]), filename: "x.txt" });
  assert.equal(r2.deletes, 1);
  assert.equal(r2.inserts, 0);
});

test("the real sample pair yields every state at once", { skip: SKIP_NO_ENGINE }, () => {
  const a = readFileSync(path.join(ROOT, "examples/code/pricebook-v1.ts"), "utf8");
  const b = readFileSync(path.join(ROOT, "examples/code/pricebook-v2.ts"), "utf8");
  const r = call({ cmd: "sem_diff", a, b, filename: "parse-v2.ts" });
  assert.ok(r.updates > 0, r.summary);
  assert.ok(r.added > 0 && r.removed > 0, r.summary);
  const kinds = new Set(r.hunks.flatMap((h) => h.lines.map((l) => l.kind)));
  assert.ok(kinds.has("upd-del") && kinds.has("ins") && kinds.has("ctx"), [...kinds].join(","));
});

test("identical input has no hunks and no moves", { skip: SKIP_NO_ENGINE }, () => {
  const r = call({ cmd: "sem_diff", a: T(["x", "y"]), b: T(["x", "y"]), filename: "x.txt" });
  assert.equal(r.hunks.length, 0);
  assert.equal(r.moves, 0);
});

test("a one-line edit shows only the edit plus context, never the previous lines", { skip: SKIP_NO_ENGINE }, () => {
  const a = ["l1", "l2", "l3", "const context = 2;", "", "after"].join("\n");
  const b = ["l1", "l2", "l3", "const context = 3;", "", "after"].join("\n");
  const r = call({ cmd: "sem_diff", a, b, filename: "x.ts" });
  assert.equal(r.hunks.length, 1);
  const lines = r.hunks[0].lines;
  const kinds = lines.map((l) => l.kind);
  // One edit, reported once as its two halves.
  assert.equal(kinds.filter((k) => k === "upd-del").length, 1, JSON.stringify(kinds));
  assert.equal(kinds.filter((k) => k === "upd-ins").length, 1, JSON.stringify(kinds));
  // The edit sits inside its context, with no more than three rows either side of it.
  const at = kinds.indexOf("upd-del");
  assert.ok(at > 0 && at < kinds.length - 1, "the edit is surrounded by context: " + JSON.stringify(kinds));
  assert.ok(at <= 3, `leading context ${at}: ${JSON.stringify(kinds)}`);
  assert.ok(kinds.length - 2 - at <= 3, `trailing context ${kinds.length - 2 - at}: ${JSON.stringify(kinds)}`);
});
