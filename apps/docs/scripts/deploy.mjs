/** Deploy apps/docs to Cloudflare Pages (project: diffs-docs). */
import { existsSync, readdirSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIST = path.join(ROOT, "dist");
const PROJECT = process.env.CF_PAGES_PROJECT || "diffs-docs";
const argv = process.argv.slice(2);
const i = argv.indexOf("--branch");
const BRANCH = (i >= 0 ? argv[i + 1] : undefined) || process.env.CF_PAGES_BRANCH || "main";

const INDEX = path.join(DIST, "index.html");
if (!existsSync(INDEX)) {
  console.error("[deploy] apps/docs/dist/index.html not found — run `pnpm build` first.");
  process.exit(1);
}

// Refuse to deploy a build older than its sources. This has bitten twice: edit, build, edit again,
// deploy — and the site serves the middle state while the build looks fine. Comparing the newest
// source mtime against the build is cheap and catches exactly that.
const SRC = path.join(ROOT, "src");
function newestMtime(dir) {
  let newest = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const m = statSync(p);
    newest = Math.max(newest, e.isDirectory() ? newestMtime(p) : m.mtimeMs);
  }
  return newest;
}
const built = statSync(path.join(DIST, "integrate/agents/index.html")).mtimeMs;
const changed = newestMtime(SRC);
if (changed > built) {
  const mins = Math.round((changed - built) / 60000);
  console.error(
    `[deploy] the build is older than ${path.relative(ROOT, SRC)} (by ${mins} min).\n` +
      `         Run \`pnpm build\` first — deploying now would publish the previous state.`,
  );
  process.exit(1);
}
const child = spawn("npx", ["wrangler", "pages", "deploy", DIST, `--project-name=${PROJECT}`, `--branch=${BRANCH}`], {
  cwd: ROOT,
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (c) => process.exit(c ?? 0));
