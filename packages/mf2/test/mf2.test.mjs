/**
 * MessageFormat 2 runtime tests. Cases follow the spec examples and the
 * messageformat2 (Python) reference behaviour; see packages/mf2/src/index.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const mf = await import(path.join(HERE, "../.test/bundle.mjs"));

test("pattern message with a variable", () => {
  assert.equal(mf.formatMessage("Hello, {$name}!", { name: "Alice" }), "Hello, Alice!");
});

test("escapes: \\{ \\} \\| \\\\", () => {
  assert.equal(mf.formatMessage("a\\{b\\} \\| {$x}", { x: 1 }), "a{b} | 1");
});

test("missing variable keeps the placeholder and reports", () => {
  const errs = [];
  const out = mf.formatMessage("Hello, {$name}!", {}, { onError: (e) => errs.push(e) });
  assert.equal(out, "Hello, {$name}!");
  assert.equal(errs[0].kind, "resolve");
});

test(":number formats per locale", () => {
  assert.equal(mf.formatMessage("{$n :number}", { n: 1234.5 }, { locale: "en" }), "1,234.5");
  assert.equal(mf.formatMessage("{$n :number}", { n: 1234.5 }, { locale: "zh-CN" }), "1,234.5");
});

test(":integer drops fractions", () => {
  assert.equal(mf.formatMessage("{$n :integer}", { n: 3.7 }, { locale: "en" }), "4");
});

test(":percent and :currency", () => {
  assert.equal(mf.formatMessage("{$p :percent}", { p: 0.42 }, { locale: "en" }), "42%");
  assert.match(mf.formatMessage("{$c :currency currency=CNY}", { c: 88 }, { locale: "zh-CN" }), /¥|CN¥|88/);
});

test(":date / :datetime use Intl", () => {
  const d = new Date("2026-01-05T10:30:00Z");
  assert.match(mf.formatMessage("{$d :date}", { d }, { locale: "en" }), /2026/);
  assert.match(mf.formatMessage("{$d :datetime}", { d }, { locale: "en" }), /2026/);
});

test("plural selection: English one/other", () => {
  const src = ".input {$count :number}\n.match $count\n1 {{You have one review}}\none {{You have {$count} review}}\n*   {{You have {$count} reviews}}";
  assert.equal(mf.formatMessage(src, { count: 1 }, { locale: "en" }), "You have one review");
  // exact numeric key beats the plural keyword
  assert.equal(mf.formatMessage(src, { count: 2 }, { locale: "en" }), "You have 2 reviews");
});

test("plural selection: Chinese has one category (other)", () => {
  const src = ".input {$n :number}\n.match $n\none {{一条}}\n*   {{{$n} 条}}";
  assert.equal(mf.formatMessage(src, { n: 1 }, { locale: "zh-CN" }), "1 条");
  assert.equal(mf.formatMessage(src, { n: 5 }, { locale: "zh-CN" }), "5 条");
});

test("exact numeric variant keys", () => {
  const src = ".input {$n :integer}\n.match $n\n0 {{none}}\n1 {{one item}}\n* {{{$n} items}}";
  assert.equal(mf.formatMessage(src, { n: 0 }, { locale: "en" }), "none");
  assert.equal(mf.formatMessage(src, { n: 1 }, { locale: "en" }), "one item");
  assert.equal(mf.formatMessage(src, { n: 7 }, { locale: "en" }), "7 items");
});

test(":local derives a value from another input", () => {
  const src = ".local $n = {$count :integer}\n.match $n\n1 {{single}}\n* {{{$count} items}}";
  assert.equal(mf.formatMessage(src, { count: 1 }, { locale: "en" }), "single");
});

test("bidi isolation wraps placeholders", () => {
  assert.equal(mf.formatMessage("Hi {$n}!", { n: "x" }, { bidi: true }), "Hi \u2068x\u2069!");
});

test("quoted option literals", () => {
  assert.equal(mf.formatMessage("{$n :number useGrouping=|never|}", { n: 12345 }, { locale: "en" }), "12345");
});

test("unknown function falls back without throwing", () => {
  const errs = [];
  const out = mf.formatMessage("{$x :nope}", { x: 1 }, { onError: (e) => errs.push(e) });
  assert.equal(out, "");
  assert.equal(errs[0].kind, "format");
});

test("a message with no closing brace keeps its text and reports", () => {
  const errs = [];
  const out = mf.formatMessage("unclosed {$x", { x: 1 }, { onError: (e) => errs.push(e) });
  assert.match(out, /unclosed/);
  assert.ok(errs.length >= 1, "an error is reported");
});

test("parseMessage exposes the documented shapes", () => {
  const p = mf.parseMessage("Hi {$n}");
  assert.equal(p.type, "pattern");
  const s = mf.parseMessage(".input {$n :number}\n.match $n\n* {{x}}");
  assert.equal(s.type, "select");
  assert.equal(s.selectors[0], "n");
});
