/**
 * Assembling apps/local/public from the engines — the same normalization
 * sync-engine.mjs does for the website. Run before build:local.
 */
import { execFileSync } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

// Keep the sample mirror in step: examples/ is the single source of truth for both sites.
execFileSync("node", [path.join(ROOT, "scripts/sync-examples.mjs")], { stdio: "inherit" });
const LOCAL_PUBLIC = path.join(ROOT, "apps/local/public");
const ENGINE_SRC = path.join(ROOT, "vendored/engine");

// engines: pdf.js + (when present) tessdata for OCR; the rule kernels come from the website
if (!existsSync(ENGINE_SRC)) {
  console.warn("[sync-local] vendored/engine absent: local viewer falls back to the TypeScript engines");
  process.exit(0);
}
await rm(path.join(LOCAL_PUBLIC, "engine"), { recursive: true, force: true });
if (existsSync(path.join(ENGINE_SRC, "pdfjs"))) {
  await cp(path.join(ENGINE_SRC, "pdfjs"), path.join(LOCAL_PUBLIC, "engine/pdfjs"), { recursive: true });
}

// the Rust kernels ship from wherever the website keeps them (they are built outside this repo)
const RULES_SRC = path.join(ROOT, "apps/website/public/engine/rules-core");
if (existsSync(RULES_SRC)) {
  await mkdir(path.join(LOCAL_PUBLIC, "engine/rules-core"), { recursive: true });
  await cp(RULES_SRC, path.join(LOCAL_PUBLIC, "engine/rules-core"), { recursive: true });
}

console.log("[sync-local] apps/local/public/engine ready");
