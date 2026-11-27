/**
 * Check the four document views on a real 390×844 phone viewport.
 *
 * Reported bug: "Word/PPT/PDF 的 diff 界面也没适配移动端，主区域只有超窄的一部分". The layout
 * had fixed-width sidebars (320px, 288px, 208px) that never moved, leaving the page itself a
 * sliver. CSS classes are not evidence — this measures the rendered geometry.
 *
 * Needs a Chromium with remote debugging on 9222 (see the header of `run()`), because a headless
 * browser cannot be resized through the ego API.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const BASE = process.env.MOBILE_BASE ?? "http://127.0.0.1:5199";
const CHROME = path.join(
  os.homedir(),
  "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
);

if (!existsSync(CHROME)) {
  console.log("[mobile] no Chromium at the Playwright cache path — skipping");
  process.exit(0);
}

// The preview server is a prerequisite: start it if nothing answers on the port.
const preview = spawn("pnpm", ["exec", "vite", "preview", "--port", "5199", "--strictPort", "--host", "127.0.0.1"], {
  cwd: path.join(ROOT, "apps/website"),
  stdio: "ignore",
});
for (let i = 0; i < 40; i++) {
  try {
    await fetch(BASE, { signal: AbortSignal.timeout(500) });
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 250));
  }
}

const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=9223", `--user-data-dir=${os.tmpdir()}/diffs-mobile`, "about:blank"], {
  stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 3500));

const wsUrl = (await (await fetch("http://127.0.0.1:9223/json/new?about:blank", { method: "PUT" })).json()).webSocketDebuggerUrl;
const ws = new WebSocket(wsUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

const failures = [];
for (const [name, idx] of [["typescript", 0], ["markdown", 2], ["excel", 3], ["word", 4], ["ppt", 5], ["pdf", 6]]) {
  await send("Page.navigate", { url: `${BASE}/#/compare?m=${Date.now()}-${idx}` });
  await new Promise((r) => setTimeout(r, 3000));
  await evalJs(`[...document.querySelectorAll("button[title]")][${idx}]?.click()`);
  await new Promise((r) => setTimeout(r, 11000));
  const m = await evalJs(`(() => ({
    vw: window.innerWidth,
    body: document.body.clientWidth,
    sidebars: [...document.querySelectorAll("aside")].map(a => ({ w: Math.round(a.getBoundingClientRect().width), top: Math.round(a.getBoundingClientRect().top) })),
    overflow: document.documentElement.scrollWidth > document.body.clientWidth + 4,
  }))()`);
  const line = `${name.padEnd(12)} vw=${m.vw} sidebars=${JSON.stringify(m.sidebars)} overflow=${m.overflow}`;
  console.log("  " + line);
  if (m.vw !== 390) failures.push(`${name}: viewport is ${m.vw}, not 390`);
  if (m.overflow) failures.push(`${name}: the page scrolls sideways on a phone`);
  // a fixed-width sidebar narrower than the phone is the bug that was reported
  for (const s of m.sidebars) {
    if (s.w < 300) failures.push(`${name}: a sidebar is only ${s.w}px wide on a 390px screen`);
  }
}

// Every page, not just the ones with a diff: /config, /download and /formats each widened the
// document past the screen on a phone.
const ROUTES = ["/", "/compare", "/config", "/download", "/formats", "/how", "/verify", "/about"];
for (const route of ROUTES) {
  await send("Page.navigate", { url: `${BASE}/#${route}` });
  await new Promise((r) => setTimeout(r, 2500));
  const m = await evalJs(`({ body: document.body.clientWidth, scroll: document.documentElement.scrollWidth })`);
  console.log(`  page ${route.padEnd(11)} body=${m.body} scroll=${m.scroll}`);
  if (m.scroll > m.body + 4) failures.push(`${route}: the page is ${m.scroll}px wide on a ${m.body}px screen`);
}

ws.close();
chrome.kill();
preview.kill();
if (failures.length) {
  console.error("\nFAILURES:\n" + failures.map((f) => "  - " + f).join("\n"));
  process.exit(1);
}
console.log(`\n[mobile] all ${ROUTES.length} views fit a 390px screen`);
