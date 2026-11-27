/**
 * Build the Chrome/Edge bundle: dist/ contains exactly what you load as an
 * unpacked extension (manifest + background + content + popup + icons).
 *   node build.mjs         → dist/
 *   node build.mjs --zip   → diffs-work-extension-<version>.zip
 */
import { cp, mkdir, rm, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)));
const DIST = path.join(ROOT, "dist");

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });

const manifest = JSON.parse(await readFile(path.join(ROOT, "manifest.json"), "utf8"));

// All three entry points are TypeScript; each becomes one self-contained file because
// MV3 service workers and content scripts cannot import from a shared bundle.
const { build } = await import("esbuild");
await build({
  entryPoints: [path.join(ROOT, "src/background.ts")],
  outfile: path.join(DIST, "background.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  legalComments: "none",
  logLevel: "warning",
});
await build({
  entryPoints: [path.join(ROOT, "src/content.ts")],
  outfile: path.join(DIST, "content.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  legalComments: "none",
  logLevel: "warning",
});
await build({
  entryPoints: [path.join(ROOT, "src/popup.ts")],
  outfile: path.join(DIST, "popup/popup.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  legalComments: "none",
  logLevel: "warning",
});
// static popup assets travel next to the compiled script
for (const f of await readdir(path.join(ROOT, "popup"))) {
  if (f.endsWith(".js")) continue;
  await cp(path.join(ROOT, "popup", f), path.join(DIST, "popup", f));
}
await mkdir(path.join(DIST, "icons"), { recursive: true });
for (const s of [16, 32, 48, 128]) {
  await cp(path.join(ROOT, `icons/icon${s}.png`), path.join(DIST, `icons/icon${s}.png`));
}
await writeFile(path.join(DIST, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

console.log(`[extension] dist/ ready — version ${manifest.version}, mv3`);

if (process.argv.includes("--zip")) {
  const out = path.join(ROOT, `diffs-work-extension-${manifest.version}.zip`);
  await rm(out, { force: true });
  execFileSync("zip", ["-rq", out, "."], { cwd: DIST });
  console.log(`[extension] ${path.basename(out)}`);
}
