/**
 * The website and the CLI must answer the same family for the same extension.
 *
 * They keep separate tables. When those drift, `a.doc` is "an old binary we cannot read" on the
 * site and "docx, open the local viewer" in the CLI — and the local viewer cannot read it either.
 * A `.svg` was code in one and unrecognised in the other.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function table(src, name) {
  const i = src.indexOf(name);
  assert.ok(i >= 0, `${name} not found`);
  const block = src.slice(i, src.indexOf("};", i));
  const m = new Map();
  for (const x of block.matchAll(/([a-z0-9]+):\s*"([a-z-]+)"/g)) m.set(x[1], x[2]);
  return m;
}

test("the website and the CLI agree on every extension", async () => {
  const web = table(await readFile(path.join(ROOT, "packages/diff-ui/src/lib/formats.ts"), "utf8"), "const EXT_TO_FAMILY");
  const cli = table(await readFile(path.join(ROOT, "packages/dom-utils/src/files.ts"), "utf8"), "const EXT_FAMILY");
  assert.ok(web.size > 60 && cli.size > 60, `tables look short: ${web.size}/${cli.size}`);

  const diffs = [];
  for (const [ext, fam] of web) {
    if (!cli.has(ext)) diffs.push(`${ext}: website=${fam}, CLI=none`);
    else if (cli.get(ext) !== fam) diffs.push(`${ext}: website=${fam}, CLI=${cli.get(ext)}`);
  }
  for (const [ext, fam] of cli) if (!web.has(ext)) diffs.push(`${ext}: website=none, CLI=${fam}`);
  assert.deepEqual(diffs, [], `the two surfaces disagree:\n  ${diffs.join("\n  ")}`);
});

test("pre-2007 binaries are their own family, not a variant of docx", async () => {
  const cli = table(await readFile(path.join(ROOT, "packages/dom-utils/src/files.ts"), "utf8"), "const EXT_FAMILY");
  for (const ext of ["doc", "xls", "ppt"]) {
    assert.equal(cli.get(ext), "legacy-office", `.${ext} is mapped to ${cli.get(ext)}`);
  }
});

test("an unknown extension is plain text on every surface", async () => {
  // The website fell back to `text` and the CLI to `unknown`, which is not a text family — so the
  // same `.zzz` file was comparable in the browser and "needs a WASM renderer" on the command
  // line. Both now treat an unrecognised extension as text, which is the one answer that can be
  // wrong for at most one file.
  const { familyOf } = await import(path.join(ROOT, "packages/dom-utils/src/files.ts"));
  assert.equal(familyOf("mystery.zzz"), "text");
  assert.equal(familyOf("noext"), "text");
  // Check the behaviour in the shared module, not the text of a file: `apps/*/lib/formats.ts`
  // are re-exports now, and matching source strings only tested that the string was still spelled
  // the same way.
  const shared = await readFile(path.join(ROOT, "packages/diff-ui/src/lib/formats.ts"), "utf8");
  assert.match(shared, /EXT_TO_FAMILY\[ext\] \?\? "text"/, "the shared fallback changed");
  const webFamily = await import(path.join(ROOT, "packages/diff-ui/src/lib/formats.ts"));
  assert.equal(webFamily.familyOf("mystery.zzz"), "text");
  assert.equal(webFamily.familyOf("noext"), "text");
});

test("the families the docs promise are the families the code produces", async () => {
  // The parity test above compares the two tables with each other, so deleting an entry from
  // *both* would keep it green — which is exactly what a careless edit to the shared source does.
  // This one checks against what the product says, not against itself.
  const { familyOf } = await import(path.join(ROOT, "packages/dom-utils/src/files.ts"));
  const expected = {
    // code
    "a.ts": "code", "a.py": "code", "a.rs": "code", "a.go": "code", "a.java": "code",
    // markdown / text
    "a.md": "markdown", "a.mdx": "markdown", "a.txt": "text", "a.csv": "csv", "a.tsv": "csv", "a.json": "text",
    // a drawing is its own family: the elements carry ids and coordinates
    "a.svg": "svg",
    // Office
    "a.docx": "docx", "a.xlsx": "xlsx", "a.pptx": "pptx",
    // PDF
    "a.pdf": "pdf",
    // pre-2007 binaries: the site cannot read them, and says so
    "a.doc": "legacy-office", "a.xls": "legacy-office", "a.ppt": "legacy-office",
    // unknown extensions are plain text, never a refusal
    "a.zzz": "text", noext: "text",
  };
  for (const [file, fam] of Object.entries(expected)) {
    assert.equal(familyOf(file), fam, `${file} is ${familyOf(file)}, the product promises ${fam}`);
  }
});
