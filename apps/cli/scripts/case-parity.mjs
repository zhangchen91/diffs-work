/**
 * How close is our engine to the reference suite, on every case the reference suite publishes?
 *
 * `test-cases/reference-cases/` holds the reference suite's suites (plannotator/the reference suite, MIT OR Apache-2.0; licence
 * and provenance in LICENSE-src beside them). `all-cases.json` is every case that states its
 * expectation as a list of operation types — 229 of the 444 published. The other 215 say what they
 * expect in prose or a status word, which no engine can be scored against, so they are not carried
 * here at all; keeping them would only inflate the denominator.
 *
 * Judging is by *operation type*, not by span: that is the question a reviewer asks ("is this a
 * rename?") and the one an engine can be held to without a shared span model.
 *
 *   node scripts/case-parity.mjs [--verbose]
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { compareFiles } from "@diffs/diff-tool";

const ROOT = path.resolve(new URL("../../..", import.meta.url).pathname);
const verbose = process.argv.includes("--verbose");
const DIR = path.join(ROOT, ".scratch-referencecases");

/** Our operation names against the reference suite's. */
const SAME = { move: "moved", insert: "added", delete: "deleted", update: "edited" };

const cases = JSON.parse(readFileSync(path.join(ROOT, "test-cases/reference-cases/all-cases.json"), "utf8"));
mkdirSync(DIR, { recursive: true });

const stats = { total: 0, exact: 0, contains: 0, skipped: 0 };
const misses = [];

for (const c of cases) {
  if (typeof c.old !== "string" || typeof c.new !== "string") {
    stats.skipped += 1;
    continue;
  }
  // `all-cases.json` keeps just the operation types each case expects; the original nested `ops`
  // carried line ranges we do not compare against, and kept the file over the 3 MB repo limit.
  const raw = Array.isArray(c.types) ? c.types : Array.isArray(c.ops) ? c.ops : Array.isArray(c.expect) ? c.expect : [];
  const want = raw.map((o) => (typeof o === "string" ? o : o?.type)).filter(Boolean);
  if (!want.length) {
    stats.skipped += 1;
    continue;
  }
  const ext = (c.file ?? (c.language === "python" ? "x.py" : "x.ts")).split(".").pop();
  const a = path.join(DIR, `a.${ext}`);
  const b = path.join(DIR, `b.${ext}`);
  writeFileSync(a, c.old);
  writeFileSync(b, c.new);

  let ours = new Set();
  try {
    const r = await compareFiles({ old: a, new: b });
    ours = new Set((r.semantic?.hunks ?? []).map((h) => SAME[h.operation] ?? h.operation));
    if (r.extracted) ours.add("extractedFunction");
    if (r.rename) ours.add("renamed");
    if (r.inlined) ours.add("inlinedFunction");
  } catch {
    ours = new Set(["ERROR"]);
  }

  stats.total += 1;
  const wantSet = new Set(want);
  const exact = wantSet.size === ours.size && [...wantSet].every((t) => ours.has(t));
  if (exact) stats.exact += 1;
  if ([...wantSet].every((t) => ours.has(t))) stats.contains += 1;
  else misses.push({ id: c.id, area: c.area, missing: [...wantSet].filter((t) => !ours.has(t)), ours: [...ours] });
}

console.log(`[the reference suite parity] cases judged: ${stats.total} (skipped ${stats.skipped}: no old/new or no ops)`);
console.log(`[the reference suite parity] exact operation set : ${stats.exact} / ${stats.total}`);
console.log(`[the reference suite parity] contains every type : ${stats.contains} / ${stats.total}`);
if (misses.length) {
  const byArea = {};
  for (const m of misses) byArea[m.area] = (byArea[m.area] ?? 0) + 1;
  console.log("[the reference suite parity] misses by area:", JSON.stringify(byArea));
  for (const m of (verbose ? misses : misses.slice(0, 8))) {
    console.log(`   ${m.id} (${m.area}) missing ${m.missing.join(",")} — ours ${m.ours.join(",")}`);
  }
}
