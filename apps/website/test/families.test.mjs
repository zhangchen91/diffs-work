import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { compareFiles } from "../../../packages/diff-tool/src/index.ts";

// Resolved from this file, not from an absolute path: the absolute one worked on the machine the
// test was written on and nowhere else, so CI failed on every family with no obvious reason.
const CASES = fileURLToPath(new URL("../../../test-cases/all-ops", import.meta.url));

/**
 * Every family answers something true when asked.
 *
 * The failure this prevents happened three times in two rounds: `csv`, `svg` and `legacy-office` all
 * fell through one shared message that said "diffed by the browser engine", which was false for all
 * three. Nothing tested a family end to end, so nothing noticed.
 */
const TEXT = [
  ["markdown", "md.before.md", "md.after.md"],
  ["code", "rust.before.rs", "rust.after.rs"],
  ["csv", "csv.before.csv", "csv.after.csv"],
  ["svg", "svg.before.svg", "svg.after.svg"],
];
const KERNEL = [
  ["docx", "word.before.docx", "word.after.docx"],
  ["xlsx", "excel.before.xlsx", "excel.after.xlsx"],
  ["pptx", "ppt.before.pptx", "ppt.after.pptx"],
];

for (const [family, a, b] of TEXT) {
  test(`${family} compares as text`, async () => {
    const r = await compareFiles({ old: `${CASES}/${a}`, new: `${CASES}/${b}` });
    assert.equal(r.family, family);
    assert.doesNotMatch(r.summary, /browser engine/, `${family}: ${r.summary}`);
    assert.ok(r.hunks.length > 0, `${family} produced no hunks`);
  });
}

for (const [family, a, b] of KERNEL) {
  test(`${family} is compared by the kernel, not deferred`, async () => {
    const r = await compareFiles({ old: `${CASES}/${a}`, new: `${CASES}/${b}` });
    assert.equal(r.family, family);
    assert.doesNotMatch(r.summary, /NOT COMPARED|browser engine/, `${family}: ${r.summary}`);
    assert.ok(r.added + r.removed > 0, `${family} reported an empty change set`);
  });
}

test("a binary format nothing here can read says so, and does not send you to a viewer", async () => {
  // `.doc` is OLE2 from before 2007. There is no engine for it anywhere in this project, in the
  // browser or out, so "open the local viewer" was a wrong answer.
  const { writeFileSync, mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const dir = mkdtempSync(path.join(tmpdir(), "diffs-legacy-"));
  writeFileSync(path.join(dir, "a.doc"), Buffer.from([0, 1, 2]));
  writeFileSync(path.join(dir, "b.doc"), Buffer.from([0, 1, 3]));
  const r = await compareFiles({ old: path.join(dir, "a.doc"), new: path.join(dir, "b.doc") });
  assert.equal(r.family, "legacy-office");
  assert.match(r.summary, /OLE2|pre-2007|2007/, r.summary);
  assert.doesNotMatch(r.summary, /browser engine/, r.summary);
});
