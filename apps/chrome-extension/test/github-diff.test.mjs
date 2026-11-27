/**
 * The GitHub annotation: what gets marked, and that it leaves everything else alone.
 *
 * These run without a browser. `annotateGithubDiff` reads a document, so the test builds the
 * smallest DOM that matches what GitHub actually renders — verified against a live commit page
 * on 2026-11-27: `tr.diff-line-row`, `td.diff-line-number`, `td.diff-text-cell`, with the side
 * spelled `left-side-diff-cell` / `right-side-diff-cell` on the text cell.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

/**
 * Load a source module as one bundled ES module.
 *
 * The extension ships no runtime dependencies, so its tests add none either: esbuild is already
 * the repository's bundler, and `bundle` resolves the module's own relative imports into one file
 * that a data URL can load.
 * @param {string} relative - path under src/.
 * @returns {Promise<Record<string, unknown>>} the module's exports.
 */
async function load(relative) {
  const { build } = await import("esbuild");
  const result = await build({
    entryPoints: [path.join(ROOT, "src", relative)],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    logLevel: "silent",
  });
  const code = Buffer.from(result.outputFiles[0].contents).toString("utf8");
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

/**
 * The smallest DOM the annotation needs.
 *
 * Pulling in jsdom for five assertions would add a dependency to a package that deliberately has
 * none, so the few operations `annotateGithubDiff` performs — query by tag and class, read and
 * replace text, set an attribute — are implemented over plain objects.
 */
function makeDom() {
  class Node {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.attributes = {};
      this._text = "";
      this.className = "";
      this.parent = null;
    }
    append(...nodes) {
      for (const node of nodes) {
        node.parent = this;
        this.children.push(node);
      }
    }
    appendChild(node) {
      this.append(node);
      return node;
    }
    get textContent() {
      if (this.children.length === 0) return this._text ?? "";
      return this.children.map((child) => child.textContent).join("");
    }
    set textContent(value) {
      // The DOM drops child nodes when text is assigned; `annotateGithubDiff` relies on that.
      this.children = [];
      this._text = String(value);
    }
    setAttribute(name, value) {
      this.attributes[name] = value;
    }
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name);
    }
    /** Every descendant, in document order. */
    all() {
      const out = [];
      const walk = (node) => {
        for (const child of node.children) {
          out.push(child);
          walk(child);
        }
      };
      walk(this);
      return out;
    }
    /** Tag + class selector, the only kind this module uses. */
    querySelectorAll(selector) {
      const [tag, ...classes] = selector.split(".");
      return this.all().filter((node) => node.tagName === tag.toUpperCase()
        && classes.every((cls) => (node.className || "").split(/\s+/).includes(cls)));
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null;
    }
  }
  const document = new Node("document");
  // `body` must be a CHILD of the document: `annotateGithubDiff` walks the node it is given, and a
  // detached `body` property would hold the rows the assertions look for.
  document.head = new Node("head");
  document.body = new Node("body");
  document.documentElement = new Node("html");
  document.append(document.head, document.body);
  document.createElement = (tag) => new Node(tag);
  document.createTextNode = (text) => {
    const node = new Node("#text");
    node.textContent = text;
    return node;
  };
  document.createDocumentFragment = () => new Node("#fragment");
  return { document, Node };
}

test("word comparison marks only the words that changed", async () => {
  const { diffWords } = await load("word-diff.ts");
  const [oldSide, newSide] = diffWords("交付：乙方应于签约后 45 日内交付。", "交付：乙方应于签约后 30 日内交付。");
  const oldChanged = oldSide.filter((s) => s.changed).map((s) => s.text).join("");
  const newChanged = newSide.filter((s) => s.changed).map((s) => s.text).join("");
  assert.equal(oldChanged, "45", "the old side marks only the number");
  assert.equal(newChanged, "30", "the new side marks only the number");
  // Nothing is lost: the segments rebuild both lines exactly.
  assert.equal(oldSide.map((s) => s.text).join(""), "交付：乙方应于签约后 45 日内交付。");
  assert.equal(newSide.map((s) => s.text).join(""), "交付：乙方应于签约后 30 日内交付。");
});

test("an unchanged line marks nothing", async () => {
  const { diffWords } = await load("word-diff.ts");
  const [oldSide, newSide] = diffWords("const a = 1;", "const a = 1;");
  assert.equal(oldSide.every((s) => !s.changed), true);
  assert.equal(newSide.every((s) => !s.changed), true);
});

test("CJK text is split per character, not per sentence", async () => {
  const { tokenize } = await load("word-diff.ts");
  const tokens = tokenize("甲乙丙");
  assert.deepEqual(tokens, ["甲", "乙", "丙"], "without this a one-character edit would mark the whole line");
});

test("a GitHub-shaped diff pairs deletions with insertions", async () => {
  const { document: doc, Node } = makeDom();
  globalThis.document = doc;
  const { annotateGithubDiff } = await load("github-diff.ts");
  // The smallest document that matches the live page's markup.
  const row = (side, text) => {
    const tr = doc.createElement("tr");
    tr.className = "diff-line-row";
    const num = doc.createElement("td");
    num.className = "focusable-grid-cell diff-line-number";
    const cell = doc.createElement("td");
    cell.className = side === "old"
      ? "focusable-grid-cell diff-text-cell left-side-diff-cell"
      : side === "new"
        ? "focusable-grid-cell diff-text-cell right-side-diff-cell"
        : "focusable-grid-cell diff-text-cell right-side-diff-cell left-side";
    cell.textContent = text;
    tr.append(num, cell);
    return tr;
  };
  // The text carries GitHub's own `+`/`-` prefix, which is what marks the change on a live page:
  // unchanged and added rows share the same classes there.
  const table = doc.createElement("table");
  table.className = "diff-table";
  table.append(
    row("old", "-let count = 10;"),
    row("new", "+let count = 20;"),
  );
  doc.body.appendChild(table);

  const annotated = annotateGithubDiff(doc);
  assert.equal(annotated, 1, "one replaced line");

  const marks = doc.querySelectorAll("span.diffs-work-word").map((node) => node.textContent);
  assert.deepEqual(marks, ["10", "20"], "both sides mark only the changed token");

  // A second pass over the same page must not stack spans.
  assert.equal(annotateGithubDiff(doc), 0);
  assert.equal(doc.querySelectorAll("span.diffs-work-word").length, 2);
});

test("only GitHub diff pages are annotated", async () => {
  const { isGithubDiffPage } = await load("github-diff.ts");
  assert.equal(isGithubDiffPage("https://github.com/o/r/commit/abc123"), true);
  assert.equal(isGithubDiffPage("https://github.com/o/r/compare/main...dev"), true);
  assert.equal(isGithubDiffPage("https://github.com/o/r/pull/12/files"), true);
  assert.equal(isGithubDiffPage("https://github.com/o/r"), false);
  assert.equal(isGithubDiffPage("https://gitlab.com/o/r/commit/abc"), false);
});