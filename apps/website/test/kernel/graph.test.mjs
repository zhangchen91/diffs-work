/**
 * Cross-file symbol graph (ls_graph) — the part a single-file diff cannot do.
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
const demo = (f) => ({ path: `src/${f}`, text: readFileSync(path.join(ROOT, "test-cases/symbol-graph", f), "utf8") });

test("links a symbol across two files with reference counts", { skip: SKIP_NO_ENGINE }, () => {
  const g = call({ cmd: "ls_graph", files: [demo("money.ts"), demo("total.ts")] });
  const byName = Object.fromEntries(g.symbols.map((s) => [s.name, s]));
  assert.ok(byName.Money, "interface found");
  assert.ok(byName.Money.referenceCount >= 3, `Money refs=${byName.Money.referenceCount}`);
  assert.ok(byName.Money.referencedIn >= 2, "used from both files");
  assert.equal(byName.add.referenceCount, 2, "add() is called twice");
  assert.ok(byName.totalOf.references.length === 1, "totalOf referenced from label()");
});

test("resolves the relative import into a project edge", { skip: SKIP_NO_ENGINE }, () => {
  const g = call({ cmd: "ls_graph", files: [demo("money.ts"), demo("total.ts")] });
  const edge = g.edges.find((e) => e.to === "src/money.ts");
  assert.ok(edge, `edges=${JSON.stringify(g.edges)}`);
  assert.equal(edge.from, "src/total.ts");
  assert.ok(edge.names.includes("add") && edge.names.includes("format"), edge.names.join(","));
});

test("carries annotations as type hints and keeps go-to-definition", { skip: SKIP_NO_ENGINE }, () => {
  const g = call({ cmd: "ls_graph", files: [demo("money.ts"), demo("total.ts")] });
  const add = g.symbols.find((s) => s.name === "add");
  assert.equal(add.type, "number");
  const totalOf = g.symbols.find((s) => s.name === "totalOf");
  assert.equal(totalOf.type, "Money");
  const def = g.definitions.find((d) => d.name === "format");
  assert.equal(def.file, "src/money.ts");
  assert.ok(def.line >= 8, `line=${def.line}`);
});

test("a package import is reported, not silently dropped", { skip: SKIP_NO_ENGINE }, () => {
  const g = call({ cmd: "ls_graph", files: [{ path: "src/x.ts", text: 'import { z } from "zod";\nexport function f() {}\n' }] });
  assert.ok(g.unresolvedImports.some((u) => u.specifier === "zod"));
});

test("a large-ish file stays well under a second", { skip: SKIP_NO_ENGINE }, () => {
  const text = Array.from({ length: 400 }, (_, i) => `export function f${i}(a: number): number {\n  return a + ${i};\n}`).join("\n");
  const t0 = Date.now();
  const g = call({ cmd: "ls_graph", files: [{ path: "a.ts", text }] });
  const ms = Date.now() - t0;
  assert.equal(g.symbols.length, 400);
  assert.ok(ms < 2000, `took ${ms}ms`);
});
