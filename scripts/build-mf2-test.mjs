/** Bundle packages/mf2 for node --test. */
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
await build({
  entryPoints: [path.join(ROOT, "packages/mf2/src/index.ts")],
  outfile: path.join(ROOT, "packages/mf2/.test/bundle.mjs"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  logLevel: "error",
});
