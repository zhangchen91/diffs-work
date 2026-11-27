/** Bundle the PDF kernel for node tests (pdf.js itself is imported from public/). */
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
await build({
  entryPoints: [path.join(ROOT, "packages/core-pdf/src/index.ts")],
  outfile: path.join(ROOT, "packages/core-pdf/.test/bundle.mjs"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  logLevel: "error",
  external: ["@diffs/engine-bundle"],
  alias: {
    "@diffs/engine-bundle": path.join(ROOT, "packages/engine-bundle/src/pdf.ts"),
  },
});
console.log("[core-pdf] test bundle ready");
