/**
 * Every "how to use this" command the site prints, executed.
 *
 * Four times this project has told a reader to run something that does not work: `pnpm deploy`
 * needing credentials nobody else has, a VS Code extension that is not in any marketplace,
 * `npx diffs mcp` where `diffs` is not the package, and `npm i @diffs/diff-tool` for a package that
 * returns `{"error":"Not found"}`. Each was written into a snippet and never run.
 *
 * This runs the two that can be run locally — the HTTP endpoint and the SDK import — against a live
 * viewer, and fails if either does not produce a portable result.
 *
 *   node scripts/check-docs-commands.mjs
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const BASE = "http://127.0.0.1:5291";
const dir = mkdtempSync(path.join(tmpdir(), "diffs-docs-cmd-"));
const a = path.join(dir, "a.ts");
const b = path.join(dir, "b.ts");
writeFileSync(a, "const a = 1;\n");
writeFileSync(b, "const a = 2;\n");

const viewer = spawn(process.execPath, [path.join(ROOT, "apps/cli/lib/bin.js"), "local", "--port", "5291", "--no-open"], { cwd: ROOT, stdio: "ignore" });
const failures = [];
try {
  for (let i = 0; i < 80; i++) {
    try {
      await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(500) });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  // The snippet on the config page: `POST /api/diff { "old": ..., "new": ... }`
  try {
    const res = await fetch(`${BASE}/api/diff`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ old: a, new: b }),
      signal: AbortSignal.timeout(20000),
    });
    const body = await res.json();
    if (body?.schema !== "diffs.work/portable@1") failures.push(`POST /api/diff returned ${JSON.stringify(body).slice(0, 120)}`);
    else console.log(`  POST /api/diff        ${body.summary}`);
  } catch (e) {
    failures.push(`POST /api/diff failed: ${String(e).slice(0, 120)}`);
  }

  // The SDK row: `import { compareFiles } from "<repo>/packages/diff-tool/src/index.ts"`
  try {
    const mod = await import(path.join(ROOT, "packages/diff-tool/src/index.ts"));
    const r = await mod.compareFiles({ old: a, new: b });
    if (r?.schema !== "diffs.work/portable@1") failures.push(`compareFiles returned ${JSON.stringify(r).slice(0, 120)}`);
    else console.log(`  compareFiles          ${r.summary}`);
  } catch (e) {
    failures.push(`the SDK import path does not load: ${String(e).slice(0, 160)}`);
  }
} finally {
  viewer.kill();
}

if (failures.length) {
  console.error("\nFAILURES:\n" + failures.map((f) => "  - " + f).join("\n"));
  process.exit(1);
}
console.log("\n[docs-commands] every locally runnable command the site prints actually runs");
