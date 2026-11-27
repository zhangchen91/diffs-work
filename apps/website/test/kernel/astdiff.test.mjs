/**
 * AST-level diff through the published wasm: node ranges with line AND column,
 * so a change *inside* a line is reported at its columns.
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

test("a value change is reported at its columns, not as the whole line", { skip: SKIP_NO_ENGINE }, () => {
  const r = call({ cmd: "ast_diff", a: "amount: 8000\n", b: "amount: 8500\n", filename: "x.ts" });
  const up = r.after.hunks.find((h) => h.operation === "update");
  assert.ok(up, JSON.stringify(r.after.hunks));
  assert.equal(up.range.start_row, 0);
  assert.ok(up.range.start_column >= 8, `starts after the key: ${up.range.start_column}`);
  assert.ok(up.range.end_column > up.range.start_column);
});

test("a moved declaration reports from and to rows", { skip: SKIP_NO_ENGINE }, () => {
  const a = "export function a() {}\nexport function moved() {}\nexport function b() {}\n";
  const b = "export function a() {}\nexport function b() {}\nexport function moved() {}\n";
  const r = call({ cmd: "ast_diff", a, b, filename: "x.ts" });
  const mv = r.after.hunks.find((h) => h.operation === "move");
  assert.ok(mv, JSON.stringify(r.after.hunks.map((h) => h.operation)));
  assert.ok(mv.move_target, "move carries a target range");
  assert.notEqual(mv.move_target.start_row, mv.range.start_row);
});

test("an added declaration is an insert at its own row", { skip: SKIP_NO_ENGINE }, () => {
  const r = call({ cmd: "ast_diff", a: "export function a() {}\n", b: "export function a() {}\nexport function b() {}\n", filename: "x.ts" });
  const ins = r.after.hunks.find((h) => h.operation === "insert");
  assert.ok(ins, JSON.stringify(r.after.hunks.map((h) => h.operation)));
  assert.equal(ins.range.start_row, 1);
});

test("punctuation noise is not reported (no fake moves of commas and braces)", { skip: SKIP_NO_ENGINE }, () => {
  const a = "const x = { a: 1, b: 2 };\nconst y = { a: 1, b: 3 };\n";
  const b = "const x = { a: 1, b: 9 };\nconst y = { a: 1, b: 3 };\n";
  const r = call({ cmd: "ast_diff", a, b, filename: "x.ts" });
  const moves = r.after.hunks.filter((h) => h.operation === "move");
  for (const m of moves) {
    assert.ok(String(m.text).trim().length > 2, `moved punctuation: ${JSON.stringify(m.text)}`);
    assert.ok(!["{", "}", ",", "-"].includes(String(m.text).trim()), `moved punctuation: ${m.text}`);
  }
});

test("identical files produce no hunks", { skip: SKIP_NO_ENGINE }, () => {
  const r = call({ cmd: "ast_diff", a: "const a = 1;\n", b: "const a = 1;\n", filename: "x.ts" });
  assert.equal(r.before.hunks.length + r.after.hunks.length, 0);
});

test("a value change is an update, never a move", { skip: SKIP_NO_ENGINE }, () => {
  const r = call({ cmd: "ast_diff", a: "const context = 2;\n", b: "const context = 3;\n", filename: "x.ts" });
  assert.equal(r.moves, 0, JSON.stringify(r.after.hunks));
  assert.ok(r.updates >= 1, JSON.stringify(r.after.hunks));
  const up = r.after.hunks.find((h) => h.operation === "update");
  assert.ok(up.range.end_column > up.range.start_column);
});

test("a renamed function is an update at its declaration", { skip: SKIP_NO_ENGINE }, () => {
  const r = call({ cmd: "ast_diff", a: "function short(x) { return x; }\n", b: "function shorten(x) { return x; }\n", filename: "x.ts" });
  assert.equal(r.moves, 0);
  assert.ok(r.after.hunks.some((h) => h.operation === "update" && /shorten/.test(h.text)));
});

test("a genuinely relocated declaration is still a move", { skip: SKIP_NO_ENGINE }, () => {
  const a = "const a = 1;\nfunction moved() { return 1; }\nconst b = 2;\n";
  const b = "const a = 1;\nconst b = 2;\nfunction moved() { return 1; }\n";
  const r = call({ cmd: "ast_diff", a, b, filename: "x.ts" });
  assert.ok(r.moves >= 1, JSON.stringify(r.after.hunks));
});
