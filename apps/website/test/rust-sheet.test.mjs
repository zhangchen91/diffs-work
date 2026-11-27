import assert from "node:assert/strict";
import test from "node:test";
import { rustSheetToWorkbook } from "../../../packages/diff-ui/src/lib/rust-sheet.ts";

const kernel = {
  engine: "rules-core.wasm",
  summary: "+1/-0/~0",
  sheets: [
    {
      name: "Items",
      diff: {
        added: 1,
        removed: 0,
        modified: 0,
        styleChanged: 3,
        formulaChanged: 0,
        changes: [{ ref: "A1", op: "add", new: "bolt" }],
      },
    },
  ],
};

test("the adapter fills every field WorkbookDiff requires", () => {
  // This is the bug that blanked the local viewer: the adapter returned `{ kind, sheets }` and cast
  // it, so `totals` was undefined and the view threw where nobody could see it. A field-by-field
  // assertion is the only thing that would have caught it.
  const out = rustSheetToWorkbook(kernel);
  for (const field of ["kind", "sheets", "totals", "addedSheets", "removedSheets", "warnings"]) {
    assert.ok(field in out, `WorkbookDiff.${field} is missing`);
  }
  assert.equal(out.kind, "xlsx");
  assert.deepEqual(out.totals, { added: 1, removed: 0, modified: 0, formulaOnly: 0, sheets: 1 });
});

test("style-only changes survive as their own count", () => {
  // `✎3` is the fact only the kernel collects; the TypeScript reader has no equivalent.
  assert.equal(rustSheetToWorkbook(kernel).sheets[0].styleChanged, 3);
});
