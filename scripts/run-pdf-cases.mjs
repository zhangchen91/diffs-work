#!/usr/bin/env node
/**
 * Run the PDF cases through the compare page, because PDF comparison uses pdf.js in the
 * browser rather than the kernel.
 *
 *   pnpm build:website            # the cases are served from out/pdf-cases
 *   node scripts/run-pdf-cases.mjs
 *
 * Serves the built site on a fixed port and drives one page per case.
 */
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUT = path.join(ROOT, "apps/website/out");
const CASES = path.join(ROOT, "test-cases/pdf");
const PORT = 5288;

if (!existsSync(path.join(OUT, "index.html"))) {
  console.error("build the site first: pnpm build:website");
  process.exit(1);
}
// the page fetches the case files, so they have to be inside the served tree
mkdirSync(path.join(OUT, "pdf-cases"), { recursive: true });
for (const f of readdirSync(CASES)) if (f.endsWith(".pdf")) cpSync(path.join(CASES, f), path.join(OUT, "pdf-cases", f));

const cases = readdirSync(CASES)
  .filter((f) => f.endsWith(".case.json"))
  .sort()
  .map((f) => ({ ...JSON.parse(readFileSync(path.join(CASES, f), "utf8")), file: f }));
if (!cases.length) {
  console.error("no pdf cases");
  process.exit(1);
}

// spawnSync would block here and the server would never come up
const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
  cwd: OUT,
  detached: true,
  stdio: "ignore",
});
server.unref();
// give it a moment to bind
await new Promise((r) => setTimeout(r, 1500));

const script = `
const task = await taskSpace("pdfcases:" + Date.now());
const out = [];
const cases = ${JSON.stringify(cases)};
for (const c of cases) {
  const page = await task.newPage();
  let row = { name: c.name, key: "" };
  try {
    await page.goto("http://127.0.0.1:${PORT}/index.html#/compare", { timeout: 60000 });
    await page.waitForTimeout(2500);
    await page.evaluate(async ([before, after]) => {
      const grab = async (n) => { const r = await fetch("/pdf-cases/" + n); return new File([await r.arrayBuffer()], n, { type: "application/pdf" }); };
      const inputs = document.querySelectorAll('input[type="file"]');
      for (const [i, name] of [[0, before], [1, after]]) {
        const dt = new DataTransfer();
        dt.items.add(await grab(name));
        inputs[i].files = dt.files;
        inputs[i].dispatchEvent(new Event("change", { bubbles: true }));
      }
    }, [c.before, c.after]);
    for (let t = 0; t < 60; t++) {
      await page.waitForTimeout(500);
      const k = await page.evaluate(() => document.querySelector('[data-testid="result-key"]')?.textContent ?? "");
      if (k.startsWith("pdf:")) { row.key = k; break; }
    }
  } catch (e) {
    row.error = String(e).slice(0, 80);
  }
  out.push(row);
}
console.log("PDFCASES " + JSON.stringify(out));
await task.finish({ keep: [] });
`;

const run = spawnSync("ego-browser", ["nodejs"], { input: script, encoding: "utf8", maxBuffer: 8 << 20 });
const text = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
const at = text.lastIndexOf("PDFCASES ");
if (at < 0) {
  console.error(text.slice(-600) || "no output from ego");
  spawnSync("bash", ["-c", `pkill -f "http.server ${PORT}" || true`]);
  process.exit(1);
}
let rows;
try {
  rows = JSON.parse(text.slice(at + "PDFCASES ".length).split("\n")[0]);
} catch (e) {
  console.error(`could not read the result: ${e.message}`);
  spawnSync("bash", ["-c", `pkill -f "http.server ${PORT}" || true`]);
  process.exit(1);
}
spawnSync("bash", ["-c", `pkill -f "http.server ${PORT}" || true`]);

let failed = 0;
for (const r of rows) {
  const ok = (r.key ?? "").startsWith("pdf:");
  if (!ok) failed++;
  console.log(`  ${ok ? "✔" : "✖"} ${r.name.padEnd(12)} ${r.key || r.error || "无结果"}`);
}
console.log(`\n${rows.length - failed}/${rows.length} 通过`);
process.exit(failed ? 1 : 0);
