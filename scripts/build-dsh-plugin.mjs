/** Bundle apps/dsh-plugin/src/index.ts → apps/dsh-plugin/lib/index.js (plain ESM, node). */
import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

// Browser half: TypeScript source → one IIFE for the client module table.
// It must stay a single self-contained file (no imports survive), because the host
// loads it through `window.__ModuleLoader__.load`, not through a bundler.
await build({
  entryPoints: [path.join(ROOT, "apps/dsh-plugin/src/client.ts")],
  outfile: path.join(ROOT, "apps/dsh-plugin/lib/client.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2022",
  sourcemap: false,
  legalComments: "none",
  // the type-only import disappears on its own; everything else must stay inline
  external: [],
  logLevel: "info",
});

// The kernels ship with the package: the host half loads them from ./engine.
// A fresh clone has none (they are build inputs), and the plugin still works without
// them: the tool degrades to the TypeScript diff, which is the documented behaviour.
const KERNEL_SRC = path.join(ROOT, "apps/website/public/engine/rules-core/diffs-engine.wasm");
const KERNEL_DST = path.join(ROOT, "apps/dsh-plugin/engine/diffs-engine.wasm");
if (existsSync(KERNEL_SRC)) {
  await mkdir(path.dirname(KERNEL_DST), { recursive: true });
  await copyFile(KERNEL_SRC, KERNEL_DST);
} else {
  console.warn("[dsh-plugin] no rules-core.wasm to ship: the plugin will use the TypeScript engines");
}

await build({
  entryPoints: [path.join(ROOT, "apps/dsh-plugin/src/index.ts")],
  outfile: path.join(ROOT, "apps/dsh-plugin/lib/index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: false,
  legalComments: "none",
  // schemastery is resolved at runtime from the dsh installation, never bundled
  // Resolved at runtime from the dsh installation, never bundled: these are the harness's own
  // service packages, and a second copy would break the single-instance services they carry.
  external: ["@deepseek-ai/schemastery"],
  logLevel: "info",
});
