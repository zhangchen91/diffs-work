import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const x = await import(path.join(HERE, "../.test/bundle.mjs"));

const doc = (inner) => `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${inner}</w:body></w:document>`;

test("parses element paths with sibling indices", () => {
  const d = x.parseXml(doc('<w:p><w:r><w:t>甲</w:t></w:r></w:p><w:p><w:r><w:t>乙</w:t></w:r></w:p>'));
  const paths = d.nodes.map((n) => n.path);
  assert.ok(paths.includes("w:document/w:body/w:p[2]/w:r/w:t"));
  const t2 = d.nodes.find((n) => n.path.endsWith("w:p[2]/w:r/w:t"));
  assert.equal(t2.text, "乙");
});

test("text change is reported at the deepest path", () => {
  const a = doc("<w:p><w:r><w:t>投资方拟以人民币 8,000 万元</w:t></w:r></w:p>");
  const b = doc("<w:p><w:r><w:t>投资方拟以人民币 8,500 万元</w:t></w:r></w:p>");
  const d = x.diffXml(a, b);
  assert.equal(d.counts.mod, 1);
  const c = d.changes[0];
  assert.match(c.old, /8,000/);
  assert.match(c.new, /8,500/);
  assert.equal(x.contextOf(c.path), "w:document › w:body › w:p › w:r › w:t");
});

test("attribute change alone is counted", () => {
  const a = doc('<w:p w:val="first"><w:r/></w:p>');
  const b = doc('<w:p w:val="second"><w:r/></w:p>');
  const d = x.diffXml(a, b);
  assert.equal(d.counts.attr, 1);
  assert.equal(d.changes[0].attrChanged[0].name, "w:val");
});

test("inserted element shows as add, not a rewrite of its siblings", () => {
  const a = doc("<w:p><w:r><w:t>一</w:t></w:r></w:p>");
  const b = doc("<w:p><w:r><w:t>一</w:t></w:r><w:r><w:t>二</w:t></w:r></w:p>");
  const d = x.diffXml(a, b);
  assert.ok(d.counts.add >= 1);
});

test("identical documents report no changes", () => {
  const s = doc("<w:p><w:r><w:t>同</w:t></w:r></w:p>");
  assert.equal(x.diffXml(s, s).changes.length, 0);
});

test("CDATA and entities decode", () => {
  const d = x.parseXml('<a><b><![CDATA[1 < 2]]></b><c>&amp;&#20013;</c></a>');
  assert.equal(d.nodes.find((n) => n.tag === "b").text, "1 < 2");
  assert.equal(d.nodes.find((n) => n.tag === "c").text, "&中");
});

test("unclosed tags do not throw", () => {
  const d = x.parseXml("<a><b><c>text");
  assert.ok(d.nodes.length >= 2);
});

test("a real sheet XML diff finds the changed cell text", async () => {
  const read = async (f) => {
    const { execFileSync } = await import("node:child_process");
    const p = path.join(ROOT, "examples/sheets", f);
    return execFileSync("unzip", ["-p", p, "xl/worksheets/sheet1.xml"], { maxBuffer: 1 << 26 }).toString("utf8");
  };
  const d = x.diffXml(await read("checklist-B3.xlsx"), await read("checklist-B4.xlsx"));
  assert.ok(d.changes.length > 0, "sheet1 differs");
});
