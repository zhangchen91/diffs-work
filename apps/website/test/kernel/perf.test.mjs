/**
 * Large-file budget.
 *
 * The engine's matching passes were quadratic: a 3000-line file with 200 edits took 49
 * seconds for the structural diff and 13 seconds for the symbol table, because each symbol
 * rescanned (and re-tokenised) the whole file. Every pass indexes by hash now. These
 * budgets are deliberately generous — they only need to catch a return to quadratic
 * behaviour, not to pin down a millisecond — a loaded machine has measured 4x the idle
 * time for the same code.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../..");
const WASM_PATH = path.join(ROOT, "apps/website/public/engine/rules-core/diffs-engine.wasm");
const SKIP = existsSync(WASM_PATH) ? false : "engine binary not built";

let cached = null;
function call(req) {
  if (!cached) {
    const ex = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(WASM_PATH)), {}).exports;
    cached = (r) => {
      const bytes = new TextEncoder().encode(JSON.stringify(r));
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
  return cached(req);
}

const LINES = 3000;
const base = Array.from({ length: LINES }, (_, i) => `export function f${i}(a: number) { return a + ${i}; }`).join("\n");
const edited = base
  .split("\n")
  .map((l, i) => (i % 15 === 0 ? l.replace("a +", "a -") : l))
  .join("\n");

test(`${LINES} lines: the structural diff stays interactive`, { skip: SKIP }, () => {
  const t0 = performance.now();
  const r = call({ cmd: "ast_diff", a: base, b: edited, filename: "big.ts" });
  const ms = performance.now() - t0;
  assert.ok(r.updates >= 100, `expected the edits to be found: ${r.summary}`);
  assert.ok(ms < 4000, `${Math.round(ms)} ms for ${LINES} lines — the passes went quadratic again`);
});

test(`${LINES} lines: the symbol table stays interactive`, { skip: SKIP }, () => {
  const t0 = performance.now();
  const r = call({ cmd: "symbols", files: [{ path: "big.ts", text: base }] });
  const ms = performance.now() - t0;
  assert.equal(r.definitions.length, LINES);
  assert.ok(ms < 4000, `${Math.round(ms)} ms for ${LINES} symbols — the scan went quadratic again`);
});

test(`${LINES} lines: the semantic diff stays interactive`, { skip: SKIP }, () => {
  const t0 = performance.now();
  const r = call({ cmd: "sem_diff", a: base, b: edited, filename: "big.ts" });
  const ms = performance.now() - t0;
  assert.ok(r.updates >= 100, r.summary);
  assert.ok(ms < 4000, `${Math.round(ms)} ms for ${LINES} lines`);
});
