/**
 * The highlighter must never change the text. Colour is presentation; if a span drops or
 * duplicates a character the diff stops being evidence — a reader would be looking at something
 * that is not the file.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { highlight } from "../src/lib/highlight.ts";

const join = (tokens) => tokens.map((t) => t.text).join("");

test("tokenising preserves every character, on every line", () => {
  const lines = [
    'const x = "hello // not a comment";',
    "// a real comment",
    "/* block */ const y = 1;",
    "if (a && b) { return `tpl ${x}`; }",
    "",
    "   indented_value = 'single \\' quote'",
    "/* unterminated",
  ];
  for (const line of lines) {
    assert.equal(join(highlight(line, "a.ts").tokens), line, `changed: ${line}`);
  }
});

test("a block comment spanning lines stays coloured throughout", () => {
  const one = highlight("/* start of a long comment", "a.ts");
  assert.equal(one.inBlockComment, true, "line 1 opens a block comment");
  const two = highlight("still inside it", "a.ts", true);
  assert.equal(two.inBlockComment, true, "line 2 is still inside");
  assert.ok(two.tokens.every((t) => t.kind === "comment"), "line 2 is all comment");
  const three = highlight("end */ const z = 1;", "a.ts", true);
  assert.equal(three.inBlockComment, false, "line 3 closes it");
  assert.equal(join(three.tokens), "end */ const z = 1;");
});

test("keywords, strings and comments are the kinds produced", () => {
  const { tokens } = highlight('const s = "x"; // note', "a.ts");
  const kinds = tokens.filter((t) => t.kind).map((t) => t.kind);
  assert.ok(kinds.includes("keyword"), "const is a keyword");
  assert.ok(kinds.includes("string"), "the literal is a string");
  assert.ok(kinds.includes("comment"), "the trailing comment is a comment");
});

test("a keyword belongs to the language, not to the set of all keywords", async () => {
  // Merging a shared word list into every language painted `const` and `let` as keywords in a
  // .py file. Wrong colour is worse than no colour: it asserts something false about the code.
  const kw = (line, file) =>
    highlight(line, file).tokens.filter((t) => t.kind === "keyword").map((t) => t.text);

  assert.deepEqual(kw("const x = 1;", "a.py"), [], "JS keywords must not appear in Python");
  assert.deepEqual(kw("let y = 2;", "a.py"), [], "nor `let`");
  assert.ok(kw("def f(): return None", "a.py").includes("None"), "Python's own keywords do");
  assert.ok(kw("if x is None:", "a.py").includes("is"), "`is` is a Python keyword");

  // and each family keeps its own
  assert.ok(kw("export const x = 1;", "a.ts").includes("const"));
  assert.ok(kw("pub fn main() {}", "a.rs").includes("fn"));
  assert.ok(kw("local function f() end", "a.lua").includes("local"));
  assert.ok(!kw("input = 1", "a.py").includes("input"));
});

test("a docstring keeps its colour on every line", () => {
  // `"""` opened one string and closed it immediately as three empty ones, and no line ever knew
  // the previous one had left a string open — so a docstring body rendered as plain code.
  let st = { inBlockComment: false, openQuote: null };
  const kinds = ["\"\"\"Summary line", "still the docstring", "ends here\"\"\"", "x = 1"].map((line) => {
    const r = highlight(line, "a.py", st.inBlockComment, st.openQuote);
    st = { inBlockComment: r.inBlockComment, openQuote: r.openQuote };
    return r.tokens.map((t) => t.kind ?? "-").join(" ");
  });
  assert.equal(kinds[0], "string", `opening line: ${kinds[0]}`);
  assert.equal(kinds[1], "string", `body line: ${kinds[1]}`);
  assert.equal(kinds[2], "string", `closing line: ${kinds[2]}`);
  assert.equal(kinds[3], "-", "code after the docstring is not a string");
});

test("an escaped quote does not end the string", () => {
  const tokens = highlight("s = 'it\\'s fine'", "a.py").tokens;
  assert.equal(tokens.filter((t) => t.kind === "string").length, 1, JSON.stringify(tokens));
  assert.equal(tokens.map((t) => t.text).join(""), "s = 'it\\'s fine'");
});

test("a stray quote does not turn the rest of the file into a string", async () => {
  // In a diff the line that closed a string is often the deleted one. Believing the dangling
  // quote forever made every following line a string literal — all colouring gone, silently.
  const { highlightLines } = await import("../src/lib/highlight.ts");
  const lines = ['const s = "the closing quote was deleted', ...Array.from({ length: 45 }, (_, i) => `const x${i} = 1;`)];
  const kinds = highlightLines(lines, "a.ts").map((tt) => tt.map((t) => t.kind ?? "-").join(" "));
  assert.equal(kinds[1], "string", "the next line is still plausibly inside the string");
  assert.ok(kinds[44].includes("keyword"), `line 44 never recovered: ${kinds[44]}`);
  // and the text is untouched either way
  const joined = highlightLines(lines, "a.ts").map((tt) => tt.map((t) => t.text).join(""));
  assert.deepEqual(joined, lines);
});

test("highlighting a large file stays fast", async () => {
  // Measured against a calibration run on the same machine: an absolute millisecond budget fails
  // whenever something else is using the CPU (it went red at 680 ms and 1425 ms on a loaded
  // laptop while the code was unchanged). What matters is that cost stays linear-ish, not that
  // this particular laptop is fast.
  const { highlightLines } = await import("../src/lib/highlight.ts");
  const line = "const value = computeTotal(items, 0.06); // note";
  const small = Array.from({ length: 500 }, () => line);
  const large = Array.from({ length: 5000 }, () => line);
  highlightLines(small, "a.ts"); // warm up
  const t1 = Date.now();
  highlightLines(small, "a.ts");
  const smallMs = Date.now() - t1;
  const t0 = Date.now();
  highlightLines(large, "a.ts");
  const ms = Date.now() - t0;
  // 10x the lines; allow 40x the time before calling it a regression
  const budget = Math.max(400, smallMs * 40);
  assert.ok(ms < budget, `5000 lines took ${ms} ms (500 took ${smallMs} ms, budget ${budget} ms)`);
});

test("a deleted line does not colour the context below it", async () => {
  // A diff interleaves two files. A deleted docstring opener belongs to the old file only, so it
  // must not put the shared context lines below it into a string — that is the deleted-quote bug
  // arriving from the other side.
  const { highlightSided } = await import("../src/lib/highlight.ts");
  const items = [
    { text: "def f():", side: "both" },
    { text: '    """old docstring', side: "old" },
    { text: "    return 1", side: "both" },
    { text: "    return 2", side: "both" },
  ];
  const kinds = highlightSided(items, "a.py").map((tt) => tt.map((t) => t.kind ?? "-").join(" "));
  assert.equal(kinds[1], "- string", "the deleted line is itself a string");
  assert.ok(kinds[2].includes("keyword"), `context line stayed a string: ${kinds[2]}`);
  assert.ok(kinds[3].includes("keyword"), `context line stayed a string: ${kinds[3]}`);
});

test("an inserted line does not colour the context either", async () => {
  const { highlightSided } = await import("../src/lib/highlight.ts");
  const items = [
    { text: "x = 1", side: "both" },
    { text: '# added comment', side: "new" },
    { text: "def g():", side: "both" },
  ];
  const kinds = highlightSided(items, "a.py").map((tt) => tt.map((t) => t.kind ?? "-").join(" "));
  assert.equal(kinds[1], "comment");
  assert.equal(kinds[2], "keyword -", `context became a comment: ${kinds[2]}`);
});
