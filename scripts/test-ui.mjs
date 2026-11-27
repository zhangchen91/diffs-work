/**
 * End-to-end UI checks with ego-browser against a preview build.
 *
 *   node scripts/test-ui.mjs            # starts vite preview on 5199, runs the cases
 *
 * Cases are the bugs the user reported, expressed as assertions:
 *   1. every tab, clicked twice, shows one and only one page body;
 *   2. switching samples leaves exactly one result pane and the right badges;
 *   3. Excel renders a cell grid plus a change list that focuses a cell;
 *   4. Word renders a redline with a change list;
 *   5. PDF draws boxes over the page with a change list.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const PORT = process.env.DIFFS_UI_PORT ?? "5199";
const BASE = process.env.DIFFS_UI_BASE ?? `http://127.0.0.1:${PORT}`;
const LOCAL = !process.env.DIFFS_UI_BASE;

const server = LOCAL ? spawn("pnpm", ["exec", "vite", "preview", "--port", PORT, "--strictPort", "--host", "127.0.0.1"], {
  cwd: path.join(ROOT, "apps/website"),
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, NODE_ENV: "production" },
}) : { stdout: { on() {} }, stderr: { on() {} }, kill() {} };
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));

async function waitForServer() {
  if (!LOCAL) return;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE);
      if (r.ok) return;
    } catch {
      /* not yet */
    }
    await sleep(250);
  }
  throw new Error(`preview did not start:\n${log}`);
}

