/**
 * Type hints and go-to-definition: the "LSP" answers that can be given correctly
 * without a compiler front end — annotations, literals, constructors and declared
 * types, plus the definition site of any name.
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
const demo = () => [
  { path: "src/money.ts", text: readFileSync(path.join(ROOT, "test-cases/symbol-graph/money.ts"), "utf8") },
  { path: "src/total.ts", text: readFileSync(path.join(ROOT, "test-cases/symbol-graph/total.ts"), "utf8") },
];

test("every symbol's type comes from an annotation, literal, constructor or declaration", { skip: SKIP_NO_ENGINE }, () => {
  const r = call({ cmd: "symbols", files: demo() });
  const by = Object.fromEntries(r.definitions.map((d) => [d.name, d]));
  assert.deepEqual(by.add.type, { kind: "annotation", type: "number" });
  assert.deepEqual(by.Money.type, { kind: "declared", type: "Money" });
  assert.deepEqual(by.totalOf.type, { kind: "annotation", type: "Money" });
  assert.equal(by.add.params, "(a: number, b: number)");
  assert.equal(by.add.returns, "number");
});

test("a name with no evidence stays unknown instead of guessing", { skip: SKIP_NO_ENGINE }, () => {
  const r = call({ cmd: "symbols", files: [{ path: "a.ts", text: "export function f(x) { return x; }\n" }] });
  const f = r.definitions.find((d) => d.name === "f");
  assert.equal(f.type, null);
});

test("goto resolves a call to its definition across files", { skip: SKIP_NO_ENGINE }, () => {
  const r = call({ cmd: "goto", files: demo(), file: "src/total.ts", line: 4, column: 46 });
  assert.equal(r.word, "add");
  assert.equal(r.definition.file, "src/money.ts");
  assert.equal(r.definition.line, 6);
  assert.match(r.hover, /add\(a: number, b: number\): number/);
  assert.ok(r.references.length >= 1);
});

test("goto on whitespace reports no identifier rather than a wrong one", { skip: SKIP_NO_ENGINE }, () => {
  // line 2 of total.ts is blank
  const r = call({ cmd: "goto", files: demo(), file: "src/total.ts", line: 2, column: 1 });
  assert.match(r.error ?? "", /no identifier|empty line/);
});

test("goto on a keyword returns the word but no definition", { skip: SKIP_NO_ENGINE }, () => {
  const r = call({ cmd: "goto", files: demo(), file: "src/total.ts", line: 1, column: 1 });
  assert.equal(r.word, "import");
  assert.equal(r.definition, null);
});
