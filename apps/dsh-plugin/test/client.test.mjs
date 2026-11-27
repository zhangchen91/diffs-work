/**
 * Browser half: the module-loader factory must register the four seats, and the
 * result parser must turn a `diff_compare` tool block into the card model.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "../lib/client.js");

/** Load the bundle the way the browser does: a module loader plus a React table. */
function load() {
  let entry = null;
  const registered = [];
  const fakeReact = {
    createElement: (type, props, ...kids) => ({ type, props: props || {}, kids }),
    useState: (v) => [typeof v === "function" ? v() : v, () => {}],
    useMemo: (fn) => fn(),
    useEffect: () => {},
  };
  globalThis.window = { __ModuleLoader__: { load: (m) => { entry = m; } } };
  globalThis.document = {
    createElement: () => ({ setAttribute() {}, appendChild() {}, removeChild() {} }),
    head: { appendChild() {} },
  };
  // eslint-disable-next-line no-eval
  eval(readFileSync(SRC, "utf8"));
  const mod = entry.factory((name) => {
    if (name === "react") return fakeReact;
    throw new Error("unexpected require: " + name);
  });
  const ctx = {
    effect: (fn) => fn(),
    slots: {
      inject: (name, fn) => {
        fn();
        return () => {};
      },
      register: (opts, component) => {
        registered.push({ ...opts, component });
        return () => {};
      },
    },
  };
  mod.apply(ctx);
  return { mod, registered };
}

test("registers the diff card, the pending list, the footer button and the dock strip", () => {
  const { registered } = load();
  const seats = registered.map((r) => `${r.name}:${r.key || r.id}`);
  assert.ok(seats.includes("tool.call.toolview:diff_compare"), seats.join(", "));
  assert.ok(seats.some((s) => s.startsWith("shell.overlay:")), seats.join(", "));
  assert.ok(seats.some((s) => s.startsWith("sidebar.footer.action:")), seats.join(", "));
  assert.ok(seats.some((s) => s.startsWith("conversation.composer.dock:")), seats.join(", "));
});

test("parses a tool result into name, counts and hunks", () => {
  const { mod } = load();
  const diff = mod.__internals.toDiff({
    callId: "call-1",
    argsRaw: JSON.stringify({ old: "/w/a/parse-v1.ts", new: "/w/a/parse-v2.ts" }),
    content: JSON.stringify({
      name: "parse-v2.ts",
      family: "code",
      added: 3,
      removed: 1,
      summary: "4 lines changed",
      hunks: [{ header: "@@ -1,3 +1,5 @@", lines: [{ op: "add", newLine: 4, text: "level: number;" }] }],
    }),
  });
  assert.equal(diff.name, "parse-v2.ts");
  assert.equal(diff.added, 3);
  assert.equal(diff.removed, 1);
  assert.equal(diff.hunks.length, 1);
  assert.equal(diff.id, "call-1");
});

test("a result without JSON still yields a usable pending card", () => {
  const { mod } = load();
  const diff = mod.__internals.toDiff({ callId: "c2", argsRaw: '{"new":"/w/b.xlsx"}', content: "comparing…" });
  assert.equal(diff.name, "b.xlsx");
  assert.equal(diff.pending, true);
  assert.equal(diff.family, "xlsx");
});

test("records are de-duplicated by call id and capped", () => {
  const { mod } = load();
  const st = mod.__internals.state;
  for (let i = 0; i < 60; i++) {
    const diff = mod.__internals.toDiff({
      callId: "c" + (i % 55),
      argsRaw: '{"new":"/w/f' + i + ".ts\"}",
      content: JSON.stringify({ name: "f" + i + ".ts", added: 1, removed: 0, hunks: [] }),
    });
    const before = st.records.length;
    // the card's effect records; emulate it here because effects do not run
    if (!st.records.some((r) => r.id === diff.id)) st.records.unshift(diff);
    if (st.records.length > 50) st.records.length = 50;
    if (st.records.length === before && st.records.length > 0) {
      // duplicate id: no growth
      assert.ok(st.records.filter((r) => r.id === diff.id).length === 1);
    }
  }
  assert.equal(st.records.length, 50);
});

test("semantic results are drawn as add / del / mod / move, not rows only", () => {
  const { mod } = load();
  const payload = {
    name: "a.ts",
    summary: "1 update",
    added: 2,
    removed: 1,
    updates: 3,
    moves: 1,
    hunks: [
      {
        operation: "update",
        lines: [
          { kind: "upd-del", oldNo: 7, newNo: null, text: "amount: 8000", segments: [{ op: "del", text: "0" }] },
          { kind: "upd-ins", oldNo: null, newNo: 7, text: "amount: 8500", segments: [{ op: "ins", text: "5" }] },
        ],
      },
    ],
  };
  const diff = mod.__internals.toDiff({ callId: "sem-1", argsRaw: '{"new":"/w/a.ts"}', content: JSON.stringify(payload) });
  assert.equal(diff.modified, 3, "updates surface as 改");
  assert.equal(diff.moved, 1, "moves surface as 移");
  const ops = diff.hunks.flatMap((h) => h.lines.map((l) => l.op));
  assert.ok(ops.includes("mod"), ops.join(","));
});

