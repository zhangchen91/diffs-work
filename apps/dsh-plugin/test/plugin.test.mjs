import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { apply } from "../lib/index.js";

/** The repository root: the fixture pairs live under examples/. */
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function fakeCtx() {
  const tools = [];
  const commands = [];
  const logs = [];
  return {
    tools: { register: (d) => tools.push(d) },
    commands: { register: (d) => commands.push(d) },
    logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m) },
    _tools: tools,
    _commands: commands,
    _logs: logs,
  };
}

async function tmpFiles() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "diffs-dsh-"));
  await writeFile(path.join(dir, "a.md"), "# 标题\n\n第一段\n第二段\n第三段\n第四段\n");
  await writeFile(path.join(dir, "b.md"), "# 标题\n\n第一段（改过）\n第二段\n第三段\n第四段\n新增一行\n");
  await writeFile(path.join(dir, "x.ts"), "export function a() {}\n");
  await writeFile(path.join(dir, "y.ts"), "export function a() {}\nexport function b() {}\n");
  return dir;
}

test("registers the diff_compare tool and both commands", () => {
  const ctx = fakeCtx();
  apply(ctx, { localUrl: "http://127.0.0.1:1" });
  assert.equal(ctx._tools.length, 1);
  assert.equal(ctx._tools[0].name, "diff_compare");
  assert.equal(ctx._tools[0].parameters.type, "object");
  assert.deepEqual(ctx._commands.map((c) => c.name), ["diff-open", "diff-last"]);
});

test("tool returns a structured markdown diff", async () => {
  const ctx = fakeCtx();
  apply(ctx, { localUrl: "http://127.0.0.1:1" });
  const dir = await tmpFiles();
  const tool = ctx._tools[0];
  const value = await tool.execute({ old: "a.md", new: "b.md", cwd: dir });
  assert.equal(value.kind, "text");
  assert.equal(value.family, "markdown");
  assert.equal(value.added, 2);
  assert.equal(value.removed, 1);
  assert.ok(value.hunks.length >= 1);
  assert.match(value.summary, /处差异/);
  const rendered = tool.output.render({}, value);
  assert.match(rendered[0].text, /第一段/);
});

test("tool detects changed symbols for code", async () => {
  const ctx = fakeCtx();
  apply(ctx, { localUrl: "http://127.0.0.1:1" });
  const dir = await tmpFiles();
  const tool = ctx._tools[0];
  const value = await tool.execute({ old: "x.ts", new: "y.ts", cwd: dir, format: "unified" });
  assert.equal(value.kind, "code");
  assert.ok(value.symbols.added.includes("b"));
  assert.match(value.unified, /^\+\+\+ /m);
});

test("docx files are compared with the kernel, not handed back", async () => {
  const ctx = fakeCtx();
  apply(ctx, { localUrl: "http://127.0.0.1:1" });
  const tool = ctx._tools[0];
  const value = await tool.execute({
    old: "examples/docx/contract-v1.docx",
    new: "examples/docx/contract-v2.docx",
    cwd: REPO,
  });
  assert.equal(value.family, "docx");
  // the kernel reports the tracked changes, so an agent sees the edit itself
  assert.ok(value.added > 0, `no insertions reported: ${value.note}`);
  assert.ok(value.hunks.length > 0);
});

test("xlsx files are compared cell by cell", async () => {
  const ctx = fakeCtx();
  apply(ctx, { localUrl: "http://127.0.0.1:1" });
  const tool = ctx._tools[0];
  const value = await tool.execute({
    old: "examples/sheets/checklist-B3.xlsx",
    new: "examples/sheets/checklist-B4.xlsx",
    cwd: REPO,
  });
  assert.equal(value.family, "xlsx");
  // Assert the tool reports what the file actually contains, not a number pinned to one
  // sample: the sample is editable, and a hard-coded count breaks on any change to it.
  assert.ok(value.added > 0, value.note);
  // An xlsx has no unified patch — that field was a per-sheet summary until round 74 removed it,
  // because the docs promise `unified` is a patch `patch` can read. The count lives in the note.
  assert.equal(value.unified, undefined, "an xlsx must not claim to have a patch");
  assert.match(value.note, /sheet/);
});

test("a corrupt binary still explains itself instead of throwing", async () => {
  const ctx = fakeCtx();
  apply(ctx, { localUrl: "http://127.0.0.1:1" });
  const tool = ctx._tools[0];
  const dir = await tmpFiles();
  await writeFile(path.join(dir, "a.docx"), "not a real docx");
  const value = await tool.execute({ old: "a.docx", new: "a.docx", cwd: dir });
  assert.equal(value.kind, "binary");
  assert.equal(value.family, "docx");
  assert.ok(typeof value.note === "string" && value.note.length > 0);
});

test("/diff-open without args points at the inbox", async () => {
  const ctx = fakeCtx();
  apply(ctx, { localUrl: "http://127.0.0.1:1" });
  const cmd = ctx._commands.find((c) => c.name === "diff-open");
  const r = await cmd.handler({ rawInput: "" });
  assert.equal(r.kind, "success");
  assert.match(r.text, /#\/inbox/);
});

test("/diff-open with a dead local server reports how to start it", async () => {
  const ctx = fakeCtx();
  apply(ctx, { localUrl: "http://127.0.0.1:1" });
  const cmd = ctx._commands.find((c) => c.name === "diff-open");
  const r = await cmd.handler({ rawInput: "a.md b.md" });
  assert.equal(r.kind, "error");
  assert.match(r.text, /diffs local/);
});

test("tool can be turned off by config", () => {
  const ctx = fakeCtx();
  apply(ctx, { tool: false, commands: false });
  assert.equal(ctx._tools.length, 0);
  assert.equal(ctx._commands.length, 0);
});
