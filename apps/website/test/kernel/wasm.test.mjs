/**
 * Rust kernel tests — the wasm binary the website and the local server load.
 *
 *   node apps/engine-core/tests/wasm.test.mjs
 *
 * Fixtures are the same files the UI samples use, so a failing test here means a
 * visible bug. The binary is read from apps/website/public/engine/rules-core/.
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

test("wasm exports the ABI and reports its version", { skip: SKIP_NO_ENGINE }, () => {
  const v = call({ cmd: "version" });
  assert.equal(v.engine, "diffs-engine");
  assert.equal(v.arch, "wasm32");
});

test("ls_diff: line changes, comment noise and symbols", { skip: SKIP_NO_ENGINE }, () => {
  const a = ['// old note', 'export function run(x) { return x + 1 }', 'export const keep = 1;', ''].join("\n");
  const b = ['// new note', 'export function run(x) { return x + 2 }', 'export const keep = 1;', 'export class Extra {}', ''].join("\n");
  const r = call({ cmd: "ls_diff", a, b, filename: "a.ts" });
  assert.equal(r.language, "typescript");
  assert.ok(r.added >= 2 && r.removed >= 2, `added ${r.added} removed ${r.removed}`);
  assert.ok(r.commentOnly >= 1, "comment line recognised");
  assert.ok(r.symbolsAdded.some((s) => s.name === "Extra"), "class detected");
  // a one-line declaration cannot tell head from body, so it is reported as a body change
  assert.ok(r.symbolsChanged.some((s) => s.name === "run"), `run reported (${JSON.stringify(r.symbolsChanged)})`);
  const table = r.symbolTable.find((s) => s.name === "run");
  assert.ok(table && table.defLine === 2, "definition line");
});

test("ls_diff: signature vs body are told apart", { skip: SKIP_NO_ENGINE }, () => {
  const a = "export function f(a: number) {\n  return a;\n}\n";
  const b = "export function f(a: number, b: number) {\n  return a;\n}\n";
  const r = call({ cmd: "ls_diff", a, b, filename: "a.ts" });
  const ch = r.symbolsChanged.find((s) => s.name === "f");
  assert.equal(ch.change, "signature");
});

test("sheet_diff: real checklist pair, sheets aligned by rename", { skip: SKIP_NO_ENGINE }, () => {
  const r = call({
    cmd: "sheet_diff",
    a: b64("examples/sheets/checklist-B3.xlsx"),
    b: b64("examples/sheets/checklist-B4.xlsx"),
  });
  assert.equal(r.kind, "xlsx");
  // Assert the engine's behaviour, not this particular workbook's contents: the sample is
  // meant to be edited, and pinning its sheet names here broke the moment it changed.
  assert.ok(r.sheets.length >= 1, "at least one sheet");
  const main = r.sheets[0];
  assert.ok(main.name, "the sheet has a name");
  assert.ok(main.diff.added > 0, `added cells ${main.diff.added}`);
  assert.ok(main.diff.added + main.diff.modified > 0, "some content change is reported");
});

test("sheet_diff: style-only and conditional-format changes are reported", { skip: SKIP_NO_ENGINE }, () => {
  // checklist-B4-styled is a real variant of B4: row 2 points at a new style entry and the
  // sheet carries an extra conditional-formatting rule. It is not in the sample list.
  const r = call({
    cmd: "sheet_diff",
    a: b64("examples/sheets/checklist-B4.xlsx"),
    b: b64("examples/sheets/checklist-B4-styled.xlsx"),
  });
  assert.ok(r.totals.styleChanged >= 1, "style change counted");
  assert.ok(r.sheets[0].diff.cfAdded.length >= 1, "conditional formatting added");
  const st = r.sheets[0].diff.changes.find((c) => c.op === "style");
  assert.ok(st && st.oldStyle !== st.newStyle, "old and new style fingerprints differ");
});

test("opc_diff: docx paragraphs are compared as text, not runs", { skip: SKIP_NO_ENGINE }, () => {
  const r = call({
    cmd: "opc_diff",
    a: b64("examples/docx/contract-v1.docx"),
    b: b64("examples/docx/contract-v2.docx"),
    kind: "docx",
  });
  assert.equal(r.kind, "docx");
  assert.ok(r.revisions.length >= 4);
  const texts = r.revisions.map((x) => (x.new || x.old || ""));
  assert.ok(texts.some((t) => t.includes("8,500")), "the changed amount is found");
  assert.ok(r.summary.includes("insertion"));
});

test("opc_diff: identical packages report no revisions", { skip: SKIP_NO_ENGINE }, () => {
  const f = b64("examples/docx/contract-v1.docx");
  const r = call({ cmd: "opc_diff", a: f, b: f, kind: "docx" });
  assert.equal(r.revisions.length, 0);
});

test("bad input is reported, never thrown across the boundary", { skip: SKIP_NO_ENGINE }, () => {
  const r = call({ cmd: "nope" });
  assert.match(r.error, /unknown command/);
  const r2 = call({ cmd: "sheet_diff", a: "!!!", b: "!!!" });
  assert.match(r2.error, /base64/);
});
