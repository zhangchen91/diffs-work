/**
 * Build the Rust comparison kernels and publish the binary.
 *
 *   node scripts/build-rules-core.mjs        # cargo build + copy into both apps
 *
 * The crate lives in apps/engine-core, which .gitignore keeps out of the public
 * repository: only `public/engine/rules-core/diffs-engine.wasm` is published.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const CRATE = path.join(ROOT, "apps/engine-core");
if (!existsSync(CRATE)) {
  console.error("[rules-core] apps/engine-core is missing (it is not committed; restore it from your private repo)");
  process.exit(1);
}

const env = {
  ...process.env,
  // this toolchain's rust-lld cannot load libLLVM.dylib on macOS; Homebrew's lld can
  CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_LINKER:
    process.env.CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_LINKER || "/opt/homebrew/opt/lld@22/bin/wasm-ld",
};

console.log("[rules-core] cargo build --release --target wasm32-unknown-unknown");
execFileSync("cargo", ["build", "--release", "--target", "wasm32-unknown-unknown"], { cwd: CRATE, env, stdio: "inherit" });

const built = path.join(CRATE, "target/wasm32-unknown-unknown/release/diffs_engine.wasm");
if (!existsSync(built)) {
  console.error("[rules-core] build produced no wasm");
  process.exit(1);
}
for (const dest of ["apps/website/public/engine/rules-core", "apps/local/public/engine/rules-core"]) {
  const dir = path.join(ROOT, dest);
  mkdirSync(dir, { recursive: true });
  copyFileSync(built, path.join(dir, "diffs-engine.wasm"));
  console.log(`[rules-core] → ${dest}/diffs-engine.wasm (${(statSync(built).size / 1024).toFixed(0)} KB)`);
}
