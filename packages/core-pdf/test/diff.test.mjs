/**
 * PDF object-level diff, exercised on the two fixtures the site ships.
 *
 * pdf.js needs a DOM-ish environment; the text layer is read through the same
 * code path, so the test stubs only what `loadPdfjs()` touches: a global that
 * resolves the real pdfjs build from `public/engine/pdfjs`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");

// pdf.js is a build input (gitignored, fetched by `pnpm sync:engine`). Without it the
// kernel cannot run, so the suite skips instead of failing a fresh clone or CI run.
const PDFJS = path.join(ROOT, "apps/website/public/engine/pdfjs/pdf.mjs");
const ENGINE = path.join(ROOT, "apps/website/public/engine/rules-core/diffs-engine.wasm");
const hasEngines = existsSync(PDFJS) && existsSync(ENGINE) && existsSync(path.join(HERE, "../.test/bundle.mjs"));
const skip = hasEngines ? false : "engines not available (run pnpm sync:engine / pnpm build:rules)";
const pdfjs = hasEngines ? await import(PDFJS) : null;

globalThis.window = globalThis;
globalThis.location = { origin: "http://local" };
globalThis.window.__BRV_PDFJS_BASE__ = `file://${path.join(ROOT, "apps/website/public/engine/pdfjs")}/`;
if (pdfjs) {
  pdfjs.GlobalWorkerOptions.workerSrc = `file://${path.join(ROOT, "apps/website/public/engine/pdfjs/pdf.worker.min.mjs")}`;
}

let diffPdf = null;
if (hasEngines) {
  try {
    ({ diffPdf } = await import(path.join(HERE, "../.test/bundle.mjs")));
  } catch {
    diffPdf = null;
  }
}

const buf = (f) => {
  const b = readFileSync(path.join(ROOT, "examples", f));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

test("reads the CJK text layer of the fixtures", { skip }, async () => {
  const d = await diffPdf(buf("pdf/nda-v1.pdf"), buf("pdf/nda-v2.pdf"));
  assert.equal(d.pages, 1);
  const texts = d.rows.map((r) => r.new?.text ?? r.old?.text ?? "").join("\n");
  assert.ok(texts.includes("保密协议"), "Chinese text survives the text layer");
  assert.deepEqual(d.emptyPages, [], "both files have a text layer");
});

test("finds the real edits, not a whole-page rewrite", { skip }, async () => {
  const d = await diffPdf(buf("pdf/nda-v1.pdf"), buf("pdf/nda-v2.pdf"));
  assert.ok(d.changed >= 3 && d.changed <= 12, `changed=${d.changed}`);
  assert.equal(d.added + d.removed + d.changed, d.rows.filter((r) => r.op !== "equal").length);
  const joined = d.rows.filter((r) => r.op !== "equal").map((r) => (r.new ?? r.old).text).join("\n");
  assert.ok(joined.includes("五年"), "the new 保密期限 is reported");
  assert.ok(joined.includes("客户名单"), "the added clause text is reported");
});

test("changed lines keep their character rectangles", { skip }, async () => {
  const d = await diffPdf(buf("pdf/nda-v1.pdf"), buf("pdf/nda-v2.pdf"));
  const changed = d.rows.filter((r) => r.op !== "equal");
  assert.ok(changed.length > 0);
  for (const r of changed) {
    const line = r.new ?? r.old;
    assert.ok(line && line.rects.length >= 1, "each line has at least one rect");
    assert.ok(line.rects.every((x) => x.w > 0 && x.h > 0), "rects have a size");
  }
  // word-level inline segments exist for modified rows
  assert.ok(changed.filter((r) => r.op === "changed").every((r) => Array.isArray(r.inline)));
});

test("a file compared with itself has no changes", { skip }, async () => {
  const d = await diffPdf(buf("pdf/nda-v1.pdf"), buf("pdf/nda-v1.pdf"));
  assert.equal(d.added + d.removed + d.changed, 0);
  assert.ok(d.rows.every((r) => r.op === "equal"));
});
