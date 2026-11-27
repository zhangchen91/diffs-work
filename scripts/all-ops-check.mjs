// Computes the "plain line diff" and the "entity diff" for every all-ops fixture pair,
// and checks them against test-cases/all-ops/expected.json.
// Run: node scripts/all-ops-check.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const dir = path.join(root, "test-cases/all-ops");
// Resolve from the repository, not from a path on one machine: the absolute path that used to be
// here pointed at a local node install, so the check worked here and failed — silently, since the
// step discarded stderr — on every other machine, including CI.
// `exceljs` and `jszip` were never declared dependencies — they resolved against a global install
// on one machine. `fflate` ships with the workspace already, and zlib-free unzip is all these
// extractors ever needed.
const req = createRequire(path.join(root, "packages/core-xlsx/package.json"));
const { unzipSync, strFromU8 } = req("fflate");

/** Read every entry of a zip as text, keyed by path. */
function unzipText(buf) {
  const files = unzipSync(new Uint8Array(buf));
  return { files, text: (name) => (files[name] ? strFromU8(files[name]) : null), has: (name) => !!files[name] };
}
const pdfjs = await import(pathToFileURL(path.join(root, "apps/website/public/engine/pdfjs/pdf.mjs")).href);
// pdf.js defaults `workerSrc` to `./pdf.worker.mjs`; the shipped build is `pdf.worker.min.mjs`, so
// without this every pdf extraction fails and the case aborts before a verdict is printed.
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(root, "apps/website/public/engine/pdfjs/pdf.worker.min.mjs")).href;

// ---------- text extraction (one string per line / unit) ----------
const readText = (f) => fs.readFileSync(path.join(dir, f), "utf8");

async function extractPdfLines(file) {
  // pdf.js looks for `pdf.worker.mjs` next to itself; the shipped build is `pdf.worker.min.mjs`,
  // so without this it fails to set up its fake worker and the whole case aborts.
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(path.join(dir, file))) }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await (await doc.getPage(p)).getTextContent();
    let line = null, y = null;
    for (const it of page.items) {
      if (!it.str) continue;
      const iy = Math.round(it.transform[5]);
      if (y === null || iy !== y) { if (line !== null) out.push(line.trim()); line = ""; y = iy; }
      line += it.str;
    }
    if (line !== null) out.push(line.trim());
  }
  return out.filter(Boolean);
}

async function extractXlsxRows(file) {
  const z = unzipText(fs.readFileSync(path.join(dir, file)));
  // shared strings, in index order
  const ss = [];
  const shared = z.text("xl/sharedStrings.xml") ?? "";
  for (const m of shared.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    ss.push([...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join(""));
  }
  const sheetName = Object.keys(z.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
  const sheet = sheetName ? z.text(sheetName) : null;
  if (!sheet) return [];
  const rows = [];
  for (const row of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const vals = [];
    for (const c of row[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      // attributes come in any order (r, s, t), so read `t` out of the attribute string rather
      // than by position — the first attempt did the latter and never resolved t="s".
      const attrs = c[1];
      const type = (/\bt="([^"]*)"/.exec(attrs) ?? [])[1];
      const body = c[2];
      const raw = (/<v>([\s\S]*?)<\/v>/.exec(body) ?? [])[1] ?? (/<t[^>]*>([\s\S]*?)<\/t>/.exec(body) ?? [])[1] ?? "";
      if (type === "s") vals.push(ss[Number(raw)] ?? "");
      else if (type === "inlineStr") vals.push(((/<t[^>]*>([\s\S]*?)<\/t>/.exec(body) ?? [])[1] ?? raw));
      else vals.push(raw);
    }
    if (vals.length) rows.push(vals.join(" | "));
  }
  return rows;
}
async function extractDocxParas(file) {
  const z = unzipText(fs.readFileSync(path.join(dir, file)));
  const xml = z.text("word/document.xml") ?? "";
  return [...xml.matchAll(/<w:p>([\s\S]*?)<\/w:p>/g)].map((m) => [...m[1].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join("")).filter(Boolean);
}

async function extractPptSlides(file) {
  const z = unzipText(fs.readFileSync(path.join(dir, file)));
  const names = Object.keys(z.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  const slides = [];
  for (const n of names) {
    const xml = z.text(n) ?? "";
    slides.push([...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => t[1]));
  }
  return slides;
}

// ---------- entity extraction: [{key, body}] in document order ----------
const sectionsByHeading = (text) => {
  const out = [];
  for (const block of text.split(/\n(?=## )/)) {
    const m = block.match(/^## (.+)/m);
    if (m) out.push({ key: m[1].trim(), body: block.trim() });
  }
  return out;
};
const declsByName = (text) => {
  const out = [];
  for (const block of text.split(/\n(?=(?:export )?(?:pub )?fn |export function )/)) {
    const m = block.match(/(?:export function |pub fn |fn )(\w+)/);
    if (m) out.push({ key: m[1], body: block.trim() });
  }
  return out;
};
const byColon = (lines) => lines.filter((l) => l.includes("：")).map((l) => ({ key: l.split("：")[0], body: l }));

// ---------- algorithms ----------
// Minimal line diff: LCS length-based; counts equal what diff/Myers reports as +/- lines.
function lineDiff(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const keepA = new Set(), keepB = new Set();
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { keepA.add(i); keepB.add(j); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  return { removed: n - keepA.size, added: m - keepB.size };
}

// Entity diff over identity keys.
function entityDiff(before, after) {
  const bMap = new Map(before.map((e) => [e.key, e.body]));
  const aMap = new Map(after.map((e) => [e.key, e.body]));
  const add = after.filter((e) => !bMap.has(e.key)).map((e) => e.key);
  const del = before.filter((e) => !aMap.has(e.key)).map((e) => e.key);
  const common = before.filter((e) => aMap.has(e.key)).map((e) => e.key);
  const mod = common.filter((k) => bMap.get(k) !== aMap.get(k));
  // A key is a move candidate when removing it makes the common keys appear in the same order on both sides.
  const bOrder = before.map((e) => e.key).filter((k) => aMap.has(k));
  const aOrder = after.map((e) => e.key).filter((k) => bMap.has(k));
  const sameWithout = (k) => {
    const b = bOrder.filter((x) => x !== k), a = aOrder.filter((x) => x !== k);
    return b.length === a.length && b.every((x, i) => x === a[i]);
  };
  const moveCandidates = bOrder.length === aOrder.length && bOrder.every((x, i) => x === aOrder[i]) ? [] : bOrder.filter(sameWithout);
  return { add, del, mod, move: moveCandidates };
}

// ---------- cases ----------
async function loadCase(name) {
  switch (name) {
    case "ts": { const b = readText("ts.before.ts"), a = readText("ts.after.ts"); return { before: { lines: b.split("\n").filter(Boolean), ents: declsByName(b) }, after: { lines: a.split("\n").filter(Boolean), ents: declsByName(a) } }; }
    case "rust": { const b = readText("rust.before.rs"), a = readText("rust.after.rs"); return { before: { lines: b.split("\n").filter(Boolean), ents: declsByName(b) }, after: { lines: a.split("\n").filter(Boolean), ents: declsByName(a) } }; }
    case "md": { const b = readText("md.before.md"), a = readText("md.after.md"); return { before: { lines: b.split("\n").filter(Boolean), ents: sectionsByHeading(b) }, after: { lines: a.split("\n").filter(Boolean), ents: sectionsByHeading(a) } }; }
    case "excel": { const b = await extractXlsxRows("excel.before.xlsx"), a = await extractXlsxRows("excel.after.xlsx"); const key = (r) => r.split(" | ")[0]; return { before: { lines: b, ents: b.map((r) => ({ key: key(r), body: r })) }, after: { lines: a, ents: a.map((r) => ({ key: key(r), body: r })) } }; }
    case "word": { const b = (await extractDocxParas("word.before.docx")).slice(1), a = (await extractDocxParas("word.after.docx")).slice(1); return { before: { lines: b, ents: byColon(b) }, after: { lines: a, ents: byColon(a) } }; }
    case "ppt": { const b = await extractPptSlides("ppt.before.pptx"), a = await extractPptSlides("ppt.after.pptx"); const ents = (s) => s.map((sl) => ({ key: sl[0], body: sl.join(" / ") })); return { before: { lines: b.map((s) => s.join(" / ")), ents: ents(b) }, after: { lines: a.map((s) => s.join(" / ")), ents: ents(a) } }; }
    case "pdf": { const b = await extractPdfLines("pdf.before.pdf"), a = await extractPdfLines("pdf.after.pdf"); return { before: { lines: b, ents: byColon(b) }, after: { lines: a, ents: byColon(a) } }; }
    default: throw new Error("unknown case " + name);
  }
}


/** Key order is not part of a verdict; compare sorted. */
function sortKeys(o) {
  if (o === null || typeof o !== "object") return o;
  return Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])]));
}

const KINDS = ["ts", "rust", "md", "excel", "word", "ppt", "pdf"];
const expected = JSON.parse(fs.readFileSync(path.join(dir, "expected.json"), "utf8"));
const report = {};
let failures = 0;
for (const k of KINDS) {
  // One case throwing must not hide the verdicts of the rest: the pdf case used to abort the
  // loop, so nothing after `ppt` was ever checked and the report looked like six cases.
  let loaded;
  try {
    loaded = await loadCase(k);
  } catch (err) {
    failures++;
    console.log(`FAIL ${k}`);
    console.log(`  could not load: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
    continue;
  }
  const { before, after } = loaded;
  const plain = lineDiff(before.lines, after.lines);
  const ours = entityDiff(before.ents, after.ents);
  report[k] = { plain, ours };
  const exp = expected.cases[k];
  // `plain` in expected.json is documentation of the naive line diff, not a criterion — the spec
  // says so and sets it to null. Comparing it made every case FAIL even when the entity diff
  // matched exactly. Compare the entity verdict, and only compare `plain` when the spec states one.
  const oursMatches = JSON.stringify(sortKeys(exp.ours)) === JSON.stringify(sortKeys(ours));
  const plainMatches = exp.plain == null || JSON.stringify(exp.plain) === JSON.stringify({ added: plain.added, removed: plain.removed });
  const ok = oursMatches && plainMatches;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${k}`);
  console.log(`  plain diff : -${plain.removed} +${plain.added}`);
  console.log(`  our diff   : add=${JSON.stringify(ours.add)} del=${JSON.stringify(ours.del)} mod=${JSON.stringify(ours.mod)} move=${JSON.stringify(ours.move)}`);
  if (!ok) console.log(`  expected   : ${JSON.stringify({ plain: exp.plain, ours: exp.ours })}`);
}
if (process.argv.includes("--write")) {
  expected.computed = report;
  fs.writeFileSync(path.join(dir, "expected.json"), JSON.stringify(expected, null, 2) + "\n");
  console.log("wrote computed results to expected.json");
}
console.log(failures ? `${failures} case(s) failed` : "all cases match expected.json");
process.exitCode = failures ? 1 : 0;