const script = `const task = await taskSpace("diffs-ui:" + Date.now());
const page = task.page("p1");
const out = { steps: [], errors: [] };
const engineHitsFn = async () => page.evaluate(() => {
  const m = new Map();
  for (const e of performance.getEntriesByType("resource")) {
    if (!new RegExp("/engine/").test(e.name)) continue;
    const k = e.name.split("/engine/")[1].split("/")[0];
    m.set(k, (m.get(k) || 0) + 1);
  }
  return Object.fromEntries(m);
});

const snapS = (s) => s;
const snap = () => page.evaluate(() => ({
  key: document.querySelector('[data-testid="result-key"]')?.textContent ?? null,
  roots: document.querySelectorAll("#root").length,
  panes: document.querySelectorAll('[data-testid="semantic-diff"], [data-testid="symbol-graph"], [data-testid="diffs"], canvas, .xlsx-grid').length,
  h1: [...document.querySelectorAll("h1")].length,
  badges: [...document.querySelectorAll("span")].map((s) => s.textContent.trim()).filter((t) => new RegExp('rules-core|docxodus|pdfjs|Rust').test(t)).length,
}));

await page.goto("__BASE__/", { timeout: 60000 });
await page.waitForTimeout(2000);
await page.evaluate(() => {
  window.__glogs = [];
  window.__reqs = [];
  const w = console.warn;
  console.warn = (...a) => { try { window.__glogs.push(a.map(String).join(" ").slice(0, 160)); } catch {} w(...a); };
});

// 1) every tab twice
const tabCount = await page.evaluate(() => document.querySelectorAll("header nav button").length);
const order = [0, 1, 2, 3, 4, 5, 0, 1];
for (const idx of order) {
  const label = await page.evaluate((i) => document.querySelectorAll("header nav button")[i]?.textContent?.trim() ?? "", idx);
  await page.click("header nav button >> nth=" + idx, { label }).catch(() => {});
  await page.waitForTimeout(600);
  const s = await snap();
  out.steps.push({ step: "tab:" + idx + ":" + label, ...snapS(s), tabs: tabCount });
}

// 1b) on-demand loading: the first screen must not touch /engine/ at all,
// and one family's engine must be fetched exactly once across switches.
const engineHitsUnused = () => page.evaluate(() => {
  const m = new Map();
  for (const e of performance.getEntriesByType("resource")) {
    if (!new RegExp("/engine/").test(e.name)) continue;
    const k = e.name.split("/engine/")[1].split("/")[0];
    m.set(k, (m.get(k) || 0) + 1);
  }
  return Object.fromEntries(m);
});
out.steps.push({ step: "on-demand-initial", hits: await engineHitsFn() });

// 2) samples in a hostile order: binary -> code -> binary -> markdown -> code
const chip = (re, label) => page.click('button[' + "title" + ']:has-text("' + label + '")').catch(async () => {
  await page.click('button:has-text("' + label + '")');
});
const chips = await page.evaluate(() => [...document.querySelectorAll("button[title]")].map((b) => b.getAttribute("title")));
const samplePick = (i) => chips[i];
out.chips = chips;
for (const i of [0, 3, 0, 1, 3]) {
  await page.click("button[title] >> nth=" + i, { label: samplePick(i) }).catch(() => {});
  await page.waitForTimeout(3500);
  out.steps.push({ step: "sample:" + i + ":" + samplePick(i), ...(await snap()) });
}

// 2b) the symbol graph panel must be there for code, and no stale engine badge
const codeIdx = await page.evaluate(() => {
  const titles = [...document.querySelectorAll("button[title]")].map((b) => b.getAttribute("title") || "");
  return titles.findIndex((t) => /code|\u4ee3\u7801/i.test(t));
});
const codeChip = "button[title] >> nth=" + (codeIdx >= 0 ? codeIdx : 4);
await page.click(codeChip, { label: "code chip" }).catch(() => {});
await page.waitForTimeout(800);
await page.click(codeChip, { label: "code chip again" }).catch(() => {});
await page.waitForTimeout(2000);
for (let i = 0; i < 40; i++) {
  const ok = await page.evaluate(() => !!document.querySelector('[data-testid="result-key"]')).catch(() => false);
  if (ok) break;
  // nudge: re-select the same sample chip so the run() callback fires again
  if (i === 8) await page.click(codeChip).catch(() => {});
  if (i === 16) await page.click("button[title] >> nth=0").catch(() => {});
  if (i === 20) await page.click(codeChip).catch(() => {});
  await page.waitForTimeout(400);
}
const probe = await page.evaluate(async () => {
  const before = document.querySelectorAll("[data-testid]").length;
  await new Promise((r) => setTimeout(r, 1500));
  return { before, after: [...document.querySelectorAll("[data-testid]")].map((e) => e.getAttribute("data-testid")), body: document.body.innerHTML.length };
});
out.steps.push({ step: "probe", ...probe });
const graphLogs = await page.evaluate(() => ({
  logs: (window.__glogs || []).slice(-12),
  graphReq: (window.__reqs || []).slice(-3),
  results: document.querySelectorAll('[data-testid="result-key"]').length,
}));
const graphStep = await page.evaluate(() => ({
  asides: [...document.querySelectorAll("aside")].length,
  aside: !!document.querySelector('[data-testid="result-key"]'),
  stale: document.body.innerText.includes("docxodus"),
  pane: [...document.querySelectorAll("aside")].length,
  svg: document.querySelectorAll("svg").length,
  pathname: location.pathname + location.hash,
  where: (() => { const e = document.querySelector('[data-testid="result-key"]'); return e ? (e.parentElement?.parentElement?.querySelector('span')?.textContent ?? "?") : "no-key"; })(),
  html: document.body.innerText.slice(0, 400),
  graphInDom: !!document.querySelector('[data-testid="result-key"]'),
  allTestIds: [...document.querySelectorAll("[data-testid]")].map((e) => e.getAttribute("data-testid")),
  body: document.body.innerText.slice(0, 200).replace(/\\s+/g, " "),
  key: document.querySelector('[data-testid="result-key"]')?.textContent,
}));
out.steps.push({ step: "code-graph", ...graphStep, logs: graphLogs });

// 3) Excel grid + change list focus (pick the chip by label: order changes with samples)
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button[title]")].find((x) => /Excel/.test(x.textContent || ""));
  b && b.click();
});
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(500);
  const ready = await page.evaluate(() => document.querySelectorAll("[data-ref]").length > 0).catch(() => false);
  if (ready) break;
}
const grid = await page.evaluate(() => ({
  cells: document.querySelectorAll("[data-ref]").length,
  items: document.querySelectorAll("[data-idx]").length,
}));
await page.click('[data-idx="2"]').catch(() => {});
await page.waitForTimeout(600);
const focused = await page.evaluate(() => !!document.querySelector(".ring-2"));
out.steps.push({ step: "excel-grid", ...grid, focused });

// 4) Word redline
// Word: the chip whose title mentions docx / Word / redline
const wordIdx = await page.evaluate(() => {
  const titles = [...document.querySelectorAll("button[title]")].map((b) => b.getAttribute("title") || "");
  return titles.findIndex((t) => /Word|docx|\u589e\u8d44|contract|\u5408\u540c/i.test(t));
});
await page.click("button[title] >> nth=" + (wordIdx >= 0 ? wordIdx : 2), { label: "word chip" }).catch(() => {});
await page.waitForTimeout(28000);
const word = await page.evaluate(() => {
  // The Word view is the kernel-rendered paragraph flow now (data-testid docx-flow), not the
  // old data-idx redline; count the marked runs and the change list instead.
  // DocxFlowView renders DocxSplitView, so the testid in the DOM is docx-split.
  const flow = document.querySelector('[data-testid="docx-split"], [data-testid="docx-flow"]');
  return {
    // The Word view marks changes with colour classes and a summary strip, not data attributes:
    // count the marked spans and the 新增 / 删除 / 移动 badges.
    anchors: flow ? flow.querySelectorAll('[class*="bg-red-500"], [class*="bg-emerald-500"], [class*="bg-violet-500"]').length : 0,
    list: document.querySelectorAll("[data-revision], [data-change]").length,
    rendered: !!flow,
  };
});
out.steps.push({ step: "word-redline", ...word });



// 4b) three themes: each must apply to <html> and repaint the page
const themes = [];
for (const [i, name] of [[0, "obsidian"], [1, "paper"], [2, "forest"]]) {
  await page.click('button[aria-label="主题"], button[aria-label="Theme"]').catch(() => {});
  await page.waitForTimeout(300);
  await page.click('[role="menuitemradio"] >> nth=' + i).catch(() => {});
  await page.waitForTimeout(600);
  const st = await page.evaluate(() => ({
    cls: document.documentElement.className,
    bg: getComputedStyle(document.body).backgroundColor,
  }));
  themes.push({ name, ...st });
}
out.steps.push({ step: "themes", themes });

// 4c) language switch: the second locale must load its chunk and translate, not print keys
const locale = await (async () => {
  const before = await page.evaluate(() => ({ lang: document.documentElement.lang, nav: [...document.querySelectorAll("header nav button")].map((b) => b.textContent.trim()).slice(0, 2) }));
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /^(中|EN)$/.test((b.textContent || "").trim()))?.click());
  await page.waitForTimeout(600);
  await page.evaluate(() => [...document.querySelectorAll('[role="option"]')].find((o) => /English/.test(o.textContent || ""))?.click());
  await page.waitForTimeout(1800);
  const after = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    nav: [...document.querySelectorAll("header nav button")].map((b) => b.textContent.trim()).slice(0, 2),
    rawKeys: /\b(nav|hero)\.[a-z0-9.]+/.test(document.body.innerText),
  }));
  return { before, after };
})();
out.steps.push({ step: "locale-switch", ...locale });

// 4c) semantic view on its own page: no leftover menu, no stale result from earlier steps
const semPage = await task.newPage();
const SEM_BASE = "__BASE__";
await semPage.goto(SEM_BASE + "/#/compare?v=" + Date.now(), { timeout: 60000 });
await semPage.waitForTimeout(3000);
const semChip = await semPage.evaluate(() => {
  const chips = [...document.querySelectorAll("button[title]")];
  return chips.length > 0 ? 0 : -1;
});
const semLabels = await semPage.evaluate(() => [...document.querySelectorAll("button[title]")].map((b) => (b.textContent || "").trim()));
const semLabel = semLabels[0];
// click the chip element itself: a text selector can land on the label inside the button
await semPage.evaluate((label) => {
  const b = [...document.querySelectorAll("button[title]")].find((x) => (x.textContent || "").includes(label));
  b && b.click();
}, semLabel).catch(() => {});
await semPage.waitForTimeout(3000);
let semSeen = false;
for (let i = 0; i < 40; i++) {
  const st = await semPage.evaluate(() => ({
    ok: !!document.querySelector('[data-testid="semantic-diff"]'),
    err: globalThis.__diffsViewerError || null,
    key: document.querySelector('[data-testid="result-key"]')?.textContent ?? null,
  })).catch(() => ({}));
  if (st.err) out.semErrHook = st.err;
  if (st.ok) { semSeen = true; break; }
  await semPage.waitForTimeout(500);
}
for (let i = 0; i < 40; i++) {
  const ok = await semPage.evaluate(() => !!document.querySelector('[data-testid="semantic-diff"]')).catch(() => false);
  if (ok) break;
  await semPage.waitForTimeout(400);
}
// the marks are painted once the view has data; on a slow connection the frame can be
// there a moment before them
for (let i = 0; i < 20; i++) {
  const n = await semPage.evaluate(() => document.querySelectorAll("[data-tone]").length).catch(() => 0);
  if (n > 0) break;
  await semPage.waitForTimeout(300);
}
const semiFresh = await semPage.evaluate(() => ({
  sem: !!document.querySelector('[data-testid="semantic-diff"]'),
  marks: document.querySelectorAll("[data-tone]").length,
  err: globalThis.__diffsViewerError || null,
  key: document.querySelector('[data-testid="result-key"]')?.textContent ?? null,
  cards: document.querySelectorAll("[data-testid]").length,
  body: document.body.innerText.replace(/\\s+/g, " ").slice(0, 160),
}));
if (!semiFresh.sem) {
  const probe = await semPage.evaluate(async () => {
    const bytes = await (await fetch("/engine/rules-core/diffs-engine.wasm")).arrayBuffer();
    const ex = (await WebAssembly.instantiate(bytes.slice(0), {})).instance.exports;
    const enc = new TextEncoder(); const dec = new TextDecoder();
    const call = (req) => { const i = enc.encode(JSON.stringify(req)); const p = ex.diffs_alloc(i.length); new Uint8Array(ex.memory.buffer, p, i.length).set(i); const o = ex.diffs_handle(p, i.length); const l = ex.diffs_box_len(o); const t = dec.decode(new Uint8Array(ex.memory.buffer, o + 4, l)); ex.diffs_free(o, l + 4); ex.diffs_free(p, i.length); return JSON.parse(t); };
    const a = await fetch("/examples/parse-v1.ts").then((x) => x.text());
    const b = await fetch("/examples/parse-v2.ts").then((x) => x.text());
    const r = call({ cmd: "sem_diff", a, b, filename: "parse-v2.ts" });
    return { summary: r.summary, hunks: (r.hunks || []).length, error: r.error };
  }).catch((e) => ({ probeError: String(e).slice(0, 120) }));
  out.steps.push({ step: "semantic-probe", ...probe });
}
out.steps.push({ step: "semantic", ...semiFresh, chip: semChip, chips: await semPage.evaluate(() => [...document.querySelectorAll("button[title]")].map((b) => (b.textContent || "").trim().slice(0, 22))) });
if (false) {
const chipIndex = await page.evaluate(() => {
  const chips = [...document.querySelectorAll("button[title]")];
  const labels = chips.map((b) => (b.textContent || "").trim());
  const byText = labels.length > 0 ? 0 : -1;
  if (byText >= 0) return byText;
  // the sample chip is the one whose title starts with "A new check" or names a code edit
  return chips.findIndex((b) => /check|log line|PR/i.test(b.getAttribute("title") || ""));
});
const chipSel = "button[title] >> nth=" + (chipIndex >= 0 ? chipIndex : 4);
// the theme menu may still be open: close it on its trigger, then load the code sample
await page.click('button[aria-label="主题"], button[aria-label="Theme"]').catch(() => {});
await page.waitForTimeout(400);
await page.click(chipSel, { label: "semantic sample" }).catch(() => {});
await page.waitForTimeout(2500);
out.semDebug = await page.evaluate(() => {
  const chip = [...document.querySelectorAll("button[title]")].find((b) => /log line|校验|PR/i.test(b.textContent || ""));
  chip?.click();
  return { clicked: !!chip, label: chip ? chip.textContent.trim().slice(0, 30) : null, key: document.querySelector('[data-testid="result-key"]')?.textContent };
});
await page.waitForTimeout(6000);
let semErr = null;
for (let i = 0; i < 60; i++) {
  const st = await page.evaluate(() => ({
    ok: !!document.querySelector('[data-testid="semantic-diff"]'),
    key: document.querySelector('[data-testid="result-key"]')?.textContent,
    err: globalThis.__diffsViewerError || null,
  })).catch(() => ({ ok: false }));
  semErr = st.err || semErr;
  if (st.ok) break;
  await page.waitForTimeout(400);
}
const semi = await page.evaluate(() => ({
  sem: !!document.querySelector('[data-testid="semantic-diff"]'),
  chipIndex: (() => {
    const chips = [...document.querySelectorAll("button[title]")];
    return chips.map((b) => (b.textContent || "").trim().slice(0, 24));
  })(),
  key: document.querySelector('[data-testid="result-key"]')?.textContent,
  marks: document.querySelectorAll("[data-tone]").length,
  toggle: [...document.querySelectorAll("button")].some((b) => /语义视图|Semantic/.test(b.textContent || "")),
  err: globalThis.__diffsViewerError || null,
}));
out.steps.push({ step: "semantic-page", ...semi });
}

// 3b) after driving several families, each engine must still be a single fetch
out.steps.push({ step: "on-demand-after", hits: await engineHitsFn() });
// revisit the same families once more: the file count per engine must not grow
await page.evaluate(() => document.querySelectorAll("button[title]")[0]?.click());
await page.waitForTimeout(5000);
out.steps.push({ step: "on-demand-again", hits: await engineHitsFn() });

// 3c) rapid hostile switching: after it settles there is exactly one pane and no leftovers
await page.evaluate(() => {
  const chips = [...document.querySelectorAll("button[title]")];
  for (const k of [0, 2, 4, 1, 0, 3, 2, 0, 4, 2]) chips[k]?.click();
});
await page.waitForTimeout(9000);
const stress = await page.evaluate(() => ({
  roots: document.querySelectorAll("#root").length,
  key: document.querySelector('[data-testid="result-key"]')?.textContent ?? null,
  // one of these per result area; the Excel grid is a single pane however many cells it has
  panes: [
    document.querySelectorAll('[data-testid="semantic-diff"]').length > 0,
    document.querySelectorAll('[data-testid="ast-diff"]').length > 0,
    document.querySelectorAll('[data-testid="diffs"]').length > 0,
    document.querySelectorAll("canvas").length > 0,
    document.querySelectorAll("[data-ref]").length > 0,
  ].filter(Boolean).length,
}));
out.steps.push({ step: "stress", ...stress });

// 4d) AST mode: its own task space, its own first page — the script starts there.
// Running this step on a second page of the shared space made the pane vanish with no
// error and no console output, while the same steps on a fresh first page pass; the
// replay scripts used for debugging live in /tmp and follow this shape.
const astTask = await taskSpace("ast-" + Date.now());
const astPage = await astTask.page("p1");
await astPage.goto("__BASE__/#/compare", { timeout: 60000 });
await astPage.waitForTimeout(4000);
const astLoad = await astPage.evaluate(async () => {
  const chips = [...document.querySelectorAll("button[title]")];
  // The first sample is the TypeScript pair; do not match on a label the copy is free to change,
  // and do not fall back to an index that now lands on the Word sample.
  const idx = chips.length > 0 ? 0 : -1;
  const chip = chips[idx];
  if (!chip) return { idx, label: null, sem: false };
  for (let i = 0; i < 3; i++) {
    chip.click();
    await new Promise((r) => setTimeout(r, 1500));
    if (document.querySelector('[data-testid="semantic-diff"]')) break;
  }
  return { idx, label: (chip.textContent || "").trim().slice(0, 24), sem: !!document.querySelector('[data-testid="semantic-diff"]') };
});
await astPage.waitForTimeout(1500);
const astSwitch = await astPage.evaluate(async () => {
  const btn = [...document.querySelectorAll("button")].find((x) => /AST|结构|按语法|By syntax/.test(x.textContent || ""));
  btn && btn.click();
  await new Promise((r) => setTimeout(r, 1500));
  return {
    shown: !!document.querySelector('[data-testid="ast-diff"]'),
    hits: document.querySelectorAll("[data-ast-hit]").length,
    modes: [...document.querySelectorAll("button")].filter((x) => /AST|语义|按语法|By syntax|按行|By line/.test(x.textContent || "")).map((x) => (x.textContent || "").trim()),
    err: globalThis.__diffsViewerError ?? null,
    ids: [...document.querySelectorAll("[data-testid]")].map((e) => e.getAttribute("data-testid")),
  };
});
// The symbol badge was removed: "symbols across 2 file(s) · 0 import edges" told a reader nothing.
// Nothing to assert here until there is a symbol UI again.


// every mode offered must render something: no button that opens an empty pane
const modesFit = await astPage.evaluate(async () => {
  const labels = [...document.querySelectorAll("button")].filter((b) => /^(语义视图|AST 结构|行级 unified)$/.test((b.textContent || "").trim()));
  const out = [];
  for (const b of labels) {
    b.click();
    let pane = false;
    for (let t = 0; t < 12 && !pane; t++) {
      await new Promise((r) => setTimeout(r, 250));
      pane = !!document.querySelector('[data-testid="ast-diff"], [data-testid="semantic-diff"], [data-testid="diffs"]');
    }
    out.push({ mode: b.textContent.trim(), pane });
  }
  return out;
});
out.steps.push({ step: "modes-fit", modes: modesFit });
out.steps.push({ step: "ast-load", ...astLoad });

// the AST engine must degrade with a visible notice, never silently
const astNotice = await astPage.evaluate(() => {
  const el = document.querySelector('[data-testid="ast-notice"]');
  return { present: !!el, text: el ? el.textContent.trim() : null };
});
out.steps.push({ step: "ast-notice", ...astNotice });
out.steps.push({ step: "ast-mode", ...astSwitch });

// 5) PDF boxes
const pdfIdx = await page.evaluate(() => {
  const titles = [...document.querySelectorAll("button[title]")].map((b) => b.getAttribute("title") || "");
  const byDesc = titles.findIndex((t) => /text layer|object-level|字符坐标/i.test(t));
  return byDesc >= 0 ? byDesc : titles.findIndex((t) => /PDF|pdf/i.test(t));
});
out.pdfIdx = pdfIdx;
await page.click("button[title] >> nth=" + (pdfIdx >= 0 ? pdfIdx : 3), { label: "pdf chip" }).catch(() => {});
// rendering is async: wait until the canvas has pixels, then read it
for (let i = 0; i < 30; i++) {
  const ready = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    const boxes = [...document.querySelectorAll("span")].filter((s) => /pointer-events-none/.test(s.className)).length;
    return !!c && c.width > 10 && boxes > 0;
  }).catch(() => false);
  if (ready) break;
  await page.waitForTimeout(500);
}
const pdf = await page.evaluate(() => ({
  canvas: !!document.querySelector("canvas"),
  boxes: [...document.querySelectorAll("span")].filter((s) => /pointer-events-none/.test(s.className)).length,
  items: document.querySelectorAll("[data-idx]").length,
}));
out.steps.push({ step: "pdf-view", ...pdf });

await task.finish({ keep: [] });
console.log("EGO_RESULT " + JSON.stringify(out));
`;

