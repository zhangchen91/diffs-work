#!/usr/bin/env node
/**
 * Verify every sample renders — one fresh page per sample.
 *
 * The combined harness lands all six samples on a single page, so each one inherits the
 * previous one's state (the change list, the grid, a pending run). That produced failures
 * that disappeared the moment the sample was opened on its own, and the workarounds (clear,
 * wait, re-click) only moved the problem. A page per sample has no shared state at all.
 *
 *   node scripts/test-samples-online.mjs [base-url]
 */
import { spawnSync } from "node:child_process";

const BASE = (process.argv[2] ?? "https://diffs-work.pages.dev").replace(/\/$/, "");
// the site is bilingual: match the label in either language
const SAMPLES = [
  ["Code", /^(Code\b|代码)/i, "code:"],
  ["Rust", /^Rust\b/i, "code:"],
  ["README", /^README\b/i, "markdown:"],
  ["Excel", /^Excel\b/i, "xlsx:"],
  ["Word", /^Word\b/i, "opc:"],
  ["PPT", /^PPT\b/i, "opc:"],
  ["PDF", /^PDF\b/i, "pdf:"],
];

const script = `
const task = await taskSpace("samples:" + Date.now());
const results = [];
const base = ${JSON.stringify(BASE)};
const samples = ${JSON.stringify(SAMPLES.map(([n, src]) => [n, src.source]))};
for (const [name, pattern] of samples) {
  const page = await task.newPage();
  let entry = { name, key: null, error: null };
  try {
    await page.goto(base + "/#/compare", { timeout: 90000 });
    await page.waitForTimeout(4000);
    const clicked = await page.evaluate((src) => {
      const re = new RegExp(src);
      const btn = [...document.querySelectorAll("button[title]")].find((b) => re.test((b.textContent || "").trim()));
      if (!btn) return false;
      btn.click();
      return true;
    }, pattern);
    if (!clicked) { entry.error = "sample chip not found"; results.push(entry); continue; }
    // 60 × 500ms = 30s was not enough for the PDF sample: the first run downloads pdf.js
    // (1.4 MB) and renders four pages, which measured 6s locally but slower over the network
    for (let i = 0; i < 120; i++) {
      await page.waitForTimeout(500);
      const k = await page.evaluate(() => document.querySelector('[data-testid="result-key"]')?.textContent ?? "");
      if (k && k !== "empty") { entry.key = k; break; }
    }
    if (!entry.key) entry.error = "no result within 60s";
  } catch (e) {
    entry.error = String(e).slice(0, 80);
  }
  results.push(entry);
}
console.log("SAMPLES " + JSON.stringify(results));
await task.finish({ keep: [] });
`;

const run = spawnSync("ego-browser", ["nodejs"], { input: script, encoding: "utf8" });
// ego prefixes its own logging; take everything after the marker on its line
// ego prints its own progress on stdout and the page's console on stderr (or vice versa
// depending on version), so search both
const out = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
const at = out.lastIndexOf("SAMPLES ");
if (at < 0) {
  console.error(out || run.stderr || "no output from ego");
  process.exit(1);
}
const line = out.slice(at);
let rows;
try {
  rows = JSON.parse(line.slice("SAMPLES ".length).trim());
} catch (e) {
  console.error(`could not read the result: ${e.message}\n${line.slice(0, 200)}`);
  process.exit(1);
}
let failed = 0;
for (const r of rows) {
  if (r.error) {
    console.error(`✖ ${r.name.padEnd(8)} ${r.error}`);
    failed++;
  } else {
    console.log(`✔ ${r.name.padEnd(8)} ${r.key.slice(0, 40)}`);
  }
}
console.log(`\n${SAMPLES.length - failed}/${SAMPLES.length} samples render on ${BASE}`);
process.exit(failed ? 1 : 0);
