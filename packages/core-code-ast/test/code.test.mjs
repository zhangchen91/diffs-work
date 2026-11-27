/**
 * Code tokenizer / symbol-diff tests.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const code = await import(path.join(HERE, "../.test/bundle.mjs"));
const { tokenizeLine, languageOf, extractSymbols, diffSource } = code;

test("language detection by extension", () => {
  assert.equal(languageOf("a.ts").id, "typescript");
  assert.equal(languageOf("a.py").id, "python");
  assert.equal(languageOf("a.rs").id, "rust");
  assert.equal(languageOf("a.unknown").id, "text");
});

test("tokenizer separates strings and comments", () => {
  const lang = languageOf("a.ts");
  const toks = tokenizeLine('const s = "a // not a comment"; // real', lang);
  assert.ok(toks.some((t) => t.kind === "string" && t.text === '"a // not a comment"'));
  assert.ok(toks.some((t) => t.kind === "comment" && t.text === "// real"));
  const py = tokenizeLine("# 中文注释", languageOf("a.py"));
  assert.equal(py[0].kind, "comment");
});

test("comment-only change is labelled and counted as noise", () => {
  const a = "// 旧注释\nexport const x = 1;\n";
  const b = "// 新注释\nexport const x = 1;\n";
  const d = diffSource(a, b, "a.ts");
  assert.equal(d.noise.commentOnly, 1);
  assert.equal(d.added, 1);
});

test("string-literal-only change is labelled", () => {
  const a = 'export const msg = "\u65e7\u6587\u6848";\n';
  const b = 'export const msg = "\u65b0\u6587\u6848";\n';
  const d = diffSource(a, b, "a.ts");
  const labels = Object.values(d.hunks[0].labels ?? {});
  assert.ok(labels.length > 0, `labels=${labels.join(",")}`);
});

test("symbols: added / removed / changed", () => {
  const a = "export function a() {}\nexport function b() { return 1 }\n";
  const b = "export function a() {}\nexport function b() { return 2 }\nexport function c() {}\n";
  const d = diffSource(a, b, "a.ts");
  assert.deepEqual(d.symbolsAdded.map((s) => s.name), ["c"]);
  assert.deepEqual(d.symbolsRemoved.map((s) => s.name), []);
  assert.deepEqual(d.symbolsChanged.map((s) => s.name), ["b"]);
});

test("removed function is reported at the symbol level", () => {
  const a = "export function keep() {}\nexport function drop() {}\n";
  const b = "export function keep() {}\n";
  const d = diffSource(a, b, "a.ts");
  assert.deepEqual(d.symbolsRemoved.map((s) => s.name), ["drop"]);
});

test("python / rust / go declarations are recognised", () => {
  assert.deepEqual(extractSymbols(["def run(x):"], languageOf("a.py")).map((s) => s.name), ["run"]);
  assert.deepEqual(extractSymbols(["pub fn scan() {}"], languageOf("a.rs")).map((s) => s.name), ["scan"]);
  assert.deepEqual(extractSymbols(["func Walk() {}"], languageOf("a.go")).map((s) => s.name), ["Walk"]);
});

test("identical files give an empty diff", () => {
  const src = "export const x = 1;\n";
  const d = diffSource(src, src, "a.ts");
  assert.equal(d.hunks.length, 0);
  assert.equal(d.added, 0);
  assert.equal(d.removed, 0);
});