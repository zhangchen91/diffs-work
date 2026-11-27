#!/usr/bin/env node
/**
 * Run every diff case under test-cases/ and report what the engine produced.
 *
 *   node scripts/run-cases.mjs [--only word] [--verbose]
 *
 * A case stands for one thing a reviewer looks for. The expectation is the set of
 * operations the change must produce, so a regression reads as "this edit stopped being a
 * deletion" rather than as a changed summary line.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const WASM = path.join(ROOT, "apps/website/public/engine/rules-core/diffs-engine.wasm");
if (!existsSync(WASM)) {
  console.error("engine binary not built; run scripts/build-rules-core.mjs first");
  process.exit(1);
}
const ex = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(WASM)), {}).exports;
const enc = new TextEncoder(), dec = new TextDecoder();
const call = (req) => {
  const bytes = enc.encode(JSON.stringify(req));
  const p = ex.diffs_alloc(bytes.length);
  new Uint8Array(ex.memory.buffer, p, bytes.length).set(bytes);
  const out = ex.diffs_handle(p, bytes.length);
  const len = ex.diffs_box_len(out);
  const text = dec.decode(new Uint8Array(ex.memory.buffer, out + 4, len));
  ex.diffs_free(out, len + 4);
  ex.diffs_free(p, bytes.length);
  return JSON.parse(text);
};

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const verbose = args.includes("--verbose");

/** Normalise whatever an engine said into the four operations. */
const CANON = { add: "add", added: "add", ins: "add", insert: "add", ins_at: "add",
  del: "del", delete: "del", deleted: "del", rm: "del", remove: "del",
  mod: "mod", change: "mod", changed: "mod", update: "mod", updated: "mod", formula: "mod",
  move: "move", moved: "move" };

function runCase(dir, file) {
  const c = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
  const read = (f) => readFileSync(path.join(dir, f));
  const text = (f) => read(f).toString("utf8");
  const b64 = (f) => read(f).toString("base64");
  const kind = c.kind;
  let raw;
  if (kind === "ts" || kind === "rust") {
    raw = call({ cmd: "ast_diff", a: text(c.before), b: text(c.after), filename: c.filename ?? path.basename(c.before) });
  } else if (kind === "excel") {
    raw = call({ cmd: "sheet_diff", a: b64(c.before), b: b64(c.after) });
  } else if (kind === "word" || kind === "ppt") {
    raw = call({ cmd: "opc_diff", kind: kind === "word" ? "docx" : "pptx", a: b64(c.before), b: b64(c.after) });
  } else if (kind === "pdf") {
    raw = call({ cmd: "pdf_diff", a: b64(c.before), b: b64(c.after) });
  } else {
    throw new Error(`unknown kind ${kind}`);
  }

  const ops = new Set();
  const add = (w) => { const o = CANON[w]; if (o) ops.add(o); };
  for (const h of raw.before?.hunks ?? []) add(h.operation);
  for (const h of raw.after?.hunks ?? []) add(h.operation);
  for (const s of raw.sheets ?? []) for (const ch of s.diff?.changes ?? []) add(ch.op);
  for (const r of raw.revisions ?? []) add(r.kind);
  for (const r of raw.rows ?? []) add(r.op ?? (r.kind === "equal" ? "same" : r.kind));

  const missing = (c.expect?.ops ?? []).filter((o) => !ops.has(o));
  const wrong = (c.expect?.notOps ?? []).filter((o) => ops.has(o));
  return { file, name: c.name, ops, missing, wrong, ok: !missing.length && !wrong.length, summary: raw.summary ?? "" };
}

const base = path.join(ROOT, "test-cases");
// PDF is compared in the browser (pdf.js), not by the kernel, so it has no case to run here.
const BROWSER_ONLY = new Set(["pdf"]);
const kinds = readdirSync(base)
  .filter((d) => !only || d === only)
  .filter((d) => !BROWSER_ONLY.has(d))
  .filter((d) => {
    try { return readdirSync(path.join(base, d)).some((f) => f.endsWith(".case.json")); } catch { return false; }
  });

let total = 0, failed = 0;
for (const k of kinds) {
  const dir = path.join(base, k);
  const files = readdirSync(dir).filter((f) => f.endsWith(".case.json")).sort();
  if (!files.length) continue;
  console.log(`\n${k}  (${files.length} 个用例)`);
  for (const f of files) {
    total++;
    let r;
    try {
      r = runCase(dir, f);
    } catch (e) {
      failed++;
      console.log(`  ✖ ${f} — ${e.message.slice(0, 90)}`);
      continue;
    }
    if (!r.ok) failed++;
    const actual = [...r.ops].sort().join(",") || "无";
    console.log(`  ${r.ok ? "✔" : "✖"} ${r.name}${r.ok && !verbose ? "" : `  → ${actual}`}`);
    if (r.missing.length) console.log(`      少了：${r.missing.join(",")}`);
    if (r.wrong.length) console.log(`      不该有：${r.wrong.join(",")}`);
  }
}
console.log(`\n${total - failed}/${total} 通过`);
if (!only) console.log("pdf 用例在浏览器端验证，见 test-cases/pdf/");
process.exit(failed ? 1 : 0);
