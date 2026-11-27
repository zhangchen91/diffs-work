/**
 * Normalizes the closed-source + third-party engine bundles into the site layout:
 *
 *   vendored/engine/pdfjs/*                                         →  public/engine/pdfjs/
 *
 * Run after dropping a new engine build in `vendored/engine/`.
 */
import { cp, mkdir, readdir, stat, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const VENDOR = path.join(ROOT, "vendored/engine");
const PUBLIC = path.join(ROOT, "apps/website/public/engine");

async function main() {
  await mkdir(VENDOR, { recursive: true });
  await mkdir(PUBLIC, { recursive: true });

  const pdf = path.join(VENDOR, "pdfjs");
  if (existsSync(pdf)) {
    await cp(pdf, path.join(PUBLIC, "pdfjs"), { recursive: true });
  }

  // tesseract / tessdata are no longer copied: no code path loads them (OCR is not implemented),
  // and they were 19 MB of dead weight in every build.

  const listing = await readdir(PUBLIC);
  console.log("[sync-engine] public/engine →", listing.join(", "));
  let total = 0;
  for (const f of listing) total += await du(path.join(PUBLIC, f));
  console.log(`[sync-engine] ${(total / 1024 / 1024).toFixed(1)} MB total`);
}

async function du(p) {
  const st = await stat(p);
  if (!st.isDirectory()) return st.size;
  let sum = 0;
  for (const f of await readdir(p)) sum += await du(path.join(p, f));
  return sum;
}

main().catch((e) => {
  console.error("[sync-engine] failed:", e);
  process.exit(1);
});