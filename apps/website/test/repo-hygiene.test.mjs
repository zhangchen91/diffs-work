/**
 * Things that must never reach the public repository again.
 *
 * `.engine-backup/src-212747/` held a copy of the comparison kernel's Rust source — which is
 * deliberately not public — and it was committed and pushed. It took a history rewrite to remove.
 * The same audit found 70 MB of retired engines (docxodus, tesseract) and a 53 MB leftover
 * `website/` tree, none of which any code loads.
 *
 * This test is the guard that was missing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);

test("the kernel's Rust source is not in this repository", () => {
  // apps/engine-core is gitignored on purpose; a backup copy defeats that
  const kernel = tracked.filter((f) => /(^|\/)(engine-core|engine-backup)\/.*\.rs$/.test(f));
  assert.deepEqual(kernel, [], `kernel source must stay private, found:\n  ${kernel.join("\n  ")}`);
});

test("no agent scratch or editor directories are tracked", () => {
  const bad = tracked.filter((f) => /^(\.codegraph|\.engine-backup|\.scratch|\.deploy)\//.test(f));
  assert.deepEqual(bad, [], `scratch directories are tracked:\n  ${bad.join("\n  ")}`);
});

test("engines that were retired stay out", () => {
  const dead = tracked.filter((f) => /(docxodus|tesseract|tessdata)/i.test(f));
  assert.deepEqual(dead, [], `retired engines are tracked:\n  ${dead.join("\n  ")}`);
});

test("nothing large sneaks in without being an engine the site loads", () => {
  // A 30 MB .NET renderer sat in the tree for 90 rounds because nobody looked.
  const out = execFileSync("sh", ["-c", "git ls-files -z | xargs -0 ls -l 2>/dev/null | awk '$5 > 3000000 {print $5, $9}'"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const big = out.split("\n").filter(Boolean);
  assert.deepEqual(big, [], `files over 3 MB:\n  ${big.join("\n  ")}`);
});

test("the gitignore keeps the dangerous paths ignored", async () => {
  const ignore = await readFile(path.join(ROOT, ".gitignore"), "utf8");
  for (const p of [".engine-backup/", ".codegraph/", ".scratch/", "apps/engine-core/"]) {
    assert.ok(ignore.includes(p), `.gitignore no longer lists ${p}`);
  }
});

test("the tool contract is defined once", async () => {
  // It was written out three times and the copies disagreed: MCP advertised Office and PDF as
  // supported, the DSH plugin said they were "not compared inline". Both were wrong.
  const surfaces = ["apps/cli/src/mcp.ts", "apps/dsh-plugin/src/index.ts", "packages/diff-tool/src/index.ts"];
  for (const f of surfaces) {
    const body = await readFile(path.join(ROOT, f), "utf8");
    assert.ok(
      !/description:\s*["'`]Compare two (files|versions)/.test(body),
      `${f} hard-codes its own tool description — read it from tool-schema.ts`,
    );
  }
  const schema = await readFile(path.join(ROOT, "packages/diff-tool/src/tool-schema.ts"), "utf8");
  assert.match(schema, /export const DIFF_TOOL_NAME/, "the shared contract no longer defines the name");
  assert.match(schema, /DIFF_TOOL_INPUT_SCHEMA/, "the shared contract no longer defines the input schema");
});

test("docs/STATUS.md exists and names what is not done", async () => {
  // The page stated three times that something was shipped when it was not (deploy, the VS Code
  // extension, the DSH card). A file whose whole job is to say which half works stops the next
  // one, and a test keeps it from being deleted as noise.
  const status = await readFile(path.join(ROOT, "docs/STATUS.md"), "utf8");
  for (const item of ["DSH", "浏览器扩展", "Claude", "VS Code"]) {
    assert.ok(status.includes(item), `STATUS.md no longer covers ${item}`);
  }
  assert.match(status, /未完成/, "STATUS.md must keep its list of things that do not work");
});
