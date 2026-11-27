/**
 * Every message key the site asks for must exist, in both languages.
 *
 * A missing key does not throw — `t()` returns the key itself, so the UI quietly displays
 * `compare.rustFailed` where a sentence belongs. That shipped once; this keeps the two bundles
 * honest against the code.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");

function keysOf(src) {
  return new Set([...src.matchAll(/^  "([a-zA-Z][\w.]*)":/gm)].map((m) => m[1]));
}

async function sources(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await sources(p)));
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const read = (f) => readFile(f, "utf8");

test("both languages define exactly the same keys", async () => {
  const zh = keysOf(await read(path.join(ROOT, "packages/i18n/src/messages/zh-CN.ts")));
  const en = keysOf(await read(path.join(ROOT, "packages/i18n/src/messages/en.ts")));
  const onlyZh = [...zh].filter((k) => !en.has(k));
  const onlyEn = [...en].filter((k) => !zh.has(k));
  assert.deepEqual(onlyZh, [], `only in zh: ${onlyZh.join(", ")}`);
  assert.deepEqual(onlyEn, [], `only in en: ${onlyEn.join(", ")}`);
  assert.ok(zh.size > 400, `only ${zh.size} keys — did the bundles get truncated?`);
});

test("every key the site uses is defined", async () => {
  const zh = keysOf(await read(path.join(ROOT, "packages/i18n/src/messages/zh-CN.ts")));
  const files = await sources(path.join(ROOT, "apps/website/src"));
  const used = new Map();
  for (const f of files) {
    const body = await read(f);
    for (const m of body.matchAll(/(?:^|[^\w.])t\(\s*"([a-zA-Z][\w.]*)"/g)) used.set(m[1], path.basename(f));
    for (const m of body.matchAll(/setError\(\s*"([a-zA-Z][\w.]*)"/g)) used.set(m[1], path.basename(f));
  }
  const missing = [...used].filter(([k]) => !zh.has(k) && !k.endsWith("."));
  assert.deepEqual(
    missing.map(([k, f]) => `${k} (${f})`),
    [],
    "the UI would render these keys verbatim",
  );
});
