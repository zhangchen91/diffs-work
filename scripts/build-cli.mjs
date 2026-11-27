/**
 * Compile apps/cli TypeScript → apps/cli/lib (one bundle per entry).
 *
 * The CLI is published to npm as `diffs`; the repo keeps source only. Bundling keeps the
 * install footprint small (no workspace packages along for the ride).
 */
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const CLI = path.join(ROOT, "apps/cli");

await build({
  entryPoints: [path.join(CLI, "src/bin.ts")],
  outfile: path.join(CLI, "lib/bin.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  external: ["node:*"],
  legalComments: "none",
  // esbuild's banner lands after the tool's own prelude; write the shebang ourselves below
  banner: {},
  logLevel: "info",
});

// A Node ESM entry point must start with the shebang on line 1.
const out = path.join(CLI, "lib/bin.js");
const { readFile, writeFile, chmod } = await import("node:fs/promises");
const body = await readFile(out, "utf8");
if (!body.startsWith("#!")) await writeFile(out, `#!/usr/bin/env node\n${body}`);
await chmod(out, 0o755);
