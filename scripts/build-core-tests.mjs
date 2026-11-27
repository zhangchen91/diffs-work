/** Bundle the TS diff packages for node --test (no TS loader in CI). */
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const jobs = [
  ["packages/core-markdown/src/index.ts", "packages/core-markdown/.test/bundle.mjs", ["@diffs/diff-core"]],
  ["packages/core-code-ast/src/index.ts", "packages/core-code-ast/.test/bundle.mjs", ["@diffs/diff-core"]],
  ["packages/core-xml/src/index.ts", "packages/core-xml/.test/bundle.mjs", []],
];
for (const [entry, out, external] of jobs) {
  await build({
    entryPoints: [path.join(ROOT, entry)],
    outfile: path.join(ROOT, out),
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "error",
    external,
    alias: { "@diffs/diff-core": path.join(ROOT, "packages/diff-core/src/index.ts") },
  });
}
