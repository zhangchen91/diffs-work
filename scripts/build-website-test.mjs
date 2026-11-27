/** Bundle the website's pure helpers + messages for node tests. */
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
await build({
  stdin: {
    contents: [
      'export * from "./apps/website/src/lib/decode.ts";',
      'export { familyOf } from "./apps/website/src/lib/formats.ts";',
      'export { oversizeOf, MAX_TEXT_BYTES, MAX_BINARY_BYTES } from "./apps/website/src/components/compare/studio.tsx";',
      'export { charDiff } from "./packages/core-text/src/char-diff.ts";',
    ].join("\n"),
    resolveDir: ROOT,
    loader: "ts",
  },
  outfile: path.join(ROOT, "apps/website/.test/bundle.mjs"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  logLevel: "error",
  external: ["react", "lucide-react", "clsx", "tailwind-merge"],
});

for (const [entry, out] of [
  ["packages/i18n/src/messages/zh-CN.ts", "apps/website/.test/zh-CN.mjs"],
  ["packages/i18n/src/messages/en.ts", "apps/website/.test/en.mjs"],
  ["packages/mf2/src/index.ts", "apps/website/.test/mf2.mjs"],
]) {
  await build({
    entryPoints: [path.join(ROOT, entry)],
    outfile: path.join(ROOT, out),
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "error",
  });
}
