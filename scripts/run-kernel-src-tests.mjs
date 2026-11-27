/**
 * Tests for the kernel's own Rust crate, when its source is present.
 *
 * `apps/engine-core/` is gitignored — the kernel source is not in the public repository — so CI
 * has no such directory. Running `node --test apps/engine-core/tests/*.test.mjs` there matched no
 * files, reported 0 pass / 0 fail, and exited 0: the suite looked green while checking nothing.
 * This says so instead.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const TESTS = path.join(ROOT, "apps/engine-core/tests");

if (!existsSync(TESTS)) {
  console.log(
    "[kernel-src] apps/engine-core/tests is absent (the kernel source is not in this checkout) — " +
      "skipping. The compiled kernel is still covered by test:rules.",
  );
  process.exit(0);
}

const files = readdirSync(TESTS).filter((f) => f.endsWith(".test.mjs")).map((f) => path.join(TESTS, f));
if (!files.length) {
  console.error("[kernel-src] apps/engine-core/tests exists but contains no tests");
  process.exit(1);
}
const r = spawnSync(process.execPath, ["--test", ...files], { cwd: ROOT, stdio: "inherit" });
process.exit(r.status ?? 1);
