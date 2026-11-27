import { diffDocx, diffPptx } from "@diffs/core-ooxml";
export { DIFF_TOOL } from "./tool-schema.ts";
export { toOpenUI, type OpenUIOptions } from "./openui.ts";
/**
 * diff.compare — the single contract every diffs.work surface registers.
 *
 * The website, the local server, the Chrome extension and the DeepSeek Harness
 * plugin all resolve an input pair to plain text and run the *same* comparison,
 * so an agent and a person see the same answer.
 *
 * Node-only module (reads files, runs `git diff`); the browser packages import
 * the pure helpers from @diffs/core-* directly.
 */
import { readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { diffText, type TextDiffResult } from "@diffs/core-text";
import { diffCode, type CodeDiffResult } from "@diffs/core-code";
import { familyOf, type FileFamily } from "@diffs/dom-utils/files";
import { astDiff, semanticDiff, symbolTypes } from "./rust-engine.ts";
import { isReformatOnly } from "./reformatted.ts";
import { detectRename } from "./renamed.ts";
import { detectExtracted, detectInlined } from "./extracted.ts";

const execFileAsync = promisify(execFile);

// Name, description and input schema live in ./tool-schema.ts — the one contract every agent
// surface reads. They used to be defined here as well, with different wording from the copy in
// the MCP server and a third copy in the DSH plugin.
export { DIFF_TOOL_NAME, DIFF_TOOL_DESCRIPTION, DIFF_TOOL_INPUT_SCHEMA } from "./tool-schema.ts";
export { DIFF_TOOL_INPUT_SCHEMA as DIFF_TOOL_PARAMETERS } from "./tool-schema.ts";

export interface CompareInput {
  old?: string;
  new?: string;
  revision?: string;
  cwd?: string;
  context?: number;
  maxHunks?: number;
  format?: "json" | "unified";
}

export interface CompareResult {
  /**
   * The contract version, emitted on every result. The docs have documented this field since the
   * contract was written and call it "always diffs.work/portable@1", but nothing ever set it — a
   * reader writing `if (r.schema === "diffs.work/portable@1")` got undefined and could only
   * conclude the tool was not speaking the contract.
   */
  schema: "diffs.work/portable@1";
  kind: "text" | "code" | "binary";
  oldLabel: string;
  newLabel: string;
  family: FileFamily;
  added: number;
  removed: number;
  hunks: Array<{ header: string; lines: Array<{ kind: string; oldLine: number | null; newLine: number | null; text: string }> }>;
  truncated: boolean;
  symbols?: { added: string[]; removed: string[] };
  unified?: string;
  note?: string;
  /** a helper pulled out of a caller, when the whole change is that */
  extracted?: { helper: string; caller: string };
  /** a helper whose body was written out at its call site */
  inlined?: { helper: string; caller: string };
  /** the single rename that explains the whole change, when there is one */
  rename?: { from: string; to: string };
  /** semantic (update / move aware) section from the Rust kernel */
  semantic?: import("./rust-engine").SemanticSection;
  /** AST node diff with line+column ranges from the Rust kernel */
  ast?: import("./rust-engine").AstSection;
  /** type hints + definition sites (annotations only, no guessing) */
  types?: import("./rust-engine").TypeSection;
  /** A one-line description for a human reading a terminal. Always present. */
  summary: string;
  /**
   * The counts, as the portable@1 contract defines them — an object, not the sentence above.
   *
   * These were the same field for a while: the contract documented `summary.added` and the CLI
   * wrote a string into `summary`, so `jq .summary.added` on a documented example returned null.
   */
  counts?: { added: number; removed: number; changed: number; ratio: number };
}

const BINARY_FAMILIES: FileFamily[] = ["docx", "xlsx", "pptx", "pdf"];

function isTextFamily(f: FileFamily): boolean {
  // `csv` and `svg` are text. They were added to the family list — and to the viewer's registry,
  // with their own "engine" labels — but not here, so the CLI and the MCP tool classified them as
  // binary and answered "NOT COMPARED: diffed by the browser engine", which was not true of either.
  return f === "text" || f === "markdown" || f === "code" || f === "csv" || f === "svg";
}

export async function resolveRevisionFile(file: string, revision: string, cwd: string): Promise<string> {
  const rel = path.relative(cwd, path.resolve(cwd, file));
  try {
    const { stdout } = await execFileAsync("git", ["show", `${revision}:${rel}`], { cwd, maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    // `Command failed: git show HEAD:x` with a fatal line under it reads like the tool broke. Name
    // the two things that can actually be wrong: the revision, or the file inside it.
    const detail = (err as { stderr?: string }).stderr ?? "";
    if (/does not exist in|exists on disk, but not in/.test(detail)) {
      throw new Error(`${rel} is not in ${revision} — it may be new, or renamed since then.`);
    }
    if (/unknown revision|bad revision|ambiguous argument|invalid object name/.test(detail)) {
      throw new Error(`there is no revision ${revision} in this repository.`);
    }
    throw new Error(`could not read ${rel} at ${revision}: ${detail.split("\n").find((l) => l.startsWith("fatal:")) ?? detail}`);
  }
}

/** Run the comparison and return the canonical structured result (never throws for a diffable pair). */
import { opcDiff, sheetDiff } from "./kernel.ts";

export async function compareFiles(input: CompareInput = {}): Promise<CompareResult> {
  const cwd = input.cwd ? path.resolve(input.cwd) : process.cwd();
  const context = Math.min(Math.max(input.context ?? 3, 0), 20);
  const maxHunks = Math.min(Math.max(input.maxHunks ?? 40, 1), 200);

  let oldPath = input.old;
  let newPath = input.new;

  if (!oldPath && !newPath) throw new Error("diff.compare needs `old` and `new` (or `old` + `revision`).");
  if (oldPath && !newPath && !input.revision) throw new Error("diff.compare needs `new`, or `old` + `revision`.");
  if (!newPath) newPath = oldPath;

  const oldAbs = path.resolve(cwd, oldPath as string);
  const newAbs = path.resolve(cwd, newPath as string);
  const newFamily = familyOf(path.basename(newAbs));
  const oldFamily = familyOf(path.basename(oldAbs));
  const family = newFamily;
  // Comparing a spreadsheet with a markdown file is almost always a mistake — a drag that landed
  // the wrong file, or a stale picker. The family follows the *new* side, so the result was
  // silently rendered as whichever format happened to be on the right, with no sign that the two
  // sides were not the same kind of thing.
  const mixedFamilies =
    oldFamily !== newFamily && oldFamily !== "unknown" && newFamily !== "unknown"
      ? { old: oldFamily, new: newFamily }
      : null;

  const oldLabel = input.revision ? `${oldPath}@${input.revision}` : oldPath as string;
  const newLabel = newPath as string;

  if (!isTextFamily(family)) {
    // The same kernel the viewer uses runs here too: an agent that asks about an xlsx gets
    // the cell changes, not a link to open a browser tab.
    if (family === "xlsx" || family === "docx" || family === "pptx") {
      try {
        const oldBytes = new Uint8Array(await readFile(oldAbs));
        const newBytes = new Uint8Array(await readFile(newAbs));
        if (family === "xlsx") {
          const sheet = sheetDiff(oldBytes, newBytes);
          if (sheet) {
            const t = sheet.totals;
            const lines = sheet.sheets
              .filter((s) => s.added + s.removed + s.modified + s.styleChanged > 0)
              .map(
                (s) =>
                  `${s.name}: +${s.added} -${s.removed} ~${s.modified}` +
                  (s.styleChanged ? ` ✎${s.styleChanged}` : "") +
                  (s.oldName ? ` (was ${s.oldName})` : ""),
              );
            return {
              schema: "diffs.work/portable@1",
              kind: "binary",
              summary: `${t.sheets} sheet(s), ${t.added} added / ${t.removed} removed / ${t.modified} changed cells`,
              oldLabel,
              newLabel,
              family,
              added: t.added,
              removed: t.removed,
              hunks: sheet.sheets
                .filter((s) => s.changes.length > 0)
                .map((s) => ({
                  header: `## ${s.name}`,
                  lines: s.changes.slice(0, 200).map((c) => ({
                    kind: c.op === "add" ? "add" : c.op === "remove" ? "remove" : "update",
                    oldLine: null,
                    newLine: null,
                    text: `${c.ref}${c.op === "add" ? " + " + (c.new ?? "") : c.op === "remove" ? " - " + (c.old ?? "") : " " + (c.old ?? "") + " → " + (c.new ?? "")}`,
                  })),
                })),
              truncated: false,
              // see the docx branch: an own `undefined` property is not lossless JSON
              note: `${t.sheets} sheet(s), ${t.added} added / ${t.removed} removed / ${t.modified} changed cells`,
            };
          }
        } else {
          // The kernel first (it also reads headers, comments and tracked changes). When it is
          // unavailable — a host that cannot instantiate wasm, say — fall back to the plain
          // TypeScript reader: "I cannot diff a .docx here" is not an acceptable answer from a
          // plugin whose job is to diff documents.
          const opc = opcDiff(oldBytes, newBytes, family as "docx" | "pptx") ?? tsOoxml(oldBytes, newBytes, family);
          if (opc) {
            const parts = [...new Set(opc.revisions.map((r) => r.part))];
            return {
              schema: "diffs.work/portable@1",
              kind: "binary",
              summary: opc.summary,
              oldLabel,
              newLabel,
              family,
              added: opc.added,
              removed: opc.removed,
              hunks: parts.map((part) => ({
                header: `## ${part}`,
                lines: opc.revisions
                  .filter((r) => r.part === part)
                  .slice(0, 200)
                  .map((r) => ({
                    kind: "update",
                    oldLine: null,
                    newLine: null,
                    text: `${r.old} → ${r.new}`,
                  })),
              })),
              truncated: false,
              // No `unified` key at all: assigning `undefined` leaves an own property whose
              // value cannot survive JSON, and a host that requires lossless JSON rejects the
              // whole result — which is why every docx tool call came back as "value is not
              // lossless JSON" while code results were fine.
              note: opc.summary,
            };
          }
        }
      } catch {
        /* fall through to the "open the viewer" note */
      }
    }
    return {
      schema: "diffs.work/portable@1",
      kind: "binary",
      // One message cannot serve both cases. `doc`/`xls`/`ppt` are OLE2 binaries from before 2007:
      // nothing in this project reads them, in the browser or out of it, and saying "the browser
      // engine does it" sent the reader to a page that cannot help. Everything else here really is
      // waiting on the viewer's kernel.
      summary:
        family === "legacy-office"
          ? `NOT COMPARED: ${family} files are the pre-2007 OLE2 formats. Neither the CLI nor the ` +
            `viewer reads them, so this pair cannot be compared anywhere in this project. ` +
            `Save as .docx / .xlsx / .pptx and compare those.`
          : `NOT COMPARED: ${family} files are diffed by the browser engine, which the CLI does not ` +
            `run. The zero counts here are not a result.`,
      oldLabel,
      newLabel,
      family,
      added: 0,
      removed: 0,
      hunks: [],
      truncated: false,
      // The counts above are zeros because nothing was compared here, not because the two files
      // are the same. Saying so plainly matters: "0 added, 0 removed" that means "not compared"
      // is the most dangerous answer this tool can give.
      note:
        `NOT COMPARED: ${family} files are diffed by the browser engine, which the CLI does not ` +
        `run. The zero counts here are not a result. To actually compare them, run \`diffs local\` ` +
        `and open the compare page.`,
    };
  }

  // Measured: two *completely different* files of 20 000 lines compare fine (20000 rows added),
  // and 40 000 lines exhausts V8's heap — a fatal OOM, not an answer. The cost is not the byte
  // size (40 000 lines is only 465 KB) but the number of unmatched rows the semantic pass has to
  // align. The limit is set below the measured failure point, and far above any file a person
  // reads by eye; a normal edit of a large file stays well inside it.
  const LIMIT_BYTES = 32 * 1024 * 1024;
  const LIMIT_LINES = 25_000;
  const tooBig = async (label: string, file: string, text?: string) => {
    const size = text ? text.length : (await stat(file)).size;
    if (size > LIMIT_BYTES) {
      throw new Error(
        `${label} is ${(size / 1024 / 1024).toFixed(1)} MB, over the ${LIMIT_BYTES / 1024 / 1024} MB limit. ` +
          `Split it, or compare the two revisions that matter with --revision.`,
      );
    }
    return text;
  };

  let oldText: string;
  let newText: string;
  if (input.revision) {
    oldText = await resolveRevisionFile(oldPath as string, input.revision, cwd);
    await tooBig(`${oldPath}@${input.revision}`, oldAbs, oldText);
    newText = await readFile(newAbs, "utf8");
    await tooBig(newPath as string, newAbs, newText);
  } else {
    await stat(oldAbs);
    await tooBig(oldPath as string, oldAbs);
    await tooBig(newPath as string, newAbs);
    oldText = await readFile(oldAbs, "utf8");
    newText = await readFile(newAbs, "utf8");
  }
  for (const [label, text] of [[oldPath as string, oldText], [newPath as string, newText]] as const) {
    const lines = text.split("\n").length;
    if (lines > LIMIT_LINES) {
      throw new Error(
        `${label} has ${lines} lines, over the ${LIMIT_LINES} line limit. ` +
          `Comparison is meant for files a person can read; split this one.`,
      );
    }
  }

  const result: TextDiffResult | CodeDiffResult =
    family === "code"
      ? diffCode(oldText, newText, path.basename(newAbs), context)
      : diffText(oldText, newText, context);

  const all = result.hunks;
  const hunks = all.slice(0, maxHunks).map((h) => ({
    header: h.header,
    lines: h.lines.map((l) => ({ kind: l.kind, oldLine: l.oldLine, newLine: l.newLine, text: l.text })),
  }));

  const out: CompareResult = {
    schema: "diffs.work/portable@1",
    kind: family === "code" ? "code" : "text",
    // Set here so the object is complete at construction; the semantic pass may replace it.
    summary: "",
    oldLabel,
    newLabel,
    family,
    added: result.added,
    removed: result.removed,
    hunks,
    truncated: all.length > hunks.length,
  };
  if (family === "code") out.symbols = (result as CodeDiffResult).symbols;
  // Every result carries a summary, not just the text families that compute one on the way. The
  // HTTP endpoint was appending its own, so the same xlsx came back with `summary` over HTTP and
  // without it on the CLI — two shapes for one contract.
  if (!out.summary) out.summary = summarizeThin(out);
  if (mixedFamilies) {
    // Say it instead of guessing: the numbers above were produced by treating both sides as the
    // new file's format, and the reader should know that before trusting them.
    out.note =
      `${oldLabel} is ${mixedFamilies.old} and ${newLabel} is ${mixedFamilies.new}; ` +
      `the comparison used the ${mixedFamilies.new} rules for both.`;
  }
  // 语义（改/移）与 AST（列级）两段：卡片与 agent 都靠它们看出"到底改了什么"
  const sem = semanticDiff(oldText, newText, path.basename(newAbs), context);
  if (sem) {
    // Mark whitespace-only hunks after the kernel, which reports them as ordinary edits. Python is
    // excluded: there, indentation is syntax and a reindent is a real change.
    // A rename first: it decides what the whole change *is*, and the reformat pass below would
    // otherwise relabel some of its hunks.
    // Relocations are not additions and deletions, and the kernel reports them as all three.
    // Three passes, in this order, because each removes rows the next one would miscount:
    //
    //   1. context rows (both line numbers present) are not changes — a one-line move came back as
    //      seven deletions because the hunk carried the surrounding lines;
    //   2. a row a `move` hunk already explains is not a deletion — moving a method left its
    //      closing `}` behind as a one-line deletion;
    //   3. rows identical on both sides at a different position are a relocation — swapping two
    //      methods produced six "inserted" and six "deleted" lines with byte-identical text.
    {
      const live = () => (sem.hunks ?? []).filter((h) => h.lines.length > 0);
      const textOf = (l: { text?: string }) => (l.text ?? "").trim();

      for (const h of sem.hunks ?? []) {
        if (h.operation !== "insert" && h.operation !== "delete") continue;
        h.lines = h.lines.filter((l) => !(l.oldNo != null && l.newNo != null));
      }
      sem.hunks = live();

      const movedText = new Map<string, number>();
      for (const h of sem.hunks ?? []) {
        if (h.operation !== "move") continue;
        for (const l of h.lines) {
          const t = textOf(l);
          if (t) movedText.set(t, (movedText.get(t) ?? 0) + 1);
        }
      }
      for (const h of sem.hunks ?? []) {
        if (h.operation !== "delete") continue;
        h.lines = h.lines.filter((l) => {
          const t = textOf(l);
          const n = t ? (movedText.get(t) ?? 0) : 0;
          if (n === 0) return true;
          movedText.set(t, n - 1);
          return false;
        });
      }
      sem.hunks = live();

      const pool = new Map<string, number>();
      for (const h of sem.hunks ?? []) {
        if (h.operation !== "delete") continue;
        for (const l of h.lines) {
          const t = textOf(l);
          if (t) pool.set(t, (pool.get(t) ?? 0) + 1);
        }
      }
      for (const h of sem.hunks ?? []) {
        if (h.operation !== "insert") continue;
        h.lines = h.lines.filter((l) => {
          const t = textOf(l);
          const n = t ? (pool.get(t) ?? 0) : 0;
          if (n === 0) return true;
          pool.set(t, n - 1);
          return false;
        });
      }
      for (const h of sem.hunks ?? []) {
        if (h.operation !== "delete") continue;
        h.lines = h.lines.filter((l) => {
          const t = textOf(l);
          const n = t ? (pool.get(t) ?? 0) : 0;
          if (n === 0) return false;
          pool.set(t, n - 1);
          return true;
        });
      }
      // A lone `}` or `)`: the shape of the code shifted, nothing about it changed. Reporting these
      // as insertions is how a pure reorder ended up with a "+1".
      for (const h of sem.hunks ?? []) {
        if (h.operation !== "insert" && h.operation !== "delete") continue;
        h.lines = h.lines.filter((l) => /[\p{L}\p{N}]/u.test(l.text ?? ""));
      }
      sem.hunks = live();
    }
    const extracted = detectExtracted(oldText, newText);
    // The inverse: a helper that vanished, with its body now inside its caller. Only named when a
    // declarations list confirms it — the detector is conservative and finds a fraction of the
    // cases the reference suite names, but it has never fired on a case that is not one.
    const inlined = extracted ? null : detectInlined(oldText, newText);
    if (inlined) out.inlined = inlined;
    if (extracted) out.extracted = extracted;
    const renamed = detectRename(oldText, newText);
    if (renamed) {
      for (const h of sem.hunks ?? []) h.operation = "renamed";
      out.rename = renamed;
    }
    if (!renamed && !/\.py$/i.test(newAbs)) {
      const oldLines = oldText.split("\n");
      const newLines = newText.split("\n");
      for (const h of sem.hunks ?? []) {
        if (h.operation !== "update") continue;
        // The kernel hunk carries line numbers per row, not a range: take the span the rows cover.
        const olds = h.lines.map((l) => l.oldNo).filter((n): n is number => n != null);
        const news = h.lines.map((l) => l.newNo).filter((n): n is number => n != null);
        if (!olds.length || !news.length) continue;
        const o0 = Math.min(...olds);
        const o1 = Math.max(...olds);
        const n0 = Math.min(...news);
        const n1 = Math.max(...news);
        if (isReformatOnly(oldLines, newLines, [o0, o1], [n0, n1])) h.operation = "reformatted";
      }
    }
    out.semantic = sem;
    // The sentence stays: the terminal prints it, and the tool description quotes it.
    // Say what the change *is* when we know. "2 hunks, +4/-1, 1 move" describes the shape of the
    // diff, not the change; an agent quoting it tells the person the wrong thing.
    out.summary = extracted
      ? `抽取函数：从 ${extracted.caller} 中拆出 ${extracted.helper}`
      : renamed
        ? `重命名：${renamed.from} → ${renamed.to}`
        : sem.summary;
  }
  out.counts = {
    added: out.added,
    removed: out.removed,
    changed: sem?.updates ?? 0,
    ratio: ratioOf(out.added + out.removed, oldText, newText),
  };
  const ast = astDiff(oldText, newText, path.basename(newAbs));
  if (ast) out.ast = ast;
  // 类型与定义位置：回答"这个函数是什么类型、在哪儿定义"
  if (family === "code") {
    const types = symbolTypes([
      { path: path.basename(oldAbs), text: oldText },
      { path: path.basename(newAbs), text: newText },
    ]);
    if (types) out.types = types;
  }
  if (input.format === "unified") out.unified = renderUnified(hunks, oldLabel, newLabel);
  return out;
}

export function renderUnified(hunks: CompareResult["hunks"], oldLabel: string, newLabel: string): string {
  const lines = [`--- ${oldLabel}`, `+++ ${newLabel}`];
  for (const h of hunks) {
    lines.push(h.header);
    for (const l of h.lines) lines.push((l.kind === "insert" ? "+" : l.kind === "delete" ? "-" : " ") + l.text);
  }
  return lines.join("\n");
}

/** Share of the file that changed, 0..1 — an overview number, never a decision. */
function ratioOf(changed: number, before: string, after: string): number {
  const lines = Math.max(1, before.split("\n").length, after.split("\n").length);
  // Three decimals is enough for a 300-line file and useless for a 20 000-line one: three
  // changed lines reported `0`, which reads as "nothing changed". Six decimals keeps a small
  // change visible at any size, and zero still means zero.
  return Math.round(Math.min(1, changed / lines) * 1e6) / 1e6;
}

/**
 * One-line summary for a terminal or a tool result.
 *
 * The wording is Chinese and not localised: it is the same sentence for a CLI run and an agent's
 * tool result, and translating it per-locale would make two runs of the same comparison print
 * different strings — the opposite of what this product is for. Machines should read `counts`.
 */
/** The TypeScript OOXML reader, shaped like the kernel's summary so the two are interchangeable. */
function tsOoxml(
  oldBytes: Uint8Array,
  newBytes: Uint8Array,
  family: string,
): { summary: string; added: number; removed: number; revisions: Array<{ part: string; old?: string; new?: string }> } | null {
  if (family !== "docx" && family !== "pptx") return null;
  try {
    const r = family === "docx" ? diffDocx(oldBytes, newBytes) : diffPptx(oldBytes, newBytes);
    if (!r.revisions.length) return null;
    return {
      summary: r.summary,
      added: r.added,
      removed: r.removed,
      revisions: r.revisions.map((v) => ({ part: v.part, old: v.old, new: v.new })),
    };
  } catch (e) {
    if (process.env.DIFFS_DEBUG_OOXML) console.error("[tsOoxml] failed:", e);
    return null;
  }
}

export function summarizeThin(r: CompareResult): string {
  if (r.kind === "binary") {
    // Only say "needs a renderer" when that is the truth. An xlsx or docx the kernel did compare
    // has a real note ("1 sheet(s), 4 added …"); saying it needs the local viewer anyway told a
    // reader that a comparison which had just happened did not.
    if (r.note && !r.note.startsWith("NOT COMPARED")) return r.note;
    // Pre-2007 OLE2 files are not compared anywhere, so pointing the reader at the viewer is the
    // same wrong answer as the note above used to give.
    if (r.family === "legacy-office") {
      return `${r.newLabel}（legacy-office）是 2007 年前的二进制格式，本项目读不了；另存为 .docx / .xlsx / .pptx 再比。`;
    }
    return `${r.newLabel}（${r.family}）需要 WASM 渲染器，请在 diffs.work 本地视图打开。`;
  }
  if (!r.hunks.length) return `${r.oldLabel} 与 ${r.newLabel} 完全一致（${r.added + r.removed === 0 ? "无差异" : ""}）。`;
  const sym = r.symbols ? ` · symbols +${r.symbols.added.length}/-${r.symbols.removed.length}` : "";
  return `${r.hunks.length} 处差异 · +${r.added}/-${r.removed} 行${sym}`;
}
export { semanticDiff, astDiff, symbolGraph, symbolTypes, gotoAt, kernelAvailable } from "./rust-engine.ts";
