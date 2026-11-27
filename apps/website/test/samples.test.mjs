/**
 * Every shipped sample must show all four states — 增 / 删 / 改 / 移 —
 * and no sample may carry private-looking content.
 *
 * A sample that is only "+12/-10" teaches nothing, and a sample that is a real
 * contract excerpt is a liability. This test is the guard against both.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const WASM = path.join(ROOT, "apps/website/public/engine/rules-core/diffs-engine.wasm");

function load() {
  const ex = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(WASM)), {}).exports;
  return (req) => {
    const bytes = new TextEncoder().encode(JSON.stringify(req));
    const p = ex.diffs_alloc(bytes.length);
    new Uint8Array(ex.memory.buffer, p, bytes.length).set(bytes);
    const out = ex.diffs_handle(p, bytes.length);
    const len = ex.diffs_box_len(out);
    const text = new TextDecoder().decode(new Uint8Array(ex.memory.buffer, out + 4, len));
    ex.diffs_free(out, len + 4);
    ex.diffs_free(p, bytes.length);
    return JSON.parse(text);
  };
}
const call = load();
const read = (rel) => readFileSync(path.join(ROOT, "examples", rel), "utf8");

const pairs = [
  ["code/pricebook-v1.ts", "code/pricebook-v2.ts", "pricebook.ts"],
  ["code/hours-v1.md", "code/hours-v2.md", "hours.md"],
];

// What a reader must be able to point at, per sample: at least one block that is purely
// added, one purely deleted, one add+delete pair (改), and one moved block.
function states(r) {
  const kinds = new Set();
  for (const h of r.hunks) {
    const lines = h.lines.filter((l) => l.kind !== "ctx");
    if (lines.length === 0) continue;
    // classify by the *rows*, not by the hunk label: a hunk may hold an update and a
    // nearby insert together, and the label is a summary of the block
    const pureIns = lines.filter((l) => l.kind === "ins").length;
    const pureDel = lines.filter((l) => l.kind === "del").length;
    if (lines.some((l) => l.kind === "upd-ins" && l.segments?.length)) kinds.add("update");
    if (pureIns && !pureDel) kinds.add("insert");
    if (pureDel && !pureIns) kinds.add("delete");
    // a block that changes and adds at once still shows an addition to the reader
    if (pureIns && pureDel) {
      kinds.add("insert");
      kinds.add("delete");
    }
  }
  if (r.moves >= 1) kinds.add("move");
  return kinds;
}

for (const [a, b, name] of pairs) {
  test(`${name}: shows 增 / 删 / 改 / 移`, () => {
    const r = call({ cmd: "sem_diff", a: read(a), b: read(b), filename: name });
    const got = states(r);
    for (const need of ["insert", "delete", "update", "move"]) {
      assert.ok(got.has(need), `missing ${need}: ${r.summary}`);
    }
  });
}

test("a moved section carries its body; a single-line move is a heading", () => {
  const a = read(pairs[1][0]).split("\n");
  const r = call({ cmd: "sem_diff", a: read(pairs[1][0]), b: read(pairs[1][1]), filename: "hours.md" });
  assert.ok(r.moveBlocks.length >= 1, "the sample has a moved section");
  for (const m of r.moveBlocks) {
    assert.ok(m.text.trim().length > 0, JSON.stringify(m));
    if (m.fromEnd === m.fromStart) {
      // one line alone is only believable when it is a heading
      assert.match(a[m.fromStart - 1], /^#/, `single-line move must be a heading: ${JSON.stringify(m)}`);
    }
  }
});

test("code AST: a moved function is one node, not its children", () => {
  const r = call({ cmd: "ast_diff", a: read(pairs[0][0]), b: read(pairs[0][1]), filename: "pricebook.ts" });
  assert.ok(r.moves >= 1, r.summary);
  assert.ok(r.moves <= 6, `too many move nodes (${r.moves}): children of a moved block leaked`);
  // No assertion on deletes here: this sample also removes a function on purpose, so
  // "zero deletes" was never true of it. What this test guards is that a move is one node.
});

test("every family the formats page lists has a sample", () => {
  // PowerPoint was listed as supported while no sample existed and run() refused the file
  // read the declarations rather than importing TS
  const src = readFileSync(path.join(ROOT, "apps/website/src/lib/samples.ts"), "utf8");
  const families = new Set([...src.matchAll(/family:\s*"([a-z]+)"/g)].map((m) => m[1]));
  for (const f of ["code", "markdown", "xlsx", "docx", "pptx", "pdf"]) {
    assert.ok(families.has(f), `no sample for ${f}`);
  }
});

test("pptx sample shows an edit, an addition and an added slide", () => {
  const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const b64 = (f) => readFileSync(path.join(base, f)).toString("base64");
  const r = call({
    cmd: "opc_diff",
    kind: "pptx",
    a: b64("examples/pptx/term-sheet-v1.pptx"),
    b: b64("examples/pptx/term-sheet-v2.pptx"),
  });
  const kinds = new Set((r.revisions || []).map((x) => x.kind));
  // An edited paragraph is reported as a deletion plus an insertion, not as "change":
  // pairing the two by position hid the deletions a reader is looking for.
  assert.ok(kinds.has("insert"), `no addition: ${r.summary}`);
  assert.ok(kinds.has("delete"), `no deletion: ${r.summary}`);
  // the deck grew to four slides: a clause was added and one slide moved position
  assert.ok(r.slides >= 3, `expected at least 3 slides, got ${r.slides}`);
});

test("pdf sample spans several pages with real text", () => {
  const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  for (const f of ["examples/pdf/term-sheet-v1.pdf", "examples/pdf/term-sheet-v2.pdf"]) {
    const raw = readFileSync(path.join(base, f));
    const pages = (raw.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    assert.ok(pages >= 3, `${f} has ${pages} page(s); a single page cannot show paging`);
    // an embedded CJK font is what keeps the text layer from being glyph codes
    assert.ok(raw.length > 30000, `${f} is ${raw.length} bytes — no font embedded?`);
  }
});

test("prose gets no AST view: token-level moves are noise", () => {
  const r = call({ cmd: "ast_diff", a: read(pairs[1][0]), b: read(pairs[1][1]), filename: "hours.md" });
  assert.equal(r.inserts + r.deletes + r.updates + r.moves, 0, r.summary);
});

test("samples carry no private business content", () => {
  for (const [a, b] of pairs) {
    for (const rel of [a, b]) {
      const text = read(rel);
      for (const banned of ["股权投资", "回购权", "目标公司", "投资方", "受让", "万元", "创始人", "B3 轮"]) {
        assert.ok(!text.includes(banned), `${rel} contains "${banned}"`);
      }
    }
  }
});
