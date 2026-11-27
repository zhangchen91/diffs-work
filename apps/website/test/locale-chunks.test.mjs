/**
 * Every locale chunk the bundle asks for must exist in the build.
 *
 * The English chunk was missing from one deployment: switching to English rendered raw
 * message keys ("hero.title1") because the dynamic import 404'd. Nothing caught it, because
 * every other test ran in the default locale.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "../out");
const SKIP = existsSync(path.join(OUT, "assets")) ? false : "no build yet: run pnpm build:website";

function entryBundles() {
  return readdirSync(path.join(OUT, "assets")).filter((f) => /^index-.*\.js$/.test(f));
}

test("both locale chunks are in the build", { skip: SKIP }, () => {
  const assets = readdirSync(path.join(OUT, "assets"));
  for (const prefix of ["en-", "zh-CN-"]) {
    assert.ok(
      assets.some((f) => f.startsWith(prefix) && f.endsWith(".js")),
      `missing ${prefix}*.js — the language switch would render raw keys`,
    );
  }
});

test("the bundle references only locale chunks that exist", { skip: SKIP }, () => {
  const assets = readdirSync(path.join(OUT, "assets"));
  for (const bundle of entryBundles()) {
    const src = readFileSync(path.join(OUT, "assets", bundle), "utf8");
    for (const m of src.matchAll(/["'.]\/?(en|zh-CN)-([A-Za-z0-9_-]+)\.js/g)) {
      const file = `${m[1]}-${m[2]}.js`;
      assert.ok(assets.includes(file), `${bundle} imports ${file}, which was not emitted`);
    }
  }
});
