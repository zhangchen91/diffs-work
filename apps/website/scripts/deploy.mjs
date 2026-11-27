/**
 * Deploy apps/website to Cloudflare Pages — independent from the other apps.
 *
 *   cd apps/website && pnpm deploy            # production (branch main)
 *   cd apps/website && pnpm deploy:preview    # preview branch
 *
 * Auth: CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID, or a local `npx wrangler login`.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url))); // apps/website
const DIST = path.join(ROOT, "out");
const PROJECT = process.env.CF_PAGES_PROJECT || "diffs-work";

const argv = process.argv.slice(2);
const branchIdx = argv.indexOf("--branch");
const BRANCH = (branchIdx >= 0 ? argv[branchIdx + 1] : undefined) || process.env.CF_PAGES_BRANCH || "main";

if (!existsSync(path.join(DIST, "index.html"))) {
  console.error("[deploy] apps/website/out/index.html not found — run `pnpm build` first.");
  process.exit(1);
}

// Refuse a build older than its sources: edit, build, edit again, deploy publishes the middle
// state while everything looks fine. Same guard as apps/docs.
function newestMtime(dir) {
  let newest = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    newest = Math.max(newest, e.isDirectory() ? newestMtime(p) : statSync(p).mtimeMs);
  }
  return newest;
}
const built = statSync(path.join(DIST, "index.html")).mtimeMs;
// the site also renders shared packages, so those count as sources too
const sources = [
  path.join(ROOT, "src"),
  path.resolve(ROOT, "../../packages/i18n/src"),
  // not packages/diff-tool: the site never imports it (only a doc snippet mentions it), and its
  // churn would block every deploy for no reason.
];
for (const dir of sources) {
  if (!existsSync(dir)) continue;
  const newest = newestMtime(dir);
  if (newest > built) {
    console.error(
      `[deploy] the build is older than ${path.relative(ROOT, dir)} ` +
        `(by ${Math.round((newest - built) / 60000)} min).\n` +
        `         Run \`pnpm build\` first — deploying now would publish the previous state.`,
    );
    process.exit(1);
  }
}

const child = spawn(
  "npx",
  ["wrangler", "pages", "deploy", DIST, `--project-name=${PROJECT}`, `--branch=${BRANCH}`],
  { cwd: ROOT, stdio: "inherit", env: process.env },
);
child.on("exit", (code) => process.exit(code ?? 0));