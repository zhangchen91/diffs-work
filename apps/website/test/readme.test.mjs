/**
 * The README is the first thing a visitor reads, and nothing checked it.
 *
 * It listed docxodus as the Word engine — retired in round 2 — and omitted PowerPoint entirely.
 * Same information as the site and the docs, written a third time, verified nowhere.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("the README names only engines that ship", async () => {
  const md = await readFile(path.join(ROOT, "README.md"), "utf8");
  for (const gone of ["docxodus"]) {
    assert.ok(!md.includes(gone), `README still advertises ${gone}`);
  }
  // every family the site supports should appear in the README table
  for (const family of ["代码", "Markdown", "Excel", "Word", "PowerPoint", "PDF"]) {
    assert.ok(md.includes(family), `README does not mention ${family}`);
  }
});

test("every path and script the README references exists", async () => {
  const md = await readFile(path.join(ROOT, "README.md"), "utf8");
  const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));

  for (const p of md.matchAll(/\(([a-z][a-z0-9/._-]*(?:\/README\.md)?)\)/g)) {
    const target = p[1];
    if (target.startsWith("http")) continue;
    assert.ok(existsSync(path.join(ROOT, target)), `README links to a missing path: ${target}`);
  }
  for (const s of md.matchAll(/`pnpm ([a-z][a-z0-9:-]*)`/g)) {
    assert.ok(pkg.scripts[s[1]], `README tells the reader to run "pnpm ${s[1]}", which does not exist`);
  }
  // every app and package directory should be listed
  for (const dir of ["apps", "packages"]) {
    for (const name of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      if (!name.isDirectory()) continue;
      const listed = md.includes(`${dir}/${name.name}`) || md.includes(`packages/core-`);
      assert.ok(listed, `README does not list ${dir}/${name.name}`);
    }
  }
});

test("the install commands on the site are ones a reader can actually run", async () => {
  // Each of these shipped in a copyable snippet and did not work:
  //   `dsh plugin add ./apps/dsh-plugin` — needs --profile, and the path becomes a package name
  //   `{ "command": "diffs", "args": ["mcp"] }` — no such binary exists
  //   `pnpm deploy` — needs the maintainer's Cloudflare token
  const zh = await readFile(path.join(ROOT, "packages/i18n/src/messages/zh-CN.ts"), "utf8");

  const dsh = /"download\.card\.dsh": "(.*)"/.exec(zh)?.[1] ?? "";
  assert.match(dsh, /--profile/, "the DSH install command must pass --profile");
  assert.match(dsh, /\$PWD|\/absolute/, "the DSH install command must not pass a relative path as a package name");

  for (const f of ["apps/website/src/pages/config.tsx", "apps/website/src/pages/download.tsx"]) {
    const body = await readFile(path.join(ROOT, f), "utf8");
    assert.ok(!/"command":\s*"diffs"/.test(body), `${f} tells the reader to run a \`diffs\` binary`);
    // only the copyable commands, not the comments that explain why they were removed
    assert.ok(!/CliLine text="[^"]*pnpm deploy/.test(body), `${f} tells the reader to run pnpm deploy`);
  }
});