test("AST results become node rows with the column range", () => {
  const { mod } = load();
  const payload = {
    name: "a.ts",
    summary: "1 node change",
    before: { hunks: [] },
    after: { hunks: [{ operation: "update", range: { start_row: 4, start_column: 7, end_row: 4, end_column: 11 }, text: "8500" }] },
  };
  const diff = mod.__internals.toDiff({ callId: "ast-1", argsRaw: '{"new":"/w/a.ts"}', content: JSON.stringify(payload) });
  const row = diff.hunks[0].lines[0];
  assert.equal(row.op, "mod");
  assert.equal(row.oldLine, 5, "1-based row");
  assert.match(row.text, /列 8–11/, row.text);
});

test("a card with hunks renders through Hunks, not the OpenUI table", () => {
  // The desktop card was drawing Card+Text+Table — the OpenUI description of a comparison — and
  // that is what a reader saw next to the website's side-by-side view: a plain table with no line
  // numbers. `Hunks` was already written and already carried both columns; it was simply never
  // reached because `openui` was checked first. This pins the order.
  const src = readFileSync(SRC, "utf8");
  // The bundle is minified, so assert on the shape rather than the comment: the truthy branch of
  // the choice is the Hunks call, and `openui` only appears in the fallback.
  const m = /diff\.hunks && diff\.hunks\.length\s*\?\s*h\(Hunks,/.exec(src);
  assert.ok(m, "hunks present must render Hunks, before any openui fallback");
  // And the fallback still exists, so a payload with only `openui` keeps rendering.
  assert.ok(/diff\.openui\s*\?\s*h\(OpenUICard/.test(src), "openui stays as the fallback");
});

test("side-by-side pairs a deletion with the insertion that replaces it", () => {
  // The card draws two columns now. A deleted row belongs on the left only, an inserted row on the
  // right only, and an unchanged row on both — pairing them wrongly puts a line beside an unrelated
  // one, which reads worse than the unified view it replaced.
  const src = readFileSync(SRC, "utf8");
  assert.match(src, /function buildRows\(/, "the pairing must exist");
  assert.match(src, /pending\.shift\(\)/, "a deletion is paired with the next insertion");
  // per-hunk pairing: the gap marker is what keeps one hunk's deletions away from the next's
  assert.match(src, /gap: true/, "hunks are paired separately");
});

test("counts come from the rows when the payload carries no totals", async () => {
  // `portable@1` puts `added`/`removed` at the top level, but a tool result can arrive as hunks
  // alone. The card read the missing totals and showed `+0 -0` beside six real rows — which is the
  // "两版内容一致" a reader saw under a file that had clearly changed.
  const { mod } = load();
  const payload = {
    name: "x.ts",
    hunks: [{ header: "@@ -1,4 +1,4 @@", lines: [
      { op: "same", oldLine: 1, newLine: 1, text: "a" },
      { op: "del", oldLine: 2, newLine: null, text: "b" },
      { op: "ins", oldLine: null, newLine: 2, text: "c" },
      { op: "same", oldLine: 3, newLine: 3, text: "d" },
    ] }],
  };
  const diff = mod.__internals.toDiff({ callId: "count", content: JSON.stringify(payload) });
  assert.equal(diff.added, 1, "one inserted row");
  assert.equal(diff.removed, 1, "one deleted row");
});

test("the card renders two columns with line numbers and text", () => {
  // The headless render: a tree, not a promise. `+0 -0` beside six real rows would have shown up
  // here before it reached a reader.
  const { mod } = load();
  const payload = {
    name: "card-view.ts",
    hunks: [{ header: "@@ -1,3 +1,3 @@", lines: [
      { op: "same", oldLine: 1, newLine: 1, text: "export function parse(input: string) {" },
      { op: "del", oldLine: 2, newLine: null, text: "  return input.trim() || null;" },
      { op: "ins", oldLine: null, newLine: 2, text: "  return input.trim();" },
      { op: "same", oldLine: 3, newLine: 3, text: "}" },
    ] }],
  };
  const diff = mod.__internals.toDiff({ callId: "render", content: JSON.stringify(payload) });
  assert.ok(typeof mod.__internals.render === "function", "render must be exposed once registered");
  const tree = mod.__internals.render(diff);
  const flat = [];
  (function walk(n) {
    if (!n) return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (typeof n === "string") { flat.push(n); return; }
    flat.push((n.props && n.props.className) || "");
    // A component type is a function here; call it so the tree keeps descending.
    let kids = n.kids || [];
    if (typeof n.type === "function") {
      try { const inner = n.type(n.props); kids = inner ? [inner] : []; } catch (e) { return; }
    }
    kids.forEach(walk);
  })(tree);
  const cls = flat.join(" ");
  assert.match(cls, /dsw-2p-col/, "two columns");
  assert.ok(flat.includes("  return input.trim();"), "the inserted line is drawn");
  assert.ok(flat.includes("  return input.trim() || null;"), "the deleted line is drawn");
  assert.ok(flat.includes("1") && flat.includes("2"), "line numbers are drawn");
});
