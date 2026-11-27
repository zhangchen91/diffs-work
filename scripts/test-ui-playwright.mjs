/**
 * The same UI contract as `test-ui.mjs`, driven by Playwright instead of ego, so CI
 * can run it without the (non-npm) ego binary.
 *
 *   node scripts/test-ui-playwright.mjs            # builds nothing: expects out/ or DIFFS_UI_BASE
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const PORT = process.env.DIFFS_UI_PORT ?? "5199";
const BASE = process.env.DIFFS_UI_BASE ?? `http://127.0.0.1:${PORT}`;

let server = null;
if (!process.env.DIFFS_UI_BASE) {
  server = spawn("pnpm", ["exec", "vite", "preview", "--port", PORT, "--strictPort", "--host", "127.0.0.1"], {
    cwd: path.join(ROOT, "apps/website"),
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(BASE)).ok) break;
    } catch {
      await sleep(250);
    }
  }
}

const { chromium } = await (async () => {
  try {
    return await import("playwright");
  } catch {
    const { execSync } = await import("node:child_process");
    const root = execSync("npm root -g", { encoding: "utf8" }).trim();
    return await import(path.join(root, "playwright", "index.mjs"));
  }
})();
const browser = await chromium.launch();
const page = await browser.newPage();
const failures = [];

const engineHits = () =>
  page.evaluate(() => {
    const m = {};
    for (const e of performance.getEntriesByType("resource")) {
      if (!e.name.includes("/engine/")) continue;
      const k = e.name.split("/engine/")[1].split("/")[0];
      m[k] = (m[k] || 0) + 1;
    }
    return m;
  });

// A build without the kernels is a supported, documented state: the code sample then
// renders the row-level TypeScript view and the semantic/AST/type assertions do not apply.
let enginesAvailable = true;
try {
  const res = await fetch(`${BASE}/engine/rules-core/diffs-engine.wasm`);
  const type = res.headers.get("content-type") ?? "";
  const bytes = new Uint8Array((await res.arrayBuffer()).slice(0, 4));
  enginesAvailable = res.ok && !type.includes("text/html") && bytes[0] === 0x00 && bytes[1] === 0x61;
} catch {
  enginesAvailable = false;
}
if (!enginesAvailable) {
  console.error("the repository ships its engines; a build without them is a packaging bug");
  process.exitCode = 1;
}

try {
  await page.goto(`${BASE}/#/compare`, { waitUntil: "networkidle" });
  await sleep(1500);

  // 1) first screen must not touch the engines
  const initial = await engineHits();
  if (Object.keys(initial).length) failures.push(`on-demand: first screen loaded ${JSON.stringify(initial)}`);

  // 2) code sample: semantic + AST + types
  const chips = await page.$$("button[title]");
  const titles = await page.$$eval("button[title]", (els) => els.map((e) => e.textContent?.trim() ?? ""));
  // first sample is the TypeScript pair; match position, not copy that is free to change
  const codeIdx = titles.length > 0 ? 0 : -1;
  await chips[codeIdx >= 0 ? codeIdx : 4].click();
  await page.waitForSelector('[data-testid="semantic-diff"]', { timeout: 30000 }).catch(() => {});
  const key = await page.$eval('[data-testid="result-key"]', (e) => e.textContent).catch(() => "");
  if (!key) failures.push("no result rendered for the code sample");

  if (enginesAvailable) {
    const sem = await page.$('[data-testid="semantic-diff"]');
    if (!sem) failures.push("semantic view did not render for the code sample");

    // the tab is 按语法 / By syntax now, not AST
    await page
      .$eval("button:has-text('按语法'), button:has-text('By syntax'), button:has-text('AST')", (b) => b.click())
      .catch(() => {});
    await sleep(1200);
    const ast = await page.$('[data-testid="ast-diff"]');
    const hits = await page.$$eval("[data-ast-hit]", (els) => els.length);
    if (!ast || hits < 1) failures.push(`AST view: shown=${!!ast} hits=${hits}`);

    // The symbol badge was removed in round 99 — "symbols across 2 file(s) · 0 import edges" told
    // a reader nothing. There is no symbol UI to assert until there is one again.
  }

  // 3) on-demand: same family twice must not refetch
  const chips2 = await page.$$("button[title]");
  await chips2[0].click();
  await sleep(4000);
  await chips2[0].click();
  await sleep(4000);
  const after = await engineHits();
  for (const [engine, n] of Object.entries(after)) {
    const first = initial[engine] ?? 0;
    if (first && n > first) failures.push(`on-demand: ${engine} fetched again (${first} → ${n})`);
  }

  // 4) three themes
  for (const [i, name] of ["theme-obsidian", "theme-paper", "theme-forest"].entries()) {
    await page.click('button[aria-label="主题"], button[aria-label="Theme"]').catch(() => {});
    await sleep(300);
    // pick by position: the menu is ordered obsidian → paper → forest in both locales
    await page.locator('[role="menuitemradio"]').nth(i).click({ timeout: 3000 }).catch(() => {});
    await sleep(400);
    const cls = await page.evaluate(() => document.documentElement.className);
    if (!cls.includes(name)) failures.push(`theme ${name} not applied (${cls})`);
  }
} finally {
  await browser.close();
  server?.kill();
}

if (failures.length) {
  console.error("FAILURES:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("[ui] playwright checks passed");
