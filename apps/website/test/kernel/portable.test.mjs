/**
 * The one output contract: `diffs.work/portable@1`.
 * A viewer must be able to render any family from this shape alone.
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
const b64 = (p) => readFileSync(path.join(ROOT, p)).toString("base64");

test("code pairs emit the shared schema with hunks, revisions and a ratio", { skip: SKIP_NO_ENGINE }, () => {
  const a = readFileSync(path.join(ROOT, "examples/code/pricebook-v1.ts"), "utf8");
  const b = readFileSync(path.join(ROOT, "examples/code/pricebook-v2.ts"), "utf8");
  const r = call({ cmd: "portable_code", a, b, filename: "parse-v2.ts" });
  assert.equal(r.schema, "diffs.work/portable@1");
  assert.equal(r.kind, "code");
  assert.ok(Array.isArray(r.hunks) && r.hunks.length > 0);
  assert.ok(Array.isArray(r.revisions) && r.revisions.length > 0);
  state(r);
});

test("docx pairs emit the same schema with paragraph revisions", { skip: SKIP_NO_ENGINE }, () => {
  const r = call({ cmd: "portable_opc", a: b64("examples/docx/contract-v1.docx"), b: b64("examples/docx/contract-v2.docx"), kind: "docx" });
  assert.equal(r.schema, "diffs.work/portable@1");
  assert.equal(r.kind, "docx");
  assert.ok(r.revisions.length >= 4);
  state(r);
});

test("an identical pair reports a zero ratio", { skip: SKIP_NO_ENGINE }, () => {
  const same = readFileSync(path.join(ROOT, "examples/code/pricebook-v1.ts"), "utf8");
  const r = call({ cmd: "portable_code", a: same, b: same, filename: "x.ts" });
  assert.equal(r.summary.ratio, 0);
});

function state(r) {
  for (const k of ["added", "removed", "changed", "ratio"]) assert.equal(typeof r.summary[k], "number", k);
  assert.ok(r.summary.ratio >= 0 && r.summary.ratio <= 1, "ratio is a share");
}
