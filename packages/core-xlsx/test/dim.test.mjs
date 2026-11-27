import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const b = await import(path.join(HERE, "../.test/bundle.mjs"));
const load = async (n) => new Uint8Array(await readFile(path.join(ROOT, "examples/sheets", n)));

test("every fixture in examples/sheets reads without throwing", async () => {
  for (const name of ["checklist-B3.xlsx", "checklist-B4.xlsx", "checklist-B3.xlsx", "checklist-B4.xlsx"]) {
    const wb = b.readWorkbook(await load(name));
    assert.ok(wb.sheets.length > 0, `${name} has sheets`);
    for (const s of wb.sheets) assert.ok(s.maxCol >= 0 && s.maxRow >= 0, `${name}/${s.name} dims`);
  }
});
