#!/usr/bin/env node
/**
 * One command that grades the engine against expectations a human wrote down.
 *
 * Modelled on how OmniDiff-compatible states its ground truth (AGPL-3.0; the convention was read, no code
 * or fixture was copied): every case names the operations the change must produce, so a
 * regression reads as "this edit stopped being an update", not as a changed summary line.
 *
 *   node scripts/verify-diff-contract.mjs [--verbose]
 *
 * Exits non-zero if any case fails, so it can gate a release.
 */
import { existsSync, readFileSync } from "node:fs";
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
const b64 = (rel) => readFileSync(path.join(ROOT, rel)).toString("base64");
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");

const opsOf = (r) => new Set([...(r.before?.hunks ?? []), ...(r.after?.hunks ?? [])].map((h) => h.operation));
const opsOfSheet = (r) => new Set((r.sheets ?? []).flatMap((s) => (s.diff?.changes ?? []).map((c) => c.op)));

// Each case: what changes, and the operations that change must produce.
// `mustNot` names answers that are wrong even though something was reported.
const CASES = [
  {
    name: "代码 · 加一行语句",
    run: () => call({ cmd: "ast_diff", a: "fn a() {\n    x();\n}\n", b: "fn a() {\n    x();\n    y();\n}\n", filename: "t.rs" }),
    ops: opsOf, must: ["insert"], mustNot: [],
  },
  {
    name: "代码 · 删掉整个函数",
    run: () => call({ cmd: "ast_diff", a: "fn keep() {}\nfn gone() {\n    work();\n}\n", b: "fn keep() {}\n", filename: "t.rs" }),
    ops: opsOf, must: ["delete"], mustNot: [],
  },
  {
    name: "代码 · 改一个常量（不能拆成删+增）",
    run: () => call({ cmd: "ast_diff", a: "const R: f64 = 0.05;\n", b: "const R: f64 = 0.08;\n", filename: "t.rs" }),
    ops: opsOf, must: ["update"], mustNot: ["move"],
  },
  {
    name: "代码 · 函数整体移动",
    run: () => call({
      cmd: "ast_diff", filename: "t.rs",
      a: "fn a() { 1 }\nfn b() { 2 }\n",
      b: "fn b() { 2 }\nfn a() { 1 }\n",
    }),
    ops: opsOf, must: ["move"], mustNot: [],
  },
  {
    name: "代码 · 函数移动同时改了里面一行",
    run: () => call({
      cmd: "ast_diff", filename: "t.rs",
      a: "fn a() { 1 }\nfn moved() {\n    let y = 1;\n    y * 2\n}\nfn z() { 3 }\n",
      b: "fn a() { 1 }\nfn z() { 3 }\nfn moved() {\n    let y = 1;\n    y * 3\n}\n",
    }),
    ops: opsOf, must: ["move", "update"], mustNot: [],
  },
  {
    name: "代码 · 删上面的函数后，下面的改动仍算改",
    run: () => call({
      cmd: "ast_diff", filename: "t.rs",
      a: "fn keep() {}\nfn legacy() -> f64 {\n    0.03\n}\nfn rate() -> f64 {\n    0.05\n}\n",
      b: "fn keep() {}\nfn rate() -> f64 {\n    0.08\n}\n",
    }),
    ops: opsOf, must: ["delete", "update"], mustNot: [],
  },
  {
    name: "代码 · 文件没变就没有任何变更",
    run: () => call({ cmd: "ast_diff", a: "fn a() { 1 }\n", b: "fn a() { 1 }\n", filename: "t.rs" }),
    ops: opsOf, must: [], mustNot: ["insert", "delete", "update", "move"],
  },
  {
    name: "表格 · 加一列",
    run: () => call({ cmd: "sheet_diff", a: b64("examples/sheets/checklist-B3.xlsx"), b: b64("examples/sheets/checklist-B4.xlsx") }),
    ops: opsOfSheet, must: ["add"], mustNot: [],
  },
  {
    name: "表格 · 没变的文件没有变更",
    run: () => call({ cmd: "sheet_diff", a: b64("examples/sheets/checklist-B3.xlsx"), b: b64("examples/sheets/checklist-B3.xlsx") }),
    ops: opsOfSheet, must: [], mustNot: ["add", "rm", "mod"],
  },
  {
    name: "文档 · 段落有增有删",
    run: () => call({ cmd: "opc_diff", kind: "docx", a: b64("examples/docx/contract-v1.docx"), b: b64("examples/docx/contract-v2.docx") }),
    // The Word engine reports an edited paragraph as `change` and carries the word-level
    // add/remove split inside it; the protocol adapter is what turns that into add + del.
    ops: (r) => {
      const set = new Set();
      for (const x of r.revisions ?? []) {
        set.add(x.kind);
        for (const seg of x.segments ?? []) if (seg.op === "ins") set.add("insert");
        for (const seg of x.segments ?? []) if (seg.op === "del") set.add("delete");
      }
      return set;
    },
    must: ["insert", "delete"], mustNot: [],
  },
  {
    name: "代码样例 · 是代码不是文本",
    run: () => call({ cmd: "ast_diff", a: read("examples/code/pricebook-v1.ts"), b: read("examples/code/pricebook-v2.ts"), filename: "pricebook.ts" }),
    ops: opsOf, must: ["insert", "update"], mustNot: [],
  },
];

const verbose = process.argv.includes("--verbose");
let failed = 0;
for (const c of CASES) {
  let ops;
  try {
    ops = c.ops(c.run());
  } catch (e) {
    console.log(`✖ ${c.name} — 引擎报错：${e.message}`);
    failed++;
    continue;
  }
  const missing = c.must.filter((o) => !ops.has(o));
  const wrong = c.mustNot.filter((o) => ops.has(o));
  const ok = missing.length === 0 && wrong.length === 0;
  if (!ok) failed++;
  const actual = [...ops].sort().join(",") || "无";
  console.log(`${ok ? "✔" : "✖"} ${c.name}${ok && !verbose ? "" : `　→ 实际 ${actual}`}`);
  if (missing.length) console.log(`    少了：${missing.join(",")}`);
  if (wrong.length) console.log(`    不该有：${wrong.join(",")}`);
}
console.log(`\n${CASES.length - failed}/${CASES.length} 通过`);
process.exit(failed ? 1 : 0);
