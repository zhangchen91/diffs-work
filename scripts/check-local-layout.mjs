/**
 * The local viewer needs the same one/two-column switch the website has.
 *
 * It did not have one: `apps/local` decided "two panes" from `matchMedia('(min-width: 900px)')`
 * alone, so on any wide screen a .docx showed both versions with no way to see just the new one.
 * The website had the switch and this app did not, and nothing noticed because every existing
 * browser test pointed at the website.
 *
 * This runs the same measurement against `diffs local`:
 *   node scripts/check-local-layout.mjs
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const BASE = "http://127.0.0.1:5288";
const CHROME = path.join(
  os.homedir(),
  "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
);
if (!existsSync(CHROME)) {
  console.log("[local-layout] no Chromium at the Playwright cache path — skipping");
  process.exit(0);
}

const viewer = spawn(process.execPath, [path.join(ROOT, "apps/cli/lib/bin.js"), "local", "--port", "5288", "--no-open"], {
  cwd: ROOT,
  stdio: "ignore",
});
for (let i = 0; i < 60; i++) {
  try {
    await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(500) });
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 250));
  }
}

const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=9226", `--user-data-dir=${os.tmpdir()}/diffs-local-layout`, "about:blank"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 3500));

const failures = [];
const tab = await (await fetch("http://127.0.0.1:9226/json/new?about:blank", { method: "PUT" })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

// The Word sample is the family whose layout the switch controls and the one that was broken.
await send("Page.navigate", { url: `${BASE}/#/compare` });
await new Promise((r) => setTimeout(r, 4000));
for (let i = 0; i < 40; i++) {
  const ok = await ev(`[...document.querySelectorAll("button")].some(b => /Word ·/.test(b.textContent || ""))`);
  if (ok) break;
  await new Promise((r) => setTimeout(r, 500));
}
await ev(`[...document.querySelectorAll("button")].find(b => /Word ·/.test(b.textContent || ""))?.click()`);
const clicked = await ev(`(() => {
  const b = [...document.querySelectorAll("button")].find(b => /Word ·/.test(b.textContent || ""));
  if (!b) return "no sample button";
  b.click();
  return b.textContent.trim();
})()`);
for (let i = 0; i < 120; i++) {
  if (await ev(`!!document.querySelector('[data-testid="docx-split"], [data-testid="docx-flow"]')`)) break;
  await new Promise((r) => setTimeout(r, 500));
}
await new Promise((r) => setTimeout(r, 3000));
const loaded = await ev(`(() => ({
  testids: [...document.querySelectorAll("[data-testid]")].map(e => e.getAttribute("data-testid")).slice(0, 10),
  text: document.body.innerText.slice(-200),
}))()`);
console.log("  sample:", clicked, "| rendered:", JSON.stringify(loaded));

const measured = await ev(`(async () => {
  const btn = [...document.querySelectorAll("button")].find((b) => /^(并排|单栏|Side by side|One column)$/.test((b.textContent || "").trim()));
  if (!btn) return { has: false };
  const shape = () => {
    const grid = document.querySelector('[data-testid="docx-split"] [class*="grid"]');
    const flow = document.querySelector('[data-testid="docx-flow"] > div');
    return {
      grid: grid ? getComputedStyle(grid).gridTemplateColumns : null,
      flowWidth: flow ? Math.round(flow.getBoundingClientRect().width) : null,
    };
  };
  const before = shape();
  const label = btn.textContent.trim();
  btn.click();
  await new Promise((r) => setTimeout(r, 1500));
  const after = shape();
  // A document narrowed to nothing is the failure that started this: the switch worked, and the
  // page it produced was unreadable.
  const readable = (after.flowWidth ?? 0) > 300 || after.grid == null;
  return { has: true, label, before, after, readable, flipped: JSON.stringify(before) !== JSON.stringify(after) };
})()`);

if (!measured.has) failures.push("local: no one/two-column switch");
else if (!measured.flipped) failures.push(`local: the switch did not change the layout — ${JSON.stringify(measured)}`);
else if (!measured.readable) failures.push(`local: one column left the document unreadable — ${JSON.stringify(measured)}`);
else console.log(`  local      ${JSON.stringify(measured.before)} → ${JSON.stringify(measured.after)}`);

ws.close();
chrome.kill();
viewer.kill();
if (failures.length) {
  console.error("\nFAILURES:\n" + failures.map((f) => "  - " + f).join("\n"));
  process.exit(1);
}
console.log("\n[local-layout] the local viewer's switch exists, flips, and leaves the document readable");