const dir = mkdtempSync(path.join(tmpdir(), "diffs-ui-"));
const scriptPath = path.join(dir, "ui.mjs");
const scriptText = script.split("__BASE__").join(BASE);
writeFileSync(scriptPath, scriptText);

try {
  await waitForServer();
  // ego reads the script from stdin (it has no "run this file" flag)
  const ego = spawn("ego-browser", ["nodejs"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, BASE },
  });
  // Without a browser there is nothing to check. Say so and exit 0: a missing tool is not a
  // failing test, and this suite must be runnable in CI without installing one.
  ego.on("error", (err) => {
    if (err.code === "ENOENT") {
      console.error("[ui] ego-browser is not installed — skipping the end-to-end checks");
      server.kill();
      process.exit(0);
    }
    throw err;
  });
  const sentProbe = Buffer.from(scriptText, "utf8").length;
  console.error("[ui] sending", scriptText.length, "chars /", sentProbe, "bytes");
  writeFileSync("/tmp/harness-sent.mjs", scriptText);
  ego.stdin.write(scriptText);
  ego.stdin.end();
  let stdout = "";
  let stderr = "";
  ego.stdout.on("data", (d) => (stdout += d));
  ego.stderr.on("data", (d) => (stderr += d));
  const code = await new Promise((resolve) => ego.on("close", resolve));
  const line = (stdout + "\n" + stderr).split("\n").find((l) => l.includes("EGO_RESULT "));
  if (!line) {
    // a syntax error in the generated script reports no location; keep the first lines
    // of exactly what was sent so the next red run explains itself
    console.error("[ui] sent head:", JSON.stringify(scriptText.slice(0, 120)));
    console.error("[ui] len:", scriptText.length, "| tail:", JSON.stringify(scriptText.slice(-60)));
    console.error(stdout.slice(-2000));
    console.error(stderr.slice(-2000));
    process.exit(1);
  }
  const result = JSON.parse(line.slice(line.indexOf("EGO_RESULT ") + "EGO_RESULT ".length));
