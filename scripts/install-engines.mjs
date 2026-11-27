/**
 * Runs once after `pnpm install`.
 *
 * The repository ships the comparison kernel (rules-core.wasm) and the small engine
 * files, so a clone works immediately. The heavier third-party runtimes (pdf.js for
 * PDF, tesseract for OCR) live under `vendored/engine` and are copied into the apps
 * here, so the tracked tree stays small while a clone still renders every family.
 *
 * Never fails the install: a missing engine only disables its own family.
 */
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
if (!existsSync(path.join(ROOT, "vendored/engine"))) {
  console.log("[install] no vendored engines: text, code, markdown and Excel still work");
  process.exit(0);
}
for (const script of ["sync-engine.mjs", "sync-local.mjs"]) {
  try {
    execFileSync(process.execPath, [path.join(ROOT, "scripts", script)], { stdio: "inherit", cwd: ROOT });
  } catch (e) {
    console.log(`[install] ${script} skipped: ${String(e.message).split("\n")[0]}`);
  }
}
