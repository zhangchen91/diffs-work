/**
 * The extension lists must agree across the surfaces and the pages.
 *
 * Four separate tables had drifted: the family record, the syntax map, the Harness plugin, and
 * the formats page. Each drift was invisible until someone tried that file type, so the lists
 * are compared here instead of by hand.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");

/** Pull the keys out of `const EXT_FAMILY: Record<...> = { ... }`. */
function recordKeys(src, marker) {
  const at = src.indexOf(marker);
  assert.ok(at >= 0, `could not find ${marker}`);
  const open = src.indexOf("{", at);
  const close = src.indexOf("\n};", open);
  const body = src.slice(open + 1, close);
  const keys = new Set();
  // keys are `name: "family"`; the value is always a quoted word
  for (const m of body.matchAll(/([A-Za-z0-9_]+)\s*:\s*"[a-z]+"/g)) keys.add(m[1].toLowerCase());
  return keys;
}

test("the family table covers every extension the formats page advertises", async () => {
  const family = await readFile(path.join(ROOT, "packages/dom-utils/src/files.ts"), "utf8");
  const known = recordKeys(family, "const EXT_FAMILY");
  // the site's formats.ts is a re-export now; the table lives in the shared package
  const page = await readFile(path.join(ROOT, "packages/diff-ui/src/lib/formats.ts"), "utf8");
  const m = /id: "code",[\s\S]*?exts: \[([\s\S]*?)\]/.exec(page);
  assert.ok(m, "could not find the code extensions on the formats page");
  const advertised = [...m[1].matchAll(/"\.([A-Za-z0-9]+)"/g)].map((x) => x[1].toLowerCase());
  assert.ok(advertised.length > 20, `only ${advertised.length} advertised`);
  const missing = advertised.filter((e) => !known.has(e));
  assert.deepEqual(missing, [], `the page advertises unknown extensions: ${missing.join(", ")}`);
});

test("the syntax map knows every code extension the family table calls code", async () => {
  const family = await readFile(path.join(ROOT, "packages/dom-utils/src/files.ts"), "utf8");
  const codeExts = new Set();
  const at = family.indexOf("const EXT_FAMILY");
  const body = family.slice(at, family.indexOf("\n};", at));
  for (const line of body.split("\n")) {
    for (const m of line.matchAll(/([A-Za-z0-9_]+)\s*:\s*"code"/g)) codeExts.add(m[1].toLowerCase());
  }
  const syntax = await readFile(path.join(ROOT, "packages/core-code/src/index.ts"), "utf8");
  const byExt = recordKeys(syntax, "const BY_EXT");
  const missing = [...codeExts].filter((e) => !byExt.has(e));
  assert.deepEqual(missing, [], `no syntax entry for: ${missing.join(", ")}`);
});