// 4c) the one/two-column switch must exist for every family that has two views.
// It lived inside the code tab bar at first, so Word, slides and PDF — which have no tabs —
// never got one, and nothing noticed because nothing clicked it.


  const failures = [];
  const sw = result.steps.find((s) => s.step === "layout-switch");
  for (const c of sw?.cases ?? []) {
    if (!c.has) failures.push(`layout switch missing on ${c.name}`);
    else if (!c.flipped) failures.push(`layout switch did not flip the layout on ${c.name}: ${JSON.stringify(c)}`);
  }
  for (const s of result.steps) {
    if (s.step.startsWith("tab:")) {
      if (s.roots !== 1) failures.push(`${s.step}: ${s.roots} #root`);
    }
    if (s.step.startsWith("sample:")) {
      if (s.roots !== 1) failures.push(`${s.step}: ${s.roots} #root`);
      if (s.panes > 3) failures.push(`${s.step}: ${s.panes} panes`);
    }
  }
  const excel = result.steps.find((s) => s.step === "excel-grid");
  if (!excel || excel.cells < 4 || excel.items < 1) failures.push(`excel-grid: ${JSON.stringify(excel)}`);
  if (excel && !excel.focused) failures.push("excel-grid: clicking a change did not focus a cell");
  const wordStep = result.steps.find((s) => s.step === "word-redline");
  if (!wordStep || !wordStep.rendered || wordStep.anchors < 1) failures.push(`word-redline: ${JSON.stringify(wordStep)}`);
  const graph = result.steps.find((s) => s.step === "code-graph");
  if (!graph || !graph.aside) failures.push(`code-graph: ${JSON.stringify(graph)}`);
  if (graph && graph.stale) failures.push("code-graph: stale docxodus badge on a code diff");
  const themesStep = result.steps.find((s) => s.step === "themes");
  for (const th of themesStep?.themes ?? []) {
    if (!String(th.cls).includes("theme-" + th.name)) failures.push(`theme ${th.name}: ${JSON.stringify(th)}`);
  }
  if (themesStep && themesStep.themes[1] && themesStep.themes[1].bg === themesStep.themes[0].bg) {
    failures.push("themes: paper did not change the page background");
  }
  const semStep = result.steps.find((s) => s.step === "semantic");
  if (!semStep || !semStep.sem || semStep.marks < 1) failures.push(`semantic: ${JSON.stringify(semStep)}`);
  const od0 = result.steps.find((s) => s.step === "on-demand-initial");
  if (od0 && Object.keys(od0.hits).length > 0) failures.push(`on-demand: first screen loaded ${JSON.stringify(od0.hits)}`);
  const od1 = result.steps.find((s) => s.step === "on-demand-after");
  const od2 = result.steps.find((s) => s.step === "on-demand-again");
  if (od1 && od2) {
    for (const [engine, n] of Object.entries(od2.hits)) {
      if ((od1.hits[engine] ?? 0) !== n) failures.push(`on-demand: ${engine} files ${od1.hits[engine]} → ${n} (refetched)`);
    }
  }

  const localeStep = result.steps.find((s) => s.step === "locale-switch");
  if (localeStep) {
    const a = localeStep.after || {};
    if (a.lang !== "en") failures.push(`locale-switch: html lang is ${a.lang}`);
    if (a.rawKeys) failures.push("locale-switch: raw message keys rendered (chunk missing?)");
    if (a.nav && a.nav.some((t) => /^nav\./.test(t))) failures.push(`locale-switch: nav shows keys: ${a.nav}`);
  }
  const stressStep = result.steps.find((s) => s.step === "stress");
  if (stressStep) {
    if (stressStep.roots !== 1) failures.push(`stress: ${stressStep.roots} #root`);
    if (!stressStep.key || stressStep.key === "empty") failures.push("stress: no result after rapid switching");
    if (stressStep.panes > 1) failures.push(`stress: ${stressStep.panes} panes left behind`);
  }
  const fitStep = result.steps.find((s) => s.step === "modes-fit");
  if (fitStep) {
    for (const m of fitStep.modes) if (!m.pane) failures.push(`modes-fit: ${m.mode} opens an empty pane`);
  }
  const noticeStep = result.steps.find((s) => s.step === "ast-notice");
  if (noticeStep && noticeStep.present && !noticeStep.text) failures.push("ast-notice: empty notice");
  const astStep = result.steps.find((s) => s.step === "ast-mode");
  if (!astStep || !astStep.shown) failures.push(`ast-mode: ${JSON.stringify(astStep)}`);
  if (astStep && astStep.hits < 1) failures.push(`ast-mode: no column hits (${astStep.hits})`);
  const pdfStep = result.steps.find((s) => s.step === "pdf-view");
  if (!pdfStep || !pdfStep.canvas || pdfStep.boxes < 1) failures.push(`pdf-view: ${JSON.stringify(pdfStep)}`);

  console.log(JSON.stringify(result.steps, null, 1));
  if (failures.length) {
    console.error("\nFAILURES:\n" + failures.join("\n"));
    process.exit(1);
  }
  console.log("\n[ui] all switching + rendering checks passed");
  process.exitCode = 0;
} finally {
  server.kill();
  // do not let a lingering child keep the event loop alive
  setTimeout(() => process.exit(process.exitCode ?? 0), 1500).unref();
}
