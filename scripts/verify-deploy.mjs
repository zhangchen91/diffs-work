/**
 * After a deploy: every built file must be fetchable from the live site.
 *
 * Three deployments shipped incomplete: an English chunk, an icon chunk, and once an empty
 * output folder. The deployment API reported success each time, so the only reliable check
 * is to fetch what the build produced.
 *
 *   node scripts/verify-deploy.mjs [base-url] [app-output-dir]
 *
 *   pnpm verify:deploy
 *   node scripts/verify-deploy.mjs https://diffs-docs.pages.dev apps/docs/dist
 */
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const BASE = (process.argv[2] ?? "https://diffs-work.pages.dev").replace(/\/$/, "");
// default: the website build. Pass a second argument for another app's output dir.
const APP = process.argv[3] ?? "apps/website/out";
const OUT = path.join(ROOT, APP);

async function walk(dir, prefix = "") {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path.join(dir, entry.name), rel)));
    else out.push(rel);
  }
  return out;
}

const files = (await walk(OUT)).filter((rel) => {
  // Cloudflare Pages owns these: the root index.html is served at `/` (and 404s under its
  // own name) and _headers is a build directive, not a downloadable file.
  if (rel === "index.html" || rel === "_headers") return false;
  return true;
});
// the biggest first: a truncated upload usually shows up on the large files
files.sort((a, b) => b.length - a.length);

let checked = 0;
const missing = [];
for (const rel of files) {
  // Cloudflare Pages serves `dir/index.html` at `dir/` and answers 404 for the file name
  // itself, so probe the directory path for those.
  const url = rel.endsWith("/index.html") ? `${BASE}/${rel.slice(0, -"index.html".length)}` : `${BASE}/${rel}`;
  let res;
  try {
    res = await fetch(url, { method: "HEAD" });
    // some hosts answer HEAD with 405; fall back to a ranged GET
    if (res.status === 405 || res.status === 501) res = await fetch(url, { headers: { range: "bytes=0-0" } });
  } catch (e) {
    missing.push(`${rel} (network: ${String(e).slice(0, 40)})`);
    continue;
  }
  checked++;
  if (!res.ok && res.status !== 206) missing.push(`${rel} → ${res.status}`);
}

console.log(`[verify-deploy] ${BASE} (${APP}): ${checked - missing.length}/${files.length} files reachable`);
// A total miss means the deployment itself is empty (Cloudflare publishing the repository
// instead of a build — see docs/deployment.md), not that a few files went astray.
if (checked > 0 && missing.length === files.length) {
  console.error("[verify-deploy] every file is missing: the deployment looks empty.");
  console.error("  Check the Pages project's build_command and destination_dir.");
}
if (missing.length) {
  console.error("[verify-deploy] missing on the live site:");
  for (const m of missing.slice(0, 20)) console.error("  " + m);
  if (missing.length > 20) console.error(`  … and ${missing.length - 20} more`);
  process.exit(1);
}
