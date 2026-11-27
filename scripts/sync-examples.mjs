/**
 * Copy `examples/` (the source of truth) into the web app's public dir, verbatim.
 *
 *   examples/code/pricebook-v1.ts  →  public/examples/code/pricebook-v1.ts
 *
 * The destination is replaced as a whole: sample files were renamed and re-foldered, and a
 * stale copy is worse than none — the site would serve an old fixture for a URL that no
 * longer exists in the repo (a 200 with the SPA fallback, which is exactly the bug that
 * made Excel comparisons fail: the kernel received HTML and said "not a zip").
 */
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const SRC = path.join(ROOT, "examples");
// The acceptance fixtures live in test-cases/all-ops/ and the site shows the same pairs. They
// used to be copied into examples/code/allops-* so both could point at one place, which meant two
// copies of every file that had to be kept in step. One source, published at /examples/allops/.
const ALLOPS = path.join(ROOT, "test-cases/all-ops");

for (const app of ["website", "local"]) {
  const dst = path.join(ROOT, `apps/${app}/public/examples`);
  await rm(dst, { recursive: true, force: true });
  await mkdir(dst, { recursive: true });
  await cp(SRC, dst, { recursive: true, filter: (src) => !src.endsWith("README.md") });
  await cp(ALLOPS, path.join(dst, "allops"), {
    recursive: true,
    filter: (src) => !src.includes("_reference") && !src.endsWith("expected.json"),
  });
  console.log(`[sync-examples] examples + test-cases/all-ops → apps/${app}/public/examples`);
}
