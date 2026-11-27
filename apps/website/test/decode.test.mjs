/**
 * decodeText tests — the mojibake bug (#review: 选 1 个文件时中文乱码).
 * Fixtures are generated here so the exact bytes each encoding produces are
 * visible in the test.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const { decodeText, isBinary, looksGarbled, familyOf } = await import(
  path.join(HERE, "../.test/bundle.mjs")
);

const utf8 = (s) => new TextEncoder().encode(s).buffer;
const gbk = (hex) => new Uint8Array(hex.replace(/\s+/g, "").match(/../g).map((h) => parseInt(h, 16))).buffer;

// "中文内容" in GBK is D6 D0 CE C4 C4 DA C8 DD
const CN_GBK = "d6d0cec4c4dac8dd";
// "中文内容" in UTF-8 is E4 B8 AD E6 96 87 E5 86 85 E5 AE B9
const CN_UTF8 = "e4b8ade69687e58685e5aeb9";

test("UTF-8 without BOM decodes unchanged", () => {
  assert.equal(decodeText(utf8("中文内容")), "中文内容");
});

test("UTF-8 with BOM strips the BOM", () => {
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new Uint8Array(utf8("标题"))]);
  assert.equal(decodeText(bytes.buffer), "标题");
});

test("GBK bytes decode as Chinese, not U+FFFD", () => {
  const text = decodeText(gbk(CN_GBK));
  assert.equal(text, "中文内容");
  assert.ok(!text.includes("\uFFFD"));
});

test("UTF-8 bytes are never misread as GBK", () => {
  assert.equal(decodeText(gbk(CN_UTF8)), "中文内容");
});

test("UTF-16LE with BOM decodes", () => {
  const s = "中文";
  const b = new Uint8Array(2 + s.length * 2);
  b[0] = 0xff;
  b[1] = 0xfe;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    b[2 + i * 2] = code & 0xff;
    b[3 + i * 2] = code >> 8;
  }
  assert.equal(decodeText(b.buffer), "中文");
});

test("isBinary spots a docx (NUL bytes in the header area)", async () => {
  const docx = new Uint8Array(await readFile(path.join(ROOT, "examples/docx/contract-v1.docx")));
  assert.equal(isBinary(docx.buffer), true);
  assert.equal(isBinary(utf8("纯文本内容\n第二行")), false);
});

test("looksGarbled catches the old file.text() failure mode", () => {
  assert.equal(looksGarbled("中文内容"), false);
  assert.equal(looksGarbled("\uFFFD\uFFFD\uFFFD\uFFFD"), true);
  assert.equal(looksGarbled("中\uFFFD文\uFFFD\uFFFD"), true);
  assert.equal(looksGarbled(""), false);
});

test("familyOf maps every family the UI offers", () => {
  const cases = {
    "a.md": "markdown",
    "a.ts": "code",
    "a.csv": "csv",
    "a.tsv": "csv",
    "a.svg": "svg",
    "a.xlsx": "xlsx",
    "a.xlsm": "xlsx",
    "a.docx": "docx",
    "a.pptx": "pptx",
    "a.pdf": "pdf",
    "a.unknown": "text",
  };
  for (const [name, family] of Object.entries(cases)) assert.equal(familyOf(name), family, name);
});