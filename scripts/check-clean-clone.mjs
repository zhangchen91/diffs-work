/**
 * A fresh clone installs, builds, and compares all five text-side families.
 *
 * `docs/open-source-ready.md` states the bar as "someone clones it, runs pnpm install and sees
 * everything". That sentence sat in the repository unexecuted for a long time, and when it was run
 * two rows of the same checklist turned out to describe directories that do not exist. This runs the
 * bar instead of asserting it.
 *
 * Slow on purpose (it clones and installs), so it is not in `pnpm test`; run it before a release:
 *
 *   node scripts/check-clean-clone.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO = "https://github.com/zhangchen91/diffs-work.git";
const dir = mkdtempSync(path.join(tmpdir(), "diffs-clone-"));
const run = (cmd, args, cwd = dir) =>
  execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 600_000 });

const failures = [];
try {
  console.log(`[clone] ${REPO} → ${dir}`);
  run("git", ["clone", "-q", "--depth", "1", REPO, "."]);
  run("pnpm", ["install", "--frozen-lockfile"]);
  console.log("  install  ok");
  run("pnpm", ["build:cli"]);
  run("pnpm", ["sync:engine"]);
  console.log("  build    ok");

  // The five families the CLI can run. PDF is compared by the browser engine and is expected to
  // answer "需要 WASM 渲染器" from here — that is the correct answer, not a failure.
  const pairs = [
    ["code/rust.before.rs", "code/rust.after.rs"],
    ["md.before.md", "md.after.md"],
    ["excel.before.xlsx", "excel.after.xlsx"],
    ["word.before.docx", "word.after.docx"],
    ["ppt.before.pptx", "ppt.after.pptx"],
  ];
  for (const [a, b] of pairs) {
    const out = run(process.execPath, ["apps/cli/lib/bin.js", "diff", `test-cases/all-ops/${a}`, `test-cases/all-ops/${b}`]);
    const line = out.split("\n")[1] ?? "";
    if (/NOT COMPARED|需要 WASM/.test(line)) failures.push(`${a}: ${line.slice(0, 80)}`);
    else console.log(`  ${a.split(".")[0].padEnd(8)} ${line.slice(0, 60)}`);
  }
} catch (e) {
  failures.push(`the clean clone did not get this far: ${String(e).slice(0, 300)}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failures.length) {
  console.error("\nFAILURES:\n" + failures.map((f) => "  - " + f).join("\n"));
  process.exit(1);
}
console.log("\n[clone] a fresh clone installs, builds, and compares every family the CLI can run");
