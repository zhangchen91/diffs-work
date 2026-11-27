/**
 * The kernel's JSON contract, checked against the shipped wasm.
 *
 * The Rust source is not in the repository (see ENGINE-LICENSE.md), and CI cannot compile
 * it. That makes this file the only automated guard on the binary: if a command stops
 * returning a field the UI reads, this fails instead of the site breaking silently.
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
const bundle = await import(path.join(HERE, "../../.test/bundle.mjs"));
const ex = (() => {
  if (SKIP) return null;
  return new WebAssembly.Instance(new WebAssembly.Module(readFileSync(WASM)), {}).exports;
})();
const b64 = (rel) => readFileSync(path.join(ROOT, rel)).toString("base64");

function call(req) {
  const bytes = new TextEncoder().encode(JSON.stringify(req));
  const p = ex.diffs_alloc(bytes.length);
  new Uint8Array(ex.memory.buffer, p, bytes.length).set(bytes);
  const out = ex.diffs_handle(p, bytes.length);
  const len = ex.diffs_box_len(out);
  const text = new TextDecoder().decode(new Uint8Array(ex.memory.buffer, out + 4, len));
  ex.diffs_free(out, len + 4);
  ex.diffs_free(p, bytes.length);
  return JSON.parse(text);
}

test("sheet_diff returns the sheet list, totals and column widths", { skip: SKIP }, () => {
  const r = call({
    cmd: "sheet_diff",
    a: b64("examples/sheets/checklist-B3.xlsx"),
    b: b64("examples/sheets/checklist-B4.xlsx"),
  });
  assert.ok(Array.isArray(r.sheets) && r.sheets.length > 0, "no sheets");
  assert.ok(r.totals && typeof r.totals.added === "number", "no totals.added");
  const s = r.sheets[0];
  // The view sizes each column from this; without it every column falls back to one guess.
  assert.ok(Array.isArray(s.colWidths), "no colWidths on the sheet");
  for (const c of s.colWidths) {
    assert.equal(typeof c.c, "number", "colWidths entry without c");
    assert.equal(typeof c.w, "number", "colWidths entry without w");
    assert.ok(c.w > 0, `col ${c.c} has width ${c.w}`);
  }
  assert.ok(s.colWidths.length > 0, "colWidths is empty for a sheet that has columns");
});

test("opc_diff returns revisions with part, kind and text", { skip: SKIP }, () => {
  const r = call({
    cmd: "opc_diff",
    kind: "docx",
    a: b64("examples/docx/contract-v1.docx"),
    b: b64("examples/docx/contract-v2.docx"),
  });
  assert.ok(Array.isArray(r.revisions) && r.revisions.length > 0, "no revisions");
  const rev = r.revisions[0];
  assert.equal(typeof rev.part, "string");
  assert.equal(typeof rev.kind, "string");
  assert.ok("old" in rev || "new" in rev, "a revision with neither side");
});

test("sem_diff and ast_diff keep the shapes the views read", { skip: SKIP }, () => {
  const a = "export function f(x: number) { return x + 1; }\n";
  const b = "export function f(x: number) { return x - 1; }\n";
  const sem = call({ cmd: "sem_diff", a, b, filename: "a.ts" });
  assert.ok(Array.isArray(sem.hunks), "sem_diff.hunks is not an array");
  assert.ok(typeof sem.updates === "number", "sem_diff.updates missing");
  assert.ok(Array.isArray(sem.moveBlocks), "sem_diff.moveBlocks missing");
  const ast = call({ cmd: "ast_diff", a, b, filename: "a.ts" });
  assert.ok(ast.after && Array.isArray(ast.after.hunks), "ast_diff.after.hunks missing");
  assert.ok(ast.after.hunks[0].range, "an AST hunk without a range");
});

test("the language table answers for every extension the UI accepts", { skip: SKIP }, () => {
  const cases = [
    ["ts", "typescript"], ["py", "python"], ["rs", "rust"], ["go", "go"],
    ["java", "java"], ["c", "c"], ["rb", "ruby"], ["php", "php"],
    ["swift", "swift"], ["scala", "scala"], ["yaml", "yaml"], ["toml", "toml"], ["xml", "xml"],
  ];
  for (const [ext, lang] of cases) {
    const r = call({ cmd: "ast_diff", a: "x\ny\n", b: "x\nz\n", filename: `f.${ext}` });
    assert.notEqual(r.language, "text", `.${ext} is not recognised (reported ${r.language})`);
  }
});

test("legacy office binaries are named, not diffed as empty packages", { skip: SKIP }, () => {
  // .doc/.xls/.ppt are OLE2/BIFF. Handed to the kernel as a zip they yield "0 parts",
  // which reads as "no changes" — the most misleading answer available. The UI routes them
  // to their own family so it can explain instead.
  const { familyOf } = bundle;
  for (const name of ["a.doc", "b.xls", "c.ppt"]) {
    assert.equal(familyOf(name), "legacy-office", `${name} is not recognised as legacy`);
  }
  for (const name of ["a.docx", "b.xlsx", "c.pptx"]) {
    assert.notEqual(familyOf(name), "legacy-office", `${name} should stay supported`);
  }
});

test("a removed function is counted as deletions, not zero", { skip: SKIP }, () => {
  // The count was taken from the *new* side, where a deleted function has no rows at all,
  // so removing a whole function reported "0 delete". Verified on the Rust pair, where
  // legacy_fee exists only in v1.
  const a = readFileSync(path.join(ROOT, "examples/code/ledger-v1.rs"), "utf8");
  const b = readFileSync(path.join(ROOT, "examples/code/ledger-v2.rs"), "utf8");
  const r = call({ cmd: "ast_diff", a, b, filename: "ledger.rs" });
  assert.ok(r.deletes > 0, `a removed function reported ${r.deletes} deletions`);
  const removed = (r.before.hunks || []).filter((h) => h.operation === "delete");
  assert.ok(removed.length > 0, "no delete hunks on the old side");
});
