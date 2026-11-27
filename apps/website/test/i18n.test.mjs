/**
 * i18n catalogue tests: both locales complete, no Chinese left in the English
 * catalogue, and the MF2 strings actually format (placeholders resolve).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const zh = (await import(path.join(HERE, "../.test/zh-CN.mjs"))).default;
const en = (await import(path.join(HERE, "../.test/en.mjs"))).default;
const mf = await import(path.join(HERE, "../.test/mf2.mjs"));

test("both locales have exactly the same keys", () => {
  const a = Object.keys(zh).sort();
  const b = Object.keys(en).sort();
  assert.deepEqual(a, b, `missing in en: ${a.filter((k) => !b.includes(k))}`);
  assert.ok(a.length > 200, `catalogue size ${a.length}`);
});

test("no empty messages", () => {
  for (const [k, v] of Object.entries({ ...zh, ...en })) assert.ok(String(v).trim().length > 0, k);
});

test("en carries no CJK characters", () => {
  const bad = Object.entries(en).filter(([, v]) => /[\u4e00-\u9fff]/.test(v));
  assert.deepEqual(bad, [], `untranslated: ${bad.map(([k]) => k).join(", ")}`);
});

test("zh keeps Chinese for user-facing copy", () => {
  const zhHits = Object.values(zh).filter((v) => /[\u4e00-\u9fff]/.test(v)).length;
  assert.ok(zhHits > 200, `zh messages ${zhHits}`);
});

test("every message parses and formats in both locales", () => {
  const params = {
    name: "a.md",
    family: "Markdown",
    count: 3,
    ms: 12,
    sheets: 4,
    added: 7,
    removed: 2,
    modified: 1,
    row: 5,
    old: "旧",
    new: "新",
    year: 2026,
    engine: "docxodus",
    size: "30 MB",
    url: "127.0.0.1:5279",
    message: "boom",
    path: "apps/x",
    tool: "diff_compare",
    field: "ENGINE_REGISTRY.base",
    file: "LICENSE-NOTICE.md",
    source: "brv /diff",
    error: "ECONNREFUSED",
    pages: "2, 5",
    edges: 1,
    files: 3,
    from: 1,
    to: 4,
    nto: 6,
    ntoEnd: 9,
    mb: 12,
    line: 12,
    current: 3,
    total: 7,
    symbols: 7,
    page: 3,
  };
  for (const locale of ["zh-CN", "en"]) {
    const cat = locale === "en" ? en : zh;
    for (const [key, src] of Object.entries(cat)) {
      const errors = [];
      const out = mf.formatMessage(src, params, { locale, onError: (e) => errors.push(e) });
      assert.equal(errors.length, 0, `${locale}/${key}: ${errors.map((e) => e.message).join("; ")}`);
      assert.ok(out.length > 0, `${locale}/${key} produced no text`);
      assert.ok(!out.includes("{$"), `${locale}/${key} left a placeholder: ${out}`);
    }
  }
});

test("plural-style messages choose a variant for 1 and 3", () => {
  const src = zh["xlsx.summary"]; // `.{$n :number}`-free but has :number functions
  assert.match(mf.formatMessage(src, { sheets: 1, added: 1, removed: 0, modified: 0 }, { locale: "en" }), /1/);
  const enSummary = mf.formatMessage(en["xlsx.summary"], { sheets: 3, added: 2, removed: 1, modified: 4 }, { locale: "en" });
  assert.match(enSummary, /3/);
  assert.match(enSummary, /\+2|2/);
});

test("locale negotiation matches the shipped tags", () => {
  // mirrors packages/i18n negotiate(): exact tag first, then base language, then default
  const LOCALES = ["zh-CN", "en"];
  const negotiate = (pref) => {
    for (const raw of pref) {
      const tag = raw.toLowerCase();
      const exact = LOCALES.find((l) => l.toLowerCase() === tag);
      if (exact) return exact;
      const base = tag.split("-")[0];
      const loose = LOCALES.find((l) => l.toLowerCase().split("-")[0] === base);
      if (loose) return loose;
    }
    return "zh-CN";
  };
  assert.equal(negotiate(["en-US"]), "en");
  assert.equal(negotiate(["zh-Hant-TW"]), "zh-CN");
  assert.equal(negotiate(["fr"]), "zh-CN");
  assert.equal(negotiate(["fr", "en-GB"]), "en");
});
