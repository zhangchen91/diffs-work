/**
 * Rows are compared by identity, not by address.
 *
 * The acceptance contract (`test-cases/all-ops/expected.json`) keys a spreadsheet on its first
 * column: one row added, one removed, one modified, one moved. Comparing cells by address
 * instead reports a moved row and a deleted row as a column of "modified" cells, which hides
 * both the deletion and the arrival.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");

/** Load the kernel the same way the app does. */
async function kernel() {
  const wasm = await readFile(path.join(ROOT, "apps/website/public/engine/rules-core/diffs-engine.wasm"));
  const mod = await WebAssembly.instantiate(wasm, {});
  const ex = mod.instance.exports;
  return (req) => {
    const bytes = new TextEncoder().encode(JSON.stringify(req));
    const ptr = ex.diffs_alloc(bytes.length);
    new Uint8Array(ex.memory.buffer, ptr, bytes.length).set(bytes);
    const out = ex.diffs_handle(ptr, bytes.length);
    const len = ex.diffs_box_len(out);
    const text = new TextDecoder().decode(new Uint8Array(ex.memory.buffer, out + 4, len));
    ex.diffs_free(out, len + 4);
    ex.diffs_free(ptr, bytes.length);
    return JSON.parse(text);
  };
}

const pair = async (name) => {
  const [a, b] = await Promise.all([
    readFile(path.join(ROOT, "test-cases/all-ops", `excel.before.xlsx`)),
    readFile(path.join(ROOT, "test-cases/all-ops", `excel.after.xlsx`)),
  ]);
  return { a: Buffer.from(a).toString("base64"), b: Buffer.from(b).toString("base64"), name };
};

test("a moved row is not a column of modifications", async () => {
  const call = await kernel();
  const { a, b } = await pair("excel");
  const r = call({ cmd: "sheet_diff", a, b });
  const changes = (r.sheets?.[0]?.diff?.changes ?? []).map((c) => `${c.op} ${c.ref}:${c.old ?? ""}->${c.new ?? ""}`);

  // A-005 left, A-006 arrived: two events, not one cell that "changed".
  assert.ok(changes.some((c) => c.includes("A-005") && c.startsWith("del")), `A-005 not removed: ${changes}`);
  assert.ok(changes.some((c) => c.includes("A-006") && c.startsWith("add")), `A-006 not added: ${changes}`);
  // The moved row (A-001) is identical text in a new place; it must not appear as an edit at all.
  assert.ok(!changes.some((c) => c.includes("A-001") && !c.startsWith("del") && !c.startsWith("add")), `A-001 smeared: ${changes}`);
  // A-003's only real change is quantity 30 -> 35.
  const mods = changes.filter((c) => c.startsWith("mod"));
  assert.equal(mods.length, 1, `expected exactly one modified cell, got: ${mods}`);
  assert.ok(mods[0].includes("C4") && mods[0].includes("30") && mods[0].includes("35"), mods[0]);
});
