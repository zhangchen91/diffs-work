/**
 * Performance on real source code, not a synthetic file.
 *
 * The earlier perf test used 3000 identical one-line functions. That shape has almost no
 * duplicate rows, so move detection had nothing to chew on and the numbers looked fine — a
 * real 1170-line Rust file took 3.2 s for the same single-word edit. These cases use this
 * repository's own sources, which have the `}` / blank-line / `pub fn` repetition that
 * real code has.
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

const SOURCES = [
  ["rust", "apps/engine-core/src/semdiff.rs"],
  ["ts", "apps/website/src/components/compare/studio.tsx"],
];

for (const [lang, file] of SOURCES) {
  const full = path.join(ROOT, file);
  const skip = SKIP || !existsSync(full) ? "source not available" : false;

  test(`${lang}: one edit in ${path.basename(file)} stays well under a second`, { skip }, () => {
    const a = readFileSync(full, "utf8");
    const b = a.replace(/\b1\b/, "2");
    const t0 = performance.now();
    const sem = call({ cmd: "sem_diff", a, b, filename: path.basename(file) });
    const ms = performance.now() - t0;
    assert.ok(sem.updates >= 1, `no change found: ${sem.summary}`);
    // Generous on purpose: this catches a return to quadratic behaviour (seconds per edit),
    // not a slow CI box. On an idle machine the same edit takes ~170 ms here; under a
    // loaded one it has measured 1.2 s with the algorithm unchanged.
    assert.ok(ms < 2500, `${Math.round(ms)} ms for a one-token edit in ${file}`);
  });

  test(`${lang}: an unchanged ${path.basename(file)} is effectively instant`, { skip }, () => {
    const a = readFileSync(full, "utf8");
    const t0 = performance.now();
    const sem = call({ cmd: "sem_diff", a, b: a, filename: path.basename(file) });
    const ms = performance.now() - t0;
    assert.equal(sem.updates + sem.inserts + sem.deletes + sem.moves, 0, sem.summary);
    assert.ok(ms < 200, `${Math.round(ms)} ms for an unchanged file`);
  });
}
