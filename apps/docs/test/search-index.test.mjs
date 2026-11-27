/**
 * The search index must cover every page, in both languages, with text that can be matched.
 *
 * The box filters the index in the browser, so a page missing from it is silently unsearchable —
 * which looks like "the docs do not mention this" rather than "the index is short".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

async function mdxCount(dir) {
  let n = 0;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += await mdxCount(path.join(dir, e.name));
    else if (e.name.endsWith(".mdx")) n += 1;
  }
  return n;
}

test("the index lists every page in every language", async () => {
  const index = JSON.parse(await readFile(path.join(ROOT, "dist/search-index.json"), "utf8"));
  const pages = index.pages;
  assert.ok(Array.isArray(pages) && pages.length > 0, "index is empty");
  const onDisk = await mdxCount(path.join(ROOT, "src/content/docs"));
  assert.equal(pages.length, onDisk, `index has ${pages.length}, ${onDisk} pages on disk`);

  for (const lang of ["zh", "en"]) {
    const mine = pages.filter((p) => p.lang === lang);
    assert.ok(mine.length > 0, `no ${lang} pages indexed`);
    for (const p of mine) {
      assert.ok(p.url.startsWith(lang === "en" ? "/en/" : "/"), `${p.url} is filed under ${lang}`);
      assert.ok(p.title && p.title.length > 0, `${p.url} has no title`);
      assert.ok(p.text.length > 20, `${p.url} has almost no text to search`);
    }
  }
});

test("a page's technical content is findable through the index", async () => {
  const index = JSON.parse(await readFile(path.join(ROOT, "dist/search-index.json"), "utf8"));
  const portable = index.pages.find((p) => p.url === "/en/reference/portable/");
  assert.ok(portable, "the portable@1 page is not indexed");
  assert.match(portable.text + portable.title + portable.description, /maxHunks|hunks/i);
});
