/**
 * Run test files, refusing to pass when there are none.
 *
 * `node --test some/dir/*.test.mjs` exits 0 when the glob matches nothing — it reports
 * "tests 0, pass 0, fail 0" and calls that success. That is how the kernel-source suite sat green
 * in CI while checking nothing, and every suite here uses the same shape.
 *
 *   node scripts/run-tests.mjs <dir-or-glob> [...]
 *
 * Expands each argument, and fails if any of them yields no files (so a renamed directory or a
 * dropped suffix is loud), unless --allow-empty is given for that argument by name.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const allowEmpty = new Set(args.filter((a) => a.startsWith("--allow-empty=")).map((a) => a.slice(14)));
const targets = args.filter((a) => !a.startsWith("--"));

function expand(target) {
  const abs = path.resolve(ROOT, target);
  // a directory: every *.test.mjs inside it
  if (existsSync(abs) && !target.includes("*")) {
    if (!/\.m?js$/.test(target)) {
      return readdirSync(abs)
        .filter((f) => f.endsWith(".test.mjs"))
        .map((f) => path.join(abs, f));
    }
    return existsSync(abs) ? [abs] : [];
  }
  // a glob: only the trailing `*` form is used in this repo
  const star = target.indexOf("*");
  if (star < 0) return [];
  const dir = path.resolve(ROOT, path.dirname(target));
  if (!existsSync(dir)) return [];
  const suffix = target.slice(star + 1);
  return readdirSync(dir)
    .filter((f) => f.endsWith(suffix))
    .map((f) => path.join(dir, f));
}

const files = [];
for (const t of targets) {
  const found = expand(t);
  if (!found.length && !allowEmpty.has(t)) {
    console.error(`[run-tests] ${t} matches no test files — refusing to report success`);
    process.exit(1);
  }
  files.push(...found);
}
if (!files.length) {
  console.error("[run-tests] no test files at all");
  process.exit(1);
}
const r = spawnSync(process.execPath, ["--test", ...files], { cwd: ROOT, stdio: "inherit" });
process.exit(r.status ?? 1);
