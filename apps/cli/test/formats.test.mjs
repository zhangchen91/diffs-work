/**
 * Every extension the documentation promises, checked one by one.
 *
 * They were not: twenty of forty-six were reported as `unknown`, so Kotlin, Lua, Swift, Dart,
 * SCSS and others silently never reached the code view. The lists had drifted across three
 * separate tables. This test reads the promise from the docs and proves it holds.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const BIN = path.join(ROOT, "apps/cli/lib/bin.js");

/** The extensions the code page says are supported, with the family each must land in. */
const PROMISED = {
  code: "ts mts cts tsx js mjs cjs jsx py pyi pyw rs go java kt scala c h cc cpp cxx hpp hh hxx cs swift rb php pl pm lua r dart sh bash sql html htm css scss",
  text: "json yml yaml xml",
  markdown: "md markdown",
};

function run(args, cwd) {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { cwd, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) =>
      resolve({ code: err ? (err.code ?? 1) : 0, stdout }),
    );
  });
}

test("every documented extension is detected, not reported as unknown", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "diffs-fmt-"));
  try {
    const failures = [];
    for (const [family, list] of Object.entries(PROMISED)) {
      for (const ext of list.split(" ")) {
        await writeFile(path.join(dir, `a.${ext}`), "alpha\nbeta\ngamma\n");
        await writeFile(path.join(dir, `b.${ext}`), "alpha\nBETA\ngamma\n");
        const r = await run(["diff", `a.${ext}`, `b.${ext}`, "--json"], dir);
        let got;
        try {
          got = JSON.parse(r.stdout).family;
        } catch {
          failures.push(`${ext}: no JSON (exit ${r.code})`);
          continue;
        }
        if (got !== family) failures.push(`${ext}: expected ${family}, got ${got}`);
      }
    }
    assert.deepEqual(failures, [], `misdetected extensions:\n  ${failures.join("\n  ")}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an unknown extension falls back to text instead of failing", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "diffs-fmt2-"));
  try {
    await writeFile(path.join(dir, "a.zzz"), "one\n");
    await writeFile(path.join(dir, "b.zzz"), "two\n");
    const r = await run(["diff", "a.zzz", "b.zzz", "--json"], dir);
    assert.equal(r.code, 0);
    assert.ok(JSON.parse(r.stdout).family);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a PDF is compared, not handed back", async () => {
  // This used to assert "NOT COMPARED": PDFs were said to need the browser engine. pdf.js reads a
  // text layer without one, so the CLI now compares the pair — and the counts must be real.
  const r = await run(
    ["diff", "test-cases/all-ops/pdf.before.pdf", "test-cases/all-ops/pdf.after.pdf", "--json"],
    ROOT,
  );
  assert.equal(r.code, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.family, "pdf");
  assert.doesNotMatch(parsed.note ?? "", /NOT COMPARED/);
  // The fixture is one added clause, one deleted clause and one reworded one.
  assert.equal(parsed.added, 1, `added was ${parsed.added}`);
  assert.equal(parsed.removed, 1, `removed was ${parsed.removed}`);
  assert.ok(parsed.hunks.length > 0, "a compared PDF has rows");
});

test("a legacy Office file still says it cannot be compared", async () => {
  // `.doc` / `.xls` / `.ppt` are OLE2 binaries nothing in this project reads, so the honest answer
  // is that refusal — and it is what keeps "0 added, 0 removed" from meaning two different things.
  const r = await run(["diff", "test-cases/all-ops/word.before.docx", "test-cases/all-ops/word.after.docx", "--json"], ROOT);
  assert.equal(r.code, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.family, "docx");
  assert.ok(parsed.hunks.length > 0, "a docx compares through the kernel");
});
