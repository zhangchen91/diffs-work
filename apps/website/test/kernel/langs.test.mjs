/**
 * Column-level detail for every language the AST engine claims to support.
 *
 * The point of the structural view is that a one-token edit lands on those columns, not on
 * the whole line — and that it works the same in Python, Rust, Go, Java, shell, SQL, CSS,
 * JSON and HTML, not only in TypeScript. Each case below is the smallest edit that matters.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../..");
const WASM_PATH = path.join(ROOT, "apps/website/public/engine/rules-core/diffs-engine.wasm");
const SKIP = existsSync(WASM_PATH) ? false : "engine binary not built";

let cached = null;
function call(req) {
  if (!cached) {
    const ex = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(WASM_PATH)), {}).exports;
    cached = (r) => {
      const bytes = new TextEncoder().encode(JSON.stringify(r));
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
  return cached(req);
}

const CASES = [
  ["py", "def total(a, b):\n    return a + b\n\nprint(total(1, 2))\n", "def total(a, b):\n    return a - b\n\nprint(total(1, 2))\n", "-"],
  ["rs", "fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n\nfn main() {}\n", "fn add(a: i32, b: i32) -> i32 {\n    a - b\n}\n\nfn main() {}\n", "-"],
  ["go", "package main\n\nfunc add(a int, b int) int {\n\treturn a + b\n}\n", "package main\n\nfunc add(a int, b int) int {\n\treturn a - b\n}\n", "-"],
  ["java", "class A {\n  int add(int a, int b) { return a + b; }\n}\n", "class A {\n  int add(int a, int b) { return a - b; }\n}\n", "-"],
  ["sh", "total=1\nsum=$((total + 2))\necho $sum\n", "total=1\nsum=$((total - 2))\necho $sum\n", "-"],
  ["sql", "SELECT id, name\nFROM users\nWHERE age > 18;\n", "SELECT id, name\nFROM users\nWHERE age >= 18;\n", ">="],
  ["css", ".a { color: red; }\n.b { margin: 0; }\n", ".a { color: blue; }\n.b { margin: 0; }\n", "blue"],
  ["json", "{\n  \"a\": 1,\n  \"b\": 2\n}\n", "{\n  \"a\": 1,\n  \"b\": 3\n}\n", "3"],
  // the HTML parser keeps a tag interior as one node, so this range is the attribute group
  ["html", "<div class=\"a\">x</div>\n<p>y</p>\n", "<div class=\"b\">x</div>\n<p>y</p>\n", "class", 20],
];

for (const [ext, a, b, expected, maxWidth = 12] of CASES) {
  test(`${ext}: a one-token edit is reported at its columns`, { skip: SKIP }, () => {
    const r = call({ cmd: "ast_diff", a, b, filename: "f." + ext });
    assert.ok(r.updates >= 1, `no update for .${ext}: ${r.summary}`);
    const h = r.after.hunks.find((x) => x.operation === "update");
    assert.ok(h, `no update hunk: ${JSON.stringify(r.after.hunks).slice(0, 200)}`);
    assert.equal(h.range.start_row, r.before.hunks[0].range.start_row, "the change is reported on the right line");
    assert.match(h.text, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `expected ${expected} in ${h.text}`);
    // the range must be the token, not the line
    assert.ok(h.range.end_column - h.range.start_column <= maxWidth, `too wide: ${JSON.stringify(h.range)}`);
  });
}

// Every extension the compare page accepts must produce *something*; before this, nine of
// them fell back to plain text because lang_of had no entry.
const EXTENSIONS = [
  ["ts", "const a = 1;\nexport const b = a + 2;\n", "const a = 1;\nexport const b = a + 3;\n"],
  ["tsx", 'export const C = () => <div className="a" />;\n', 'export const C = () => <div className="b" />;\n'],
  ["js", "function f(x) { return x * 2; }\n", "function f(x) { return x * 3; }\n"],
  ["jsx", 'export default () => <p title="a">x</p>;\n', 'export default () => <p title="b">x</p>;\n'],
  ["py", "def f(a):\n    return a + 1\n", "def f(a):\n    return a - 1\n"],
  ["rs", "fn f(a: i32) -> i32 { a + 1 }\n", "fn f(a: i32) -> i32 { a - 1 }\n"],
  ["go", "package m\n\nfunc F(a int) int { return a + 1 }\n", "package m\n\nfunc F(a int) int { return a - 1 }\n"],
  ["java", "class A { int f(int a) { return a + 1; } }\n", "class A { int f(int a) { return a - 1; } }\n"],
  ["kt", "fun f(a: Int): Int = a + 1\n", "fun f(a: Int): Int = a - 1\n"],
  ["cs", "class A { int F(int a) => a + 1; }\n", "class A { int F(int a) => a - 1; }\n"],
  ["c", "int f(int a) { return a + 1; }\n", "int f(int a) { return a - 1; }\n"],
  ["cpp", "int f(int a) { return a + 1; }\n", "int f(int a) { return a - 1; }\n"],
  ["rb", "def f(a)\n  a + 1\nend\n", "def f(a)\n  a - 1\nend\n"],
  ["php", "<?php function f($a) { return $a + 1; }\n", "<?php function f($a) { return $a - 1; }\n"],
  ["swift", "func f(_ a: Int) -> Int { return a + 1 }\n", "func f(_ a: Int) -> Int { return a - 1 }\n"],
  ["scala", "object A { def f(a: Int) = a + 1 }\n", "object A { def f(a: Int) = a - 1 }\n"],
  ["yaml", "a: 1\nb: 2\n", "a: 1\nb: 3\n"],
  ["toml", "a = 1\nb = 2\n", "a = 1\nb = 3\n"],
  ["xml", '<a b="1"/>\n', '<a b="2"/>\n'],
];

for (const [ext, a, b] of EXTENSIONS) {
  test(`${ext}: the extension is recognised and produces a change`, { skip: SKIP }, () => {
    const r = call({ cmd: "ast_diff", a, b, filename: "f." + ext });
    assert.notEqual(r.language, "text", `.${ext} fell back to plain text`);
    const n = (r.updates || 0) + (r.inserts || 0) + (r.deletes || 0) + (r.moves || 0);
    assert.ok(n >= 1, `.${ext}: no change reported (lang ${r.language})`);
  });
}

test("the semantic view agrees with the structural view on every case", { skip: SKIP }, () => {
  for (const [ext, a, b] of CASES) {
    const sem = call({ cmd: "sem_diff", a, b, filename: "f." + ext });
    assert.ok(sem.updates >= 1, `.${ext}: semantic view found no change`);
  }
});
