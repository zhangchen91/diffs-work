/**
 * The comparison holds two files in memory; these ceilings keep a 1 GB drop from
 * freezing the tab, and the messages must say what to do instead of "error".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const bundle = await import(path.join(HERE, "../.test/bundle.mjs"));
const { oversizeOf, MAX_TEXT_BYTES, MAX_BINARY_BYTES } = bundle;

test("the ceilings are what the UI documents", () => {
  assert.equal(MAX_TEXT_BYTES, 40 * 1024 * 1024);
  assert.equal(MAX_BINARY_BYTES, 200 * 1024 * 1024);
});

test("text, code and markdown share the 40 MB ceiling", () => {
  for (const name of ["a.md", "b.ts", "c.txt", "d.json"]) {
    assert.equal(oversizeOf(10 * 1024 * 1024, name), null, name);
    assert.equal(oversizeOf(41 * 1024 * 1024, name), "text", name);
  }
});

test("office and pdf get the larger 200 MB ceiling", () => {
  for (const name of ["a.xlsx", "b.docx", "c.pptx", "d.pdf"]) {
    assert.equal(oversizeOf(190 * 1024 * 1024, name), null, name);
    assert.equal(oversizeOf(210 * 1024 * 1024, name), "binary", name);
  }
});
