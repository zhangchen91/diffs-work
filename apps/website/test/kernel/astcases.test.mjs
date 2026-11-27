/**
 * Structural diff behaviour, one case per thing a reader actually looks for.
 *
 * The shape follows how OmniDiff-compatible states its expectations (AGPL-3.0; not copied — its test
 * data was read to learn the convention): every case names the operation the change is
 * supposed to produce, so a regression shows up as "this edit stopped being an update"
 * rather than as a changed summary line.
 *
 * A case is: language, before, after, and the operations that must appear.
 * `mustNot` names operations that would be wrong answers even if something was reported.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../..");
const WASM = path.join(ROOT, "apps/website/public/engine/rules-core/diffs-engine.wasm");
const SKIP = existsSync(WASM) ? false : "engine binary not built";

let call = null;
if (!SKIP) {
  const ex = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(WASM)), {}).exports;
  call = (req) => {
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

function operations(r) {
  return new Set([...(r.before.hunks ?? []), ...(r.after.hunks ?? [])].map((h) => h.operation));
}

const CASES = [
  {
    name: "rust: adding a statement is an insert",
    file: "t.rs",
    before: 'fn main() {\n    let x = 1;\n}\n',
    after: 'fn main() {\n    let x = 1;\n    let y = 2;\n}\n',
    must: ["insert"],
    mustNot: ["move"],
  },
  {
    name: "rust: removing a whole function is a delete",
    file: "t.rs",
    before: 'fn keep() {}\n\nfn gone(a: i32) -> i32 {\n    a + 1\n}\n',
    after: 'fn keep() {}\n',
    must: ["delete"],
    mustNot: [],
  },
  {
    name: "rust: changing a constant in place is an update, not delete+insert",
    file: "t.rs",
    before: 'const RATE: f64 = 0.05;\n',
    after: 'const RATE: f64 = 0.08;\n',
    must: ["update"],
    mustNot: ["delete"],
  },
  {
    name: "typescript: a renamed local keeps the surrounding block",
    file: "t.ts",
    before: "function f(a: number) {\n  const total = a + 1;\n  return total;\n}\n",
    after: "function f(a: number) {\n  const sum = a + 1;\n  return sum;\n}\n",
    must: ["update"],
    mustNot: ["move"],
  },
  {
    name: "python: a new guarded block is an insert",
    file: "t.py",
    before: "def f(a):\n    return a\n",
    after: "def f(a):\n    if a < 0:\n        return 0\n    return a\n",
    must: ["insert"],
    mustNot: [],
  },
  {
    name: "go: a deleted branch is a delete",
    file: "t.go",
    before: "package m\n\nfunc F(a int) int {\n\tif a > 0 {\n\t\treturn a\n\t}\n\treturn 0\n}\n",
    after: "package m\n\nfunc F(a int) int {\n\treturn 0\n}\n",
    must: ["delete"],
    mustNot: [],
  },
];

for (const c of CASES) {
  test(c.name, { skip: SKIP }, () => {
    const r = call({ cmd: "ast_diff", a: c.before, b: c.after, filename: c.file });
    const ops = operations(r);
    for (const want of c.must) {
      assert.ok(ops.has(want), `expected a ${want} (got ${[...ops].join(",") || "nothing"}): ${r.summary}`);
    }
    for (const bad of c.mustNot) {
      assert.ok(!ops.has(bad), `reported a ${bad} where there should be none: ${r.summary}`);
    }
  });
}

test("an unchanged file produces no operations at all", { skip: SKIP }, () => {
  const src = "fn main() {\n    let x = 1;\n}\n";
  const r = call({ cmd: "ast_diff", a: src, b: src, filename: "t.rs" });
  assert.equal(operations(r).size, 0, `reported ${[...operations(r)].join(",")} for an identical file`);
});

test("a value change survives a deletion above it", { skip: SKIP }, () => {
  // The exact shape of the site's own sample: a function is removed, so everything below
  // shifts up five lines, and a constant deeper down changes value. Reported as an insert
  // before, because absolute row numbers were part of the node's identity.
  const before = [
    "fn keep() {}",
    "",
    "fn legacy() -> f64 {",
    "    0.03",
    "}",
    "",
    "fn rate() -> f64 {",
    "    0.05",
    "}",
    "",
  ].join("\n");
  const after = ["fn keep() {}", "", "fn rate() -> f64 {", "    0.08", "}", ""].join("\n");
  const r = call({ cmd: "ast_diff", a: before, b: after, filename: "t.rs" });
  const ops = operations(r);
  assert.ok(ops.has("delete"), `the removed function is not a delete: ${r.summary}`);
  assert.ok(ops.has("update"), `the new rate is not an update: ${r.summary}`);
});
