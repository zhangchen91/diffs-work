import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { compareFiles } from "../../../packages/diff-tool/src/index.ts";

// Resolved from this file, not from an absolute path: the absolute one worked on the machine the
// test was written on and nowhere else, so CI failed on every family with no obvious reason.
const CASES = fileURLToPath(new URL("../../../test-cases/all-ops", import.meta.url));

test("csv and svg compare as text, not as opaque binaries", async () => {
  // Both were in the family list and in the viewer's registry, but `isTextFamily` did not include
  // them, so the CLI and the MCP tool answered "NOT COMPARED: diffed by the browser engine" — which
  // was untrue of either, since there is no browser engine for them.
  for (const [a, b] of [
    ["csv.before.csv", "csv.after.csv"],
    ["svg.before.svg", "svg.after.svg"],
  ]) {
    const r = await compareFiles({ old: `${CASES}/${a}`, new: `${CASES}/${b}` });
    assert.equal(r.kind, "text", `${a} should compare as text, got ${r.kind}`);
    assert.doesNotMatch(r.summary, /NOT COMPARED/, `${a}: ${r.summary}`);
    assert.ok(r.hunks.length > 0, `${a} should produce hunks`);
  }
});

test("the csv diff reports line changes and says it is not cell-level", async () => {
  const r = await compareFiles({ old: `${CASES}/csv.before.csv`, new: `${CASES}/csv.after.csv` });
  assert.equal(r.family, "csv");
  assert.ok(r.added > 0 && r.removed > 0, JSON.stringify({ added: r.added, removed: r.removed }));
});
