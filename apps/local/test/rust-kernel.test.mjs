/**
 * The local viewer must serve the same Rust kernel the site uses, and that
 * binary must expose the ABI the loader expects.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
// The kernel is a build input: a fresh clone has none, so skip instead of failing.
const LOCAL_WASM = path.join(ROOT, "apps/local/public/engine/rules-core/diffs-engine.wasm");
const SKIP_NO_ENGINE = existsSync(LOCAL_WASM) ? false : "engine binary not built (pnpm build:rules && pnpm sync-local)";

test("local public dir ships the rules-core wasm with the expected ABI", { skip: SKIP_NO_ENGINE }, () => {
  const wasm = readFileSync(LOCAL_WASM);
  assert.ok(wasm.length > 100_000, `size ${wasm.length}`);
  const names = WebAssembly.Module.exports(new WebAssembly.Module(wasm)).map((e) => e.name);
  for (const n of ["diffs_handle", "diffs_alloc", "diffs_box_len", "diffs_free"]) assert.ok(names.includes(n), n);
});

const WEBSITE_WASM = path.join(ROOT, "apps/website/public/engine/rules-core/diffs-engine.wasm");
const SKIP_BOTH = existsSync(LOCAL_WASM) && existsSync(WEBSITE_WASM) ? false : "kernel binary not built on one side (pnpm build:rules && pnpm sync-local)";

test("website and local ship the same kernel bytes", { skip: SKIP_BOTH }, () => {
  const a = readFileSync(path.join(ROOT, "apps/website/public/engine/rules-core/diffs-engine.wasm"));
  const b = readFileSync(path.join(ROOT, "apps/local/public/engine/rules-core/diffs-engine.wasm"));
  assert.ok(a.equals(b), "website and local copies must match");
});
