/**
 * Deploy the built site to Cloudflare Pages.
 *
 *   cd website && pnpm deploy              # 独立部署 website（推荐）
 *   node scripts/deploy-cloudflare.mjs    # 等价
 *   node scripts/deploy-cloudflare.mjs --branch preview
 *
 * Auth: CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID env,
 *       or a local `npx wrangler login` session.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_DIST = path.join(ROOT, "apps/website/out");
const PROJECT = process.env.CF_PAGES_PROJECT || "diffs-work";

const argv = process.argv.slice(2);
const branchIdx = argv.indexOf("--branch");
const BRANCH =
  (branchIdx >= 0 ? argv[branchIdx + 1] : undefined) || process.env.CF_PAGES_BRANCH || "main";
const distArg = argv.indexOf("--dist");
const dist = path.resolve(ROOT, distArg >= 0 ? argv[distArg + 1] : DEFAULT_DIST);

if (!existsSync(path.join(dist, "index.html"))) {
  console.error(`[deploy] ${path.relative(ROOT, dist)}/index.html not found — run \`pnpm build\` first.`);
  process.exit(1);
}

if (!process.env.CLOUDFLARE_API_TOKEN) {
  console.log("[deploy] CLOUDFLARE_API_TOKEN not set → falling back to local `wrangler login` credentials.");
}

const args = ["wrangler", "pages", "deploy", dist, `--project-name=${PROJECT}`, `--branch=${BRANCH}`];

// config lives with the website (independent deploy unit)
const cwd = path.join(ROOT, "website");
const child = spawn("npx", args, { cwd, stdio: "inherit", env: process.env });
child.on("exit", async (code) => {
  if (code !== 0) process.exit(code ?? 1);
  await mkdir(path.join(ROOT, ".deploy"), { recursive: true });
  await writeFile(
    path.join(ROOT, ".deploy/last-deploy.json"),
    JSON.stringify({ project: PROJECT, branch: BRANCH, dist, at: new Date().toISOString() }, null, 2),
  );
  console.log(`[deploy] done → project ${PROJECT} (branch ${BRANCH})`);
});
