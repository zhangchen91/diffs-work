/**
 * Smoke test for the TS reference diff (the contract the Rust wasm engine must
 * match). Node cannot follow `workspace:` specifiers, so the three source
 * packages are bundled on the fly with esbuild and then exercised.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const outfile = path.join(ROOT, "node_modules/.cache/diff-core-test.mjs");

await build({
  stdin: {
    contents: [
      'export * from "./packages/diff-core/src/index.ts";',
      'export * from "./packages/core-text/src/index.ts";',
      'export * from "./packages/core-code/src/index.ts";',
    ].join("\n"),
    resolveDir: ROOT,
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  outfile,
  logLevel: "error",
});

const ns = await import(pathToFileURL(outfile).href);
const core = ns;   // toUnified / hunk helpers
const text = ns;   // diffText / normalizeText
const code = ns;   // diffCode / extractSymbols

const cases = [];
function check(name, fn) {
  try {
    fn();
    cases.push([name, true]);
  } catch (e) {
    cases.push([name, false, e instanceof Error ? e.message : String(e)]);
  }
}

check("identical text → 0 hunks", () => {
  assert.equal(text.diffText("a\nb\nc", "a\nb\nc").hunks.length, 0);
});

check("one line changed → 1 hunk, +1/-1", () => {
  const r = text.diffText("a\nb\nc", "a\nB\nc");
  assert.equal(r.hunks.length, 1);
  assert.equal(r.added, 1);
  assert.equal(r.removed, 1);
});

check("CRLF normalized", () => {
  assert.equal(text.diffText("a\r\nb", "a\nb").hunks.length, 0);
});

check("insert-only", () => {
  const r = text.diffText("a\nc", "a\nb\nc");
  assert.equal(r.added, 1);
  assert.equal(r.removed, 0);
});

check("code symbols detected", () => {
  const r = code.diffCode("export function a(){}\n", "export function a(){}\nexport function b(){}\n", "x.ts");
  assert.equal(r.kind, "code");
  assert.ok(r.symbols.added.includes("b"));
});

check("inline word diff is produced for changed lines", () => {
  const r = text.diffText("股权价格 8%\n", "股权价格 10%\n");
  const segs = Object.values(r.inline)[0];
  assert.ok(segs && segs.some((s) => s.op === "insert"));
});

check("unified output header", () => {
  const u = core.toUnified(["a", "b"], ["a", "c"], "f");
  assert.ok(u.startsWith("--- f.old\n+++ f.new"));
  assert.match(u, /^@@ /m);
});

let failed = 0;
for (const [name, ok, msg] of cases) {
  console.log(`${ok ? "✓" : "✗"} ${name}${msg ? ` — ${msg}` : ""}`);
  if (!ok) failed++;
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
