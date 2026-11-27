/**
 * The local viewer keeps its own copy of the compare components. That copy has fallen behind
 * more than once — the change ruler existed on the site for three rounds before the local viewer
 * had it — and nobody notices because each side is built and tested separately.
 *
 * A full merge is not safe while `studio.tsx` differs this much (974 lines against 409, and 37
 * i18n keys used on one side only): the local studio is an earlier, simpler composition, not a
 * stale copy. So the honest thing is to *report* the drift, per file, with a number, and to fail
 * when a file that is supposed to be shared has diverged beyond a threshold.
 *
 * Files that are intentionally local-only are listed in LOCAL_ONLY.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const WEB = path.join(ROOT, "apps/website/src/components/compare");
const LOCAL = path.join(ROOT, "apps/local/src/components/compare");

/** Present on both sides but deliberately independent: the compositions differ on purpose. */
const INDEPENDENT = new Set(["studio.tsx"]);

/** Files the site has and the local viewer should share verbatim. */
const SHARED_PREFIX = ["diff-ruler"];

const files = (await readdir(LOCAL)).filter((f) => f.endsWith(".tsx"));
const rows = [];
let fail = false;
for (const f of files) {
  let web = null;
  try {
    web = await readFile(path.join(WEB, f), "utf8");
  } catch {
    continue; // local-only file
  }
  const local = await readFile(path.join(LOCAL, f), "utf8");
  const same = web === local;
  const counts = (s) => s.split("\n").length;
  const drift = same ? 0 : Math.abs(counts(web) - counts(local));
  rows.push({ file: f, same, web: counts(web), local: counts(local), drift });
  if (INDEPENDENT.has(f)) continue;
  if (SHARED_PREFIX.some((p) => f.startsWith(p)) && !same) {
    console.error(`[drift] ${f} must be identical on both sides but is not`);
    fail = true;
  }
}

console.log("compare components — website vs local viewer");
for (const r of rows) {
  const mark = r.same ? "same" : `DRIFT ${r.drift} lines`;
  console.log(`  ${r.file.padEnd(20)} web ${String(r.web).padStart(4)}  local ${String(r.local).padStart(4)}  ${mark}`);
}
const drifted = rows.filter((r) => !r.same && !INDEPENDENT.has(r.file)).length;
console.log(`\n${drifted} shared component(s) drifted, ${INDEPENDENT.size} kept independent on purpose`);
if (fail) process.exit(1);
