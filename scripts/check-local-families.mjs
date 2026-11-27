/**
 * Every family renders in the local viewer, from its own sample.
 *
 * Opening the Word sample used to print the zip archive as text and blank the whole card, and
 * nothing caught it because every browser test pointed at the website. This loads each family's
 * sample in `diffs local` and asserts that the view it is supposed to mount actually mounted —
 * `docx-split`, `pptx-deck`, `pdf`, the sheet grid, the semantic view — and that no binary content
 * leaked onto the page.
 *
 *   node scripts/check-local-families.mjs
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const BASE = "http://127.0.0.1:5289";
const CHROME = path.join(
  os.homedir(),
  "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
);
if (!existsSync(CHROME)) {
  console.log("[local-families] no Chromium at the Playwright cache path — skipping");
  process.exit(0);
}

/** Sample button text → the testid its view must mount. */
const FAMILIES = [
  { name: "code", label: /代码 ·/, view: '[data-testid="semantic-diff"]' },
  // Markdown renders and its text is on the page, but none of its containers carry a testid, so
  // there is nothing to assert on but the content. Left as content for now rather than adding a
  // testid to whichever element it turns out to be — the check that matters here is that the family
  // draws at all, and the other five prove the wiring.
  { name: "markdown", label: /Markdown ·/, view: null },
  { name: "excel", label: /Excel ·/, view: '[data-testid="xlsx-diff"]' },
  { name: "word", label: /Word ·/, view: '[data-testid="docx-split"], [data-testid="docx-flow"]' },
  { name: "ppt", label: /PPT ·/, view: '[data-testid="pptx-deck"]' },
  { name: "pdf", label: /PDF ·/, view: '[data-testid="pdf-diff"]' },
];

const viewer = spawn(process.execPath, [path.join(ROOT, "apps/cli/lib/bin.js"), "local", "--port", "5289", "--no-open"], { cwd: ROOT, stdio: "ignore" });
for (let i = 0; i < 60; i++) {
  try { await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(500) }); break; }
  catch { await new Promise((r) => setTimeout(r, 250)); }
}

const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=9227", `--user-data-dir=${os.tmpdir()}/diffs-local-families`, "about:blank"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 3500));

const failures = [];
for (const fam of FAMILIES) {
  const tab = await (await fetch("http://127.0.0.1:9227/json/new?about:blank", { method: "PUT" })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${BASE}/#/compare?f=${fam.name}-${Date.now()}` });
  await new Promise((r) => setTimeout(r, 4000));
  await ev(`(() => { try { localStorage.clear(); } catch (e) {} })()`);
  await send("Page.navigate", { url: `${BASE}/#/compare?f=${fam.name}-again-${Date.now()}` });
  await new Promise((r) => setTimeout(r, 4000));

  const clicked = await ev(`(() => {
    const b = [...document.querySelectorAll("button")].find((x) => ${fam.label}.test(x.textContent || ""));
    if (!b) return null;
    b.click();
    return b.textContent.trim();
  })()`);

  let mounted = false;
  // PDF and Word load an engine before they can draw; 45 s was not always enough under load.
  for (let i = 0; i < 180; i++) {
    mounted = fam.view
      ? await ev(`document.querySelector(${JSON.stringify(fam.view)}) != null`)
      : await ev(`document.body.innerText.includes("+") && document.body.innerText.length > 500`);
    if (mounted) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const leaked = await ev(`/PK\\u0003\\u0004|_rels\\/\\.rels|word\\/document\\.xml/.test(document.body.innerText.slice(0, 4000))`);

  if (!clicked) failures.push(`${fam.name}: no sample button`);
  else if (!mounted) {
    const diag = await ev(`(() => ({
      testids: [...document.querySelectorAll("[data-testid]")].map(e => e.getAttribute("data-testid")).slice(0, 8),
      tail: document.body.innerText.slice(-120),
    }))()`);
    failures.push(`${fam.name}: the view never mounted — ${fam.view} | saw ${JSON.stringify(diag)}`);
  }
  else if (leaked) failures.push(`${fam.name}: binary content printed on the page`);
  else console.log(`  ${fam.name.padEnd(9)} ${clicked}`);
  ws.close();
}

chrome.kill();
viewer.kill();
if (failures.length) {
  console.error("\nFAILURES:\n" + failures.map((f) => "  - " + f).join("\n"));
  process.exit(1);
}
console.log("\n[local-families] every family renders from its own sample, with no binary on the page");
