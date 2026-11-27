/**
 * The CLI commands the docs tell people to run, run exactly as written.
 *
 * A documented command that does not work is worse than a missing one: the reader concludes the
 * tool is broken. These tests exist because that already happened once (`--unified` printed a
 * summary line, so the patch would not apply).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const BIN = path.join(ROOT, "apps/cli/lib/bin.js");
const A = "examples/code/pricebook-v1.ts";
const B = "examples/code/pricebook-v2.ts";

function run(args, cwd = ROOT) {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { cwd, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({ code: err ? (err.code ?? 1) : 0, stdout, stderr }),
    );
  });
}

test("`diffs version` prints a version", async () => {
  const r = await run(["version"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^diffs \d+\.\d+\.\d+/);
});

test("`diffs diff a b` reports the change", async () => {
  const r = await run(["diff", A, B]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /差异|difference|added/i);
  assert.ok(r.stdout.includes("@@"), "hunks are shown");
});

test("`diffs diff a b --json` is parseable JSON", async () => {
  const r = await run(["diff", A, B, "--json"]);
  assert.equal(r.code, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.family, "code");
  assert.ok(parsed.added > 0);
});

test("`diffs diff a b --unified` is a patch and nothing else", async () => {
  const r = await run(["diff", A, B, "--unified"]);
  assert.equal(r.code, 0);
  // Every line is part of a unified diff; no summary, no labels, no prose.
  for (const line of r.stdout.trimEnd().split("\n")) {
    assert.match(line, /^(---|\+\+\+|@@|[-+ ])/, `not patch syntax: ${JSON.stringify(line)}`);
  }
  assert.ok(r.stdout.includes("@@"), "has a hunk header");
});

test("`diffs paths` prints a directory", async () => {
  const r = await run(["paths"]);
  assert.equal(r.code, 0);
  assert.ok(r.stdout.trim().length > 0);
});

test("the JSON has the fields the contract documents", async () => {
  // `--json` used to carry a `summary` string where portable@1 promised an object, so the
  // documented `jq '.summary.added'` returned null. The contract is the thing integrations build
  // on, so it is checked here rather than trusted.
  const r = await run(["diff", A, B, "--json"]);
  const j = JSON.parse(r.stdout);
  assert.ok(j.counts, "counts is missing");
  for (const k of ["added", "removed", "changed", "ratio"]) {
    assert.equal(typeof j.counts[k], "number", `counts.${k} is not a number`);
  }
  assert.ok(j.counts.added > 0 && j.counts.removed > 0, JSON.stringify(j.counts));
  assert.equal(typeof j.summary, "string", "summary should stay the sentence a human reads");
  // Not just "some string": the sentence must describe this result. A mutation that set it to
  // "BROKEN" passed every test in the suite, because the only check was length > 5.
  //
  // The numbers come from the kernel and are counted in its own units (a "hunk" there can cover
  // several `hunks[]` entries here), so the check is that the sentence reports counts at all and
  // agrees with `counts.removed`, which both sides count the same way.
  assert.match(j.summary, /\d/, `summary carries no number: ${j.summary}`);
  assert.match(j.summary, /[-−]\d+/, `summary reports no removal count: ${j.summary}`);
  const removed = Number((j.summary.match(/[-−](\d+)/) ?? [])[1]);
  assert.equal(removed, j.counts.removed, `summary says ${removed} removed, counts says ${j.counts.removed}`);
});

test("a small change in a big file still shows a non-zero ratio", async () => {
  // Three decimals rounded a 3-line change in a 20 000-line file to `0`, which reads as "nothing
  // changed" — the exact opposite of what the number is for.
  const { writeFile, mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(path.join(tmpdir(), "diffs-ratio-"));
  try {
    const lines = Array.from({ length: 20000 }, (_, i) => `line ${i}`);
    await writeFile(path.join(dir, "a.ts"), lines.join("\n"));
    await writeFile(path.join(dir, "b.ts"), lines.map((l, i) => (i === 100 ? "LINE 100" : l)).join("\n"));
    const r = await run(["diff", "a.ts", "b.ts", "--json"], dir);
    const j = JSON.parse(r.stdout);
    assert.equal(j.counts.changed, 1, JSON.stringify(j.counts));
    assert.ok(j.counts.ratio > 0, `ratio is ${j.counts.ratio} for a real change`);
    assert.ok(j.counts.ratio < 0.01, `ratio is ${j.counts.ratio}, expected a small share`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("comparing two different file types says so", async () => {
  // The family follows the *new* side, so a spreadsheet against a markdown file was compared
  // under whichever format happened to be on the right, with no sign the two sides differed.
  const { writeFile, mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(path.join(tmpdir(), "diffs-mixed-"));
  try {
    await writeFile(path.join(dir, "a.ts"), "export const a = 1;\n");
    await writeFile(path.join(dir, "b.md"), "# Title\n\nbody\n");
    const r = await run(["diff", "a.ts", "b.md", "--json"], dir);
    const j = JSON.parse(r.stdout);
    assert.match(j.note ?? "", /code and .*markdown/, `note was: ${j.note}`);
    assert.match(j.note, /used the markdown rules/, "the note says which rules were used");
    // same family: no note
    await writeFile(path.join(dir, "c.ts"), "export const a = 2;\n");
    const same = JSON.parse((await run(["diff", "a.ts", "c.ts", "--json"], dir)).stdout);
    assert.equal(same.note ?? null, null, "no note when both sides are the same family");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--revision compares the working file against a commit", async () => {
  // The docs documented `diffs diff <file> --revision HEAD~1`, but the flag was never parsed:
  // `--revision` became the boolean `true`, the revision went nowhere, and the command compared
  // the file with itself.
  const same = await run(["diff", "examples/code/pricebook-v2.ts", "--revision", "HEAD"]);
  assert.equal(same.code, 0, same.stderr);
  assert.match(same.stdout, /pricebook-v2\.ts@HEAD/, "the label names the revision");
  assert.match(same.stdout, /无差异|一致|no difference/i, "clean tree reports no difference");

  const bad = await run(["diff", "examples/code/pricebook-v2.ts", "--revision", "no-such-rev"]);
  assert.notEqual(bad.code, 0, "an unknown revision must fail");
});

test("a missing file or a directory is explained, with a non-zero exit", async () => {
  const missing = await run(["diff", "/tmp/definitely-not-here.ts", "examples/code/pricebook-v1.ts"]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /cannot read .*no such file/);

  const dir = await run(["diff", "/tmp", "examples/code/pricebook-v1.ts"]);
  assert.equal(dir.code, 1);
  assert.match(dir.stderr, /is a directory/);
});

test("a taken port is explained, not left as EADDRINUSE", async () => {
  // `diffs local` is the first command anyone runs, and starting it twice is the first mistake
  // anyone makes. The raw errno did not say which of the two situations it was.
  const { createServer } = await import("node:http");
  const port = 5411;
  const blocker = createServer((_q, r) => {
    r.writeHead(200, { "content-type": "application/json" });
    r.end(JSON.stringify({ ok: true, version: "local" }));
  });
  await new Promise((res) => blocker.listen(port, "127.0.0.1", res));
  try {
    const r = await run(["local", "--port", String(port), "--no-open"]);
    assert.notEqual(r.code, 0, "starting on a taken port must fail");
    const msg = `${r.stderr}${r.stdout}`;
    assert.match(msg, /already running|in use by another program/, msg.slice(0, 200));
    assert.ok(!/Unhandled 'error' event/.test(msg), "must not surface a raw crash");
  } finally {
    await new Promise((res) => blocker.close(res));
  }
});

test("a file too large to align is refused, not crashed into", async () => {
  // Two completely different files of 40 000 lines exhausted V8's heap: the process died with a
  // fatal OOM instead of answering. The cost is the number of unmatched rows, not the byte size.
  const { writeFile, mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(path.join(tmpdir(), "diffs-big-"));
  try {
    const mk = (seed) => Array.from({ length: 30000 }, (_, i) => `x${seed}_${i}_${(i * 13 + seed) % 101}`).join("\n");
    await writeFile(path.join(dir, "a.ts"), mk(1));
    await writeFile(path.join(dir, "b.ts"), mk(9));
    const r = await run(["diff", "a.ts", "b.ts", "--json"], dir);
    assert.notEqual(r.code, 0, "an unalignable pair must fail");
    assert.match(r.stderr, /over the \d+ line limit/, r.stderr.slice(0, 200));
    assert.ok(!/heap out of memory|FATAL ERROR/.test(`${r.stderr}${r.stdout}`), "must not crash");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("every result says which contract it speaks", async () => {
  // The contract documents `schema: "diffs.work/portable@1"` on every result and calls it a
  // constant. Nothing set it: a reader checking the field got undefined and could only conclude
  // the tool was not speaking the contract at all. Text and binary paths both needed it.
  const cases = [
    ["examples/code/pricebook-v1.ts", "examples/code/pricebook-v2.ts"],
    ["test-cases/all-ops/word.before.docx", "test-cases/all-ops/word.after.docx"],
    ["test-cases/all-ops/excel.before.xlsx", "test-cases/all-ops/excel.after.xlsx"],
    ["test-cases/all-ops/md.before.md", "test-cases/all-ops/md.after.md"],
    ["test-cases/all-ops/pdf.before.pdf", "test-cases/all-ops/pdf.after.pdf"],
  ];
  for (const [a, b] of cases) {
    const j = JSON.parse((await run(["diff", a, b, "--json"])).stdout);
    assert.equal(j.schema, "diffs.work/portable@1", `${a} → ${b} has no schema`);
  }
});

test("--unified refuses families that have no patch", async () => {
  // `unified` for xlsx and docx was a per-sheet / per-part summary ("Items: +4 -4 ~1"), placed in
  // the field the docs say holds a patch. Piped into `patch` it fails, and the caller believed
  // they had a patch because that is what they asked for.
  const ok = await run(["diff", "examples/code/pricebook-v1.ts", "examples/code/pricebook-v2.ts", "--unified"]);
  assert.equal(ok.code, 0);
  assert.match(ok.stdout, /^--- /, "a text family still produces a patch");

  for (const f of ["excel", "word", "ppt"]) {
    const r = await run(["diff", `test-cases/all-ops/${f}.before.${f === "ppt" ? "pptx" : f === "word" ? "docx" : "xlsx"}`,
      `test-cases/all-ops/${f}.after.${f === "ppt" ? "pptx" : f === "word" ? "docx" : "xlsx"}`, "--unified"]);
    assert.equal(r.code, 1, `${f} should refuse --unified`);
    assert.match(r.stderr, /does not have one/, `${f}: ${r.stderr}`);
  }
});

test("--unified produces a patch that `patch` applies to the target", async (t) => {
  // `patch` is not on every machine (it is not on a bare windows runner). The claim still needs
  // checking where it exists; where it does not, say so rather than fail.
  const hasPatch = await new Promise((resolve) => {
    execFile("patch", ["--version"], (e) => resolve(!e));
  });
  if (!hasPatch) {
    t.skip("`patch` is not installed here");
    return;
  }
  // The docs promise the patch can go "straight into `patch`". Format checks only prove it looks
  // right; this applies it and compares the result to the file that was compared against.
  const { mkdtemp, copyFile, rm, readFile, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(path.join(tmpdir(), "diffs-patch-"));
  try {
    for (const [before, after] of [
      ["examples/code/pricebook-v1.ts", "examples/code/pricebook-v2.ts"],
      ["test-cases/all-ops/md.before.md", "test-cases/all-ops/md.after.md"],
    ]) {
      // Use bare file names so the two `---` / `+++` headers are relative. With absolute paths
      // GNU patch 2.7 (CI) refuses the trailing component while newer patch (macOS) accepts it —
      // the test passed locally and failed on every push.
      const name = path.basename(before);
      await copyFile(path.join(ROOT, before), path.join(dir, name));
      const patchFile = path.join(dir, "p.diff");
      const r = await run(["diff", name, path.join(ROOT, after), "--unified"], dir);
      assert.equal(r.code, 0);
      await writeFile(patchFile, r.stdout);

      await new Promise((resolve, reject) => {
        execFile("patch", ["-p0", "-i", "p.diff"], { cwd: dir }, (e, _o, err) =>
          e ? reject(new Error(`patch failed: ${err}`)) : resolve(),
        );
      });

      const applied = await readFile(path.join(dir, name), "utf8");
      const target = await readFile(path.join(ROOT, after), "utf8");
      assert.equal(applied, target, `${before}: the patched file is not the target`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--context and --maxHunks actually change the output", async () => {
  // Both were documented as options of the one shared contract and neither reached the code:
  // the CLI did not parse them, and `context` was not threaded past `compareFiles` into the line
  // diff at all. Every value returned the same hunks.
  const lines = [
    ["0", 0],
    ["3", 3],
    ["8", 8],
  ];
  const sizes = [];
  for (const [flag] of lines) {
    const r = await run(["diff", "examples/code/pricebook-v1.ts", "examples/code/pricebook-v2.ts", "--context", flag, "--json"]);
    const j = JSON.parse(r.stdout);
    sizes.push(j.hunks.reduce((n, h) => n + h.lines.length, 0));
  }
  assert.ok(sizes[0] < sizes[1], `context 0 gave ${sizes[0]} lines, 3 gave ${sizes[1]}`);
  assert.ok(sizes[1] < sizes[2], `context 3 gave ${sizes[1]} lines, 8 gave ${sizes[2]}`);
});

test("revision errors name the revision or the file, not a shell command", async () => {
  // `Command failed: git show HEAD:x` followed by a fatal line reads like the tool broke. The two
  // things that can actually be wrong are the revision and whether the file exists in it.
  const missingFile = await run(["diff", "examples/code/does-not-exist.ts", "--revision", "HEAD"]);
  assert.equal(missingFile.code, 1);
  assert.match(missingFile.stderr, /is not in HEAD/, missingFile.stderr);
  assert.ok(!/Command failed/.test(missingFile.stderr), "must not echo the git command");

  const badRev = await run(["diff", "examples/code/pricebook-v2.ts", "--revision", "NOPE"]);
  assert.equal(badRev.code, 1);
  assert.match(badRev.stderr, /there is no revision NOPE/, badRev.stderr);
});

test("--open hands the pair to the viewer and prints a link that resolves", async () => {
  // The config page documents `git difftool` as "read it in this site's view":
  //   difftool.diffs.cmd 'node apps/cli/lib/bin.js diff --open "$LOCAL" "$REMOTE"'
  // `runDiff` never read the flag, so it printed to the terminal and nothing opened. It now posts
  // to /api/pair — the endpoint the viewer reads — and starts a viewer if none is running.
  const { spawn } = await import("node:child_process");
  const port = "5391";
  const viewer = spawn(process.execPath, [path.join(ROOT, "apps/cli/lib/bin.js"), "local", "--port", port, "--no-open"], {
    cwd: ROOT,
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 60; i += 1) {
      const up = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(400) }).then((r) => r.ok).catch(() => false);
      if (up) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const r = await run(["diff", "--open", A, B], ROOT);
    assert.equal(r.code, 0, r.stderr);
    const url = /http:\/\/127\.0\.0\.1:5279\/#\/compare\?pair=([0-9a-f-]+)/.exec(r.stdout);
    assert.ok(url, `no viewer link in: ${r.stdout}`);
    // the link must resolve against the endpoint the viewer actually reads
    const pair = await fetch(`http://127.0.0.1:5279/api/pair/${url[1]}`).then((res) => res.json());
    assert.ok(pair.oldBase64 && pair.newBase64, "the stored pair has no content");
    assert.equal(Buffer.from(pair.oldBase64, "base64").toString("utf8"), readFileSync(A, "utf8"));
  } finally {
    viewer.kill();
    await new Promise((r) => setTimeout(r, 300));
    // --open starts its own viewer on the default port; stop it too
    try {
      const { execFileSync } = await import("node:child_process");
      execFileSync("pkill", ["-f", "bin.js local"], { stdio: "ignore" });
    } catch {
      /* nothing running */
    }
  }
});
