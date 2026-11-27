/**
 * Cloudflare Pages (and any fresh clone) has no engine binaries: they are build
 * input, not source. This hook runs before `pnpm build` and only *warns* when they
 * are missing, because the site is designed to degrade instead of failing:
 *
 *   no rules-core.wasm   → code/Markdown/Excel fall back to the TypeScript engines
 *   no pdf.js            → PDF hands the pair to the local viewer
 *
 * CI sets ENGINE_STRICT=1 to turn the warning into a failure, so a release never
 * silently ships without the kernels.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const need = [
  ["apps/website/public/engine/rules-core/diffs-engine.wasm", "pnpm build:rules"],
  ["apps/website/public/engine/pdfjs/pdf.mjs", "pnpm sync:engine | pnpm fetch:engine"],
];

const missing = need.filter(([p]) => !existsSync(path.join(ROOT, p)));
if (!missing.length) {
  console.log("[engine] all engine binaries present");
  process.exit(0);
}
for (const [p, how] of missing) console.warn(`[engine] missing ${p} → run \`${how}\``);
if (process.env.ENGINE_STRICT === "1") {
  console.error("[engine] ENGINE_STRICT=1: refusing to build without engines");
  process.exit(1);
}
console.warn("[engine] continuing: affected families will degrade to the TypeScript engines");
