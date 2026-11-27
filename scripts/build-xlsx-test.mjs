/** Bundle @diffs/core-xlsx (+ its TS deps) for node tests: no TS loader needed. */
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
await build({
  entryPoints: [path.join(ROOT, "packages/core-xlsx/src/index.ts")],
  outfile: path.join(ROOT, "packages/core-xlsx/.test/bundle.mjs"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  logLevel: "error",
});
