/**
 * The one/two-column switch must exist, in the same place, for every family that has two views —
 * and it must actually flip the layout.
 *
 * It was reported broken twice. First it lived inside the code tab bar, so Word, slides and PDF
 * (which have no tabs) never rendered one. Then it rendered but Word's grid stayed two-column,
 * because a generic "did anything change" assertion was satisfied by its change list appearing.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const BASE = process.env.LAYOUT_BASE ?? "http://127.0.0.1:5199";
const CHROME = path.join(
  os.homedir(),
  "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
);
if (!existsSync(CHROME)) {
  console.log("[layout] no Chromium at the Playwright cache path — skipping");
  process.exit(0);
}

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

const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=9224", `--user-data-dir=${os.tmpdir()}/diffs-layout`, "about:blank"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 3500));

const failures = [];
// Every family that has two views. Excel is deliberately absent: a sheet is one grid whose cells
// carry both sides (old value → new value), so there is no second document to show or hide. Listing
// it here made the test fail on a capability the product does not have.
for (const [name, idx] of [["code", 0], ["markdown", 5], ["word", 7], ["ppt", 8], ["pdf", 9]]) {
  const tab = await (await fetch("http://127.0.0.1:9224/json/new?about:blank", { method: "PUT" })).json();
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
  await send("Page.navigate", { url: `${BASE}/#/compare?ls=${Date.now()}-${idx}` });
  await new Promise((r) => setTimeout(r, 4000));
  await ev(`[...document.querySelectorAll("button[title]")][${idx}]?.click()`);
  for (let i = 0; i < 40; i++) {
    if (await ev(`!!document.querySelector('[data-testid="result-key"]')`)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  await new Promise((r) => setTimeout(r, 2500));

  const measured = await ev(`(async () => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => /左右并排|Side by side/.test(b.textContent || "") || /side by side/i.test(b.getAttribute("title") || ""),
    );
    if (!btn) return { has: false };
    const shape = () => {
      // Measured on the document body itself, not on the change list: the list moving is what a
      // "did anything change" assertion sees, and it is not what the switch is for. Word once
      // reported "flipped" while its two document columns were still two columns.
      const aside = document.querySelector("aside");
      const word = document.querySelector('[data-testid="docx-split"] [class*="grid"]');
      const split = document.querySelector('[data-testid="semantic-split"]');
      const flow = document.querySelector('[data-testid="docx-flow"] > div');
      return {
        aside: aside ? Math.round(aside.getBoundingClientRect().width) : null,
        wordGrid: word ? getComputedStyle(word).gridTemplateColumns : null,
        flowWidth: flow ? Math.round(flow.getBoundingClientRect().width) : null,
        split: !!split,
      };
    };
    const before = shape();
    btn.click();
    await new Promise((r) => setTimeout(r, 1500));
    const after = shape();
    const flipped =
      before.flowWidth != null && after.flowWidth != null
        ? Math.abs(after.flowWidth - before.flowWidth) > 40 && after.flowWidth > 300
        : before.wordGrid ? !after.wordGrid :
      before.aside != null && after.aside != null ? before.aside !== after.aside :
      before.split !== after.split;
    return { has: true, before, after, flipped };
  })()`);

  if (!measured.has) failures.push(`${name}: no one/two-column switch`);
  else if (!measured.flipped) failures.push(`${name}: the switch did not flip the layout — ${JSON.stringify(measured)}`);
  else console.log(`  ${name.padEnd(10)} ${JSON.stringify(measured.before)} → ${JSON.stringify(measured.after)}`);
  ws.close();
}

chrome.kill();
preview.kill();
if (failures.length) {
  console.error("\nFAILURES:\n" + failures.map((f) => "  - " + f).join("\n"));
  process.exit(1);
}
console.log("\n[layout] the switch exists and flips the layout for every two-view family");
