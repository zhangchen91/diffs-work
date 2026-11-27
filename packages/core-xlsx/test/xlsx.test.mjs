/**
 * @diffs/core-xlsx tests — run with `node --test test/*.test.mjs` after a build,
 * or `pnpm test:xlsx` which bundles first. Fixtures are real workbooks kept in
 * /examples/sheets so the review can open the same files.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const bundle = await import(path.join(HERE, "../.test/bundle.mjs"));
const {
  readWorkbook,
  diffWorkbooks,
  compareXlsx,
  isXlsx,
  numToCol,
  colToNum,
  parseRef,
  summarizeXlsxDiff,
} = bundle;

const fixture = async (name) => new Uint8Array(await readFile(path.join(ROOT, "examples/sheets", name)));

test("column helpers round-trip", () => {
  assert.equal(colToNum("A"), 1);
  assert.equal(colToNum("Z"), 26);
  assert.equal(colToNum("AA"), 27);
  assert.equal(colToNum("AL"), 38);
  for (const n of [1, 26, 27, 38, 703, 1000]) assert.equal(colToNum(numToCol(n)), n);
  assert.deepEqual(parseRef("AL162"), { col: 38, row: 162 });
});

test("xlsx sniffing rejects a docx", async () => {
  const xlsx = await fixture("checklist-B3.xlsx");
  assert.equal(isXlsx(xlsx), true);
  const docx = new Uint8Array(await readFile(path.join(ROOT, "examples/docx/contract-v1.docx")));
  assert.equal(isXlsx(docx), false);
});

test("reads the sample workbook with its real dimensions", async () => {
  const wb = readWorkbook(await fixture("checklist-B3.xlsx"));
  assert.ok(wb.names.length >= 1, "at least one sheet");
  const first = wb.sheets[0];
  assert.ok(first.maxRow >= 5, `rows (${first.maxRow})`);
  assert.ok(first.maxCol >= 3, `columns (${first.maxCol})`);
  assert.ok(first.cells.size >= 10, `cells (${first.cells.size})`);
});

test("Chinese text survives decoding", async () => {
  const wb = readWorkbook(await fixture("checklist-B3.xlsx"));
  const texts = [...wb.sheets[0].cells.values()].map((c) => c.text);
  assert.ok(texts.some((t) => /[\u4e00-\u9fa5]{2,}/.test(t)), `no Chinese read: ${JSON.stringify(texts.slice(0, 6))}`);
});

test("a renamed sheet is paired, not reported as remove + add", async () => {
  const { diff } = compareXlsx(
    new Uint8Array(readFileSync(path.join(HERE, "fixtures/rn-a.xlsx"))),
    new Uint8Array(readFileSync(path.join(HERE, "fixtures/rn-b.xlsx"))),
  );
  const renamed = diff.sheets.find((s) => s.name === "甲-改");
  assert.ok(renamed, `renamed sheet present (${diff.sheets.map((s) => s.name).join(",")})`);
  assert.equal(renamed.oldName, "甲", "the old name is remembered");
  // The fixtures differ only in the sheet name, so the cells are unchanged; what matters
  // is that the pair was recognised at all instead of becoming remove + add.
  assert.equal(renamed.status, "same");
  assert.equal(diff.addedSheets.length, 0, "a rename is not an added sheet");
});

test("identical workbooks diff to zero", async () => {
  const bytes = await fixture("checklist-B4.xlsx");
  const { diff } = compareXlsx(bytes, bytes);
  assert.equal(diff.totals.added, 0);
  assert.equal(diff.totals.removed, 0);
  assert.equal(diff.totals.modified, 0);
  assert.equal(summarizeXlsxDiff(diff), "两个工作簿内容一致");
});

test("a modified cell reports word-level inline diff", async () => {
  const oldWb = readWorkbook(await fixture("checklist-B3.xlsx"));
  const newWb = readWorkbook(await fixture("checklist-B3.xlsx"));
  const target = newWb.sheets[0];
  const first = [...target.cells.values()].find((c) => c.kind === "s" && c.text.length > 4);
  assert.ok(first, "a string cell exists");
  const changed = { ...first, text: first.text + "（修订）" };
  target.cells.set(first.ref, changed);
  const diff = diffWorkbooks(oldWb, newWb);
  const change = diff.sheets[0].changes.find((c) => c.ref === first.ref);
  assert.ok(change, "the cell is reported");
  assert.equal(change.op, "mod");
  assert.ok(change.inline.some((s) => s.op === "insert" && s.text.includes("修订")));
});

test("a sheet present on one side only is reported as added or removed", async () => {
  // Built from dedicated fixtures rather than the sample workbook, so editing the sample
  // cannot break a reader test.
  const a = readWorkbook(new Uint8Array(readFileSync(path.join(HERE, "fixtures/sheets-a.xlsx"))));
  const b = readWorkbook(new Uint8Array(readFileSync(path.join(HERE, "fixtures/sheets-a.xlsx"))));
  b.sheets = b.sheets.filter((s) => s.index !== 1).map((s, i) => ({ ...s, index: i }));
  const removedName = a.sheets[1].name;
  const diff = diffWorkbooks(a, b);
  const gone = diff.sheets.find((x) => x.name === removedName);
  assert.ok(gone, `removed sheet missing from the diff (${diff.sheets.map((s) => s.name).join(",")})`);
  assert.equal(gone.status, "removed");
  assert.ok(gone.removed > 0);
});

test("formula-only changes are counted separately from value changes", async () => {
  const oldWb = readWorkbook(await fixture("checklist-B3.xlsx"));
  const newWb = readWorkbook(await fixture("checklist-B3.xlsx"));
  let target;
  for (const s of newWb.sheets) {
    target = [...s.cells.values()].find((c) => c.kind === "f" && c.formula);
    if (target) break;
  }
  if (!target) {
    // no formulas in the fixture: synthesize one to exercise the branch
    const s = newWb.sheets[0];
    const cell = [...s.cells.values()][0];
    target = { ...cell, kind: "f", formula: "1+1" };
    s.cells.set(cell.ref, target);
    const oldCell = { ...cell, formula: "1+2" };
    oldWb.sheets[0].cells.set(cell.ref, oldCell);
  } else {
    const s = newWb.sheets.find((x) => x.cells.get(target.ref) === target);
    const oldCell = oldWb.sheets.find((x) => x.name === s.name).cells.get(target.ref);
    oldWb.sheets.find((x) => x.name === s.name).cells.set(target.ref, { ...oldCell, formula: "=OLD()" });
  }
  const diff = diffWorkbooks(oldWb, newWb);
  assert.ok(diff.totals.formulaOnly >= 1, "formula change counted");
});
test("inline strings (t=\"inlineStr\") are read, not silently empty", async () => {
  // openpyxl and several other generators write cell text as <is><t>, never into <v>.
  // Reading only <v> made every such workbook look empty — a diff of 0 with no error.
  const a = readFileSync(path.join(HERE, "fixtures/inline-a.xlsx"));
  const b = readFileSync(path.join(HERE, "fixtures/inline-b.xlsx"));
  const wb = readWorkbook(new Uint8Array(a));
  const texts = [...wb.sheets[0].cells.values()].map((c) => c.text);
  assert.ok(texts.some((t) => t.includes("内联字符串")), `inline text not read: ${JSON.stringify(texts)}`);
  const { diff } = compareXlsx(new Uint8Array(a), new Uint8Array(b));
  assert.equal(diff.totals.modified, 1, "the changed cell is not reported");
  const change = diff.sheets[0].changes[0];
  assert.equal(change.ref, "A1");
  assert.equal(change.op, "mod");
});
