import * as React from "react";
import { ArrowRightLeft, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "../lib/cn";
import { SemanticSplitView, type SplitLine } from "./semantic-split";
import { CodeLine } from "./code-line";
import { highlightSided } from "../lib/highlight";
import { DiffRuler, rulerMarksFrom } from "./diff-ruler";
import { useI18n } from "@diffs/i18n";

/**
 * Semantic diff view (the reference model, rendered in the site's own skin).
 *
 * Rows carry one of five states, and the state is the point of this view:
 *   add     green background, `+`
 *   del     red background, strikethrough text, `-`
 *   update  the old row (red) and the new row (green) are ONE row pair, shown
 *           stacked and linked by `→`, with word-level marks inside both sides
 *   move    a block that disappeared here and reappeared at `moveTo`
 *   ctx     unchanged context, dimmed
 *
 * The kernel returns hunks whose lines are `ctx / del / ins / upd-del / upd-ins`;
 * an `upd-del` is always followed by its `upd-ins`, which this view pairs.
 */
export interface SemSegment {
  op: "same" | "ins" | "del";
  text: string;
}

export interface SemLine {
  /** `move` is a row inside a relocation: unchanged text, but not in its old place. */
  kind: "ctx" | "del" | "ins" | "upd-del" | "upd-ins" | "move";
  oldNo: number | null;
  newNo: number | null;
  text: string;
  segments: SemSegment[] | null;
}

export interface SemHunk {
  /**
   * What kind of change this hunk represents. `reformatted` and `renamed` are the two a reader
   * asks about by name ("did anything actually change?") and were previously reported as a plain
   * edit, which made whitespace-only churn look like work.
   */
  operation: "insert" | "delete" | "update" | "move" | "reformatted" | "renamed";
  beforeStart: number | null;
  beforeEnd: number | null;
  afterStart: number | null;
  afterEnd: number | null;
  lines: SemLine[];
}

export interface SemMove {
  fromStart: number;
  fromEnd: number;
  toStart: number;
  toEnd: number;
  text: string;
}

export interface SemDiffResult {
  engine: string;
  summary: string;
  added: number;
  removed: number;
  inserts: number;
  deletes: number;
  updates: number;
  moves: number;
  hunks: SemHunk[];
  moveBlocks: SemMove[];
}

const OP_KEY: Record<string, string> = {
  insert: "sem.hunk.insert",
  delete: "sem.hunk.delete",
  update: "sem.hunk.update",
  move: "sem.hunk.move",
  reformatted: "sem.hunk.reformatted",
  renamed: "sem.hunk.renamed",
};

/** A row pair produced from `upd-del` + `upd-ins`, or a single add/del row. */
type Row =
  | { kind: "ctx"; oldNo: number | null; newNo: number | null; text: string }
  /** unchanged text carried by a relocation: shown on both sides, marked in the gutter */
  | { kind: "move"; oldNo: number | null; newNo: number | null; text: string }
  | { kind: "ins"; newNo: number | null; text: string }
  | { kind: "del"; oldNo: number | null; text: string }
  | { kind: "upd"; oldNo: number | null; newNo: number | null; before: SemLine; after: SemLine };

/**
 * Drop rows the kernel reports twice.
 *
 * A relocated block is emitted both as its own `move` run and, in the neighbouring `update` hunk,
 * as context — so `return {` and the three lines after it appeared twice in one view. Measured on
 * the TypeScript pair: 8 duplicated `oldNo -> newNo` pairs. The first occurrence wins, so the
 * move keeps its `⇅` marker and the plain repeat goes away.
 */
function dedupeRows(rows: Row[]): Row[] {
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const r of rows) {
    const oldNo = "oldNo" in r ? r.oldNo : undefined;
    const newNo = "newNo" in r ? r.newNo : undefined;
    if (oldNo == null && newNo == null) {
      out.push(r);
      continue;
    }
    // Only context and move rows are duplicated by the kernel. An `upd` row legitimately shares
    // its numbers with a move row (the same line, once as "moved" and once as "edited"), and
    // dropping it removed the word-level marks — the view went from 5 inline marks to 0.
    if (r.kind !== "ctx" && r.kind !== "move") {
      out.push(r);
      continue;
    }
    const key = `${oldNo ?? ""}->${newNo ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function toRows(lines: SemLine[]): Row[] {
  const out: Row[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.kind === "upd-del") {
      const next = lines[i + 1];
      if (next && next.kind === "upd-ins") {
        out.push({ kind: "upd", oldNo: l.oldNo, newNo: next.newNo, before: l, after: next });
        i += 1;
        continue;
      }
      out.push({ kind: "del", oldNo: l.oldNo, text: l.text });
      continue;
    }
    if (l.kind === "upd-ins") {
      out.push({ kind: "ins", newNo: l.newNo, text: l.text });
      continue;
    }
    if (l.kind === "move") out.push({ kind: "move", oldNo: l.oldNo, newNo: l.newNo, text: l.text });
    else if (l.kind === "ctx") out.push({ kind: "ctx", oldNo: l.oldNo, newNo: l.newNo, text: l.text });
    else if (l.kind === "ins") out.push({ kind: "ins", newNo: l.newNo, text: l.text });
    else out.push({ kind: "del", oldNo: l.oldNo, text: l.text });
  }
  return out;
}

function Marks({ segments, tone }: { segments: SemSegment[] | null; tone: "old" | "new" }): React.ReactElement {
  if (!segments || !segments.length) return <></>;
  return (
    <>
      {segments.map((s, i) => {
        if (s.op === "same") return <span key={i}>{s.text}</span>;
        return (
          <span
            key={i}
            className={cn(
              "rounded-[2px] px-[1px]",
              s.op === "del"
                ? "bg-del/30 text-slate-200 line-through decoration-del/70"
                : "bg-add/30 text-slate-200",
            )}
            data-tone={tone}
          >
            {s.text}
          </span>
        );
      })}
    </>
  );
}

export function SemanticDiffView({
  result,
  moveToLine,
  split,
  file = "",
}: {
  result: SemDiffResult | null;
  /** the file being shown, used to pick the language for colouring */
  file?: string;
  /** after-side line number → where the block went, for move badges */
  moveToLine?: Map<number, SemMove>;
  /** show old and new side by side instead of one column */
  /** Force one column (`false`) or two (`true`); unset lets the viewport decide. */
  split?: boolean;
}): React.ReactElement {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = React.useState<Record<number, boolean>>({});
  // clicking a count narrows the list to that kind of change; clicking it again shows all
  const [only, setOnly] = React.useState<"" | "update" | "move">("");
  // Where the reader is, for the ruler's viewport band.
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const splitScrollRef = React.useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = React.useState<[number, number] | null>(null);
  // follow the viewport instead of deciding once: a resize (or a phone rotating) must not
  // leave two panes squeezed into 390px
  const [wide, setWide] = React.useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 900px)").matches : false,
  );
  React.useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  // The prop forces the choice when a caller asks for it; otherwise the viewport decides. Passing
  // `false` must actually mean one column — before this, `split || wide` made it impossible to turn
  // the two-pane view off on a wide screen.
  const twoPane = split ?? wide;
  const toggle = (k: "update" | "move") => setOnly((cur) => (cur === k ? "" : k));
  // "移" keeps a hunk that carries a move even when the same hunk also carries an edit:
  // moving a block and rewording it lands in one hunk, and hiding it makes the filter lie.
  const shown = React.useMemo(() => {
    // The kernel reports a relocated block as its own `move` hunk and lists it first, so the
    // moved lines appeared above line 1 and the diff read out of order. Read it top to bottom.
    const at = (h: SemHunk) => h.beforeStart ?? h.afterStart ?? Number.MAX_SAFE_INTEGER;
    const rows = (result?.hunks ?? [])
      .map((h, i) => ({ h, i }))
      .sort((a, b) => at(a.h) - at(b.h));
    if (!only) return rows;
    if (only === "update") return rows.filter(({ h }) => h.operation === "update");
    const blocks = result?.moveBlocks ?? [];
    return rows.filter(({ h }) => {
      if (h.operation === "move") return true;
      const overlaps = (a: number | null, b: number | null, from: number, to: number) =>
        a !== null && b !== null && Math.max(a, from) <= Math.min(b, to);
      return blocks.some(
        (m) =>
          overlaps(h.beforeStart, h.beforeEnd, m.fromStart, m.fromEnd) ||
          overlaps(h.afterStart, h.afterEnd, m.toStart, m.toEnd),
      );
    });
  }, [result, only]);
  if (!result) return <div className="p-4 text-[12.5px] text-slate-500">{t("sem.empty")}</div>;
  if (twoPane) {
    // an early return keeps the single-column branch below exactly as it is
    const lines = dedupeRows(shown.flatMap(({ h }) => toRows(h.lines))).map((r) =>
        r.kind === "upd"
          ? ({ kind: "upd", oldNo: r.oldNo, newNo: r.newNo, before: r.before, after: r.after } as SplitLine)
          : r.kind === "ins"
            ? ({ kind: "ins", newNo: r.newNo, text: r.text } as SplitLine)
            : r.kind === "del"
              ? ({ kind: "del", oldNo: r.oldNo, text: r.text } as SplitLine)
              : r.kind === "move"
                ? ({ kind: "move", oldNo: r.oldNo, newNo: r.newNo, text: r.text } as SplitLine)
                : ({ kind: "ctx", oldNo: r.oldNo, newNo: r.newNo, text: r.text } as SplitLine),
      );
    return (
      <div className="flex min-h-0 max-h-[70vh]" data-testid="semantic-diff">
        <div
          ref={splitScrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            const span = el.scrollHeight - el.clientHeight;
            const start = span > 0 ? el.scrollTop / span : 0;
            const visible = el.scrollHeight > 0 ? el.clientHeight / el.scrollHeight : 1;
            setViewport([start, Math.min(1, start + visible)]);
          }}
          className="scroll-thin min-h-0 flex-1 overflow-auto"
        >
          <SemanticSplitView lines={lines} file={file} />
        </div>
        <DiffRuler
          marks={rulerMarksFrom(result.hunks, result.hunks.reduce((n, h) => n + h.lines.length, 0))}
          viewport={viewport}
          onJump={(f) => {
            const el = splitScrollRef.current;
            if (el) el.scrollTo({ top: (el.scrollHeight - el.clientHeight) * f, behavior: "smooth" });
          }}
        />
      </div>
    );
  }
  if (!result.hunks.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <div className="text-[15px] text-slate-300">{t("compare.same")}</div>
        <div className="text-[12px] text-slate-600">{t("compare.same.desc")}</div>
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0">
    <div
      ref={scrollRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        const span = el.scrollHeight - el.clientHeight;
        const start = span > 0 ? el.scrollTop / span : 0;
        const visible = el.scrollHeight > 0 ? el.clientHeight / el.scrollHeight : 1;
        setViewport([start, Math.min(1, start + visible)]);
      }}
      className="scroll-thin h-full flex-1 overflow-auto font-mono text-[12.5px] leading-[1.6]" data-testid="semantic-diff">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line bg-panel/95 px-3 py-1.5 text-[11.5px] backdrop-blur">
        <span className="rounded bg-add/15 px-1.5 py-0.5 text-add">+{result.added}</span>
        <span className="rounded bg-del/15 px-1.5 py-0.5 text-del">-{result.removed}</span>
        <button
          onClick={() => toggle("update")}
          aria-pressed={only === "update"}
          className={cn("rounded bg-mod/15 px-1.5 py-0.5 text-mod", only && only !== "update" && "opacity-40")}
        >
          {t("sem.updates", { count: result.updates })}
        </button>
        <button
          onClick={() => toggle("move")}
          aria-pressed={only === "move"}
          className={cn("rounded bg-move/15 px-1.5 py-0.5 text-move", only && only !== "move" && "opacity-40")}
        >
          {t("sem.moves", { count: result.moves })}
        </button>
        <span className="ml-auto text-slate-600">{t("sem.legend")}</span>
      </div>
      {shown.map(({ h: hunk, i: hi }) => {
        const rows = toRows(hunk.lines);
        // Colour the whole hunk at once so a docstring or block comment that spans lines keeps
        // its colour on every line instead of only the one that opened it.
        const rowTokens = highlightSided(
          rows.map((r) => ({
            text: r.kind === "upd" ? (r.after?.text ?? r.before?.text ?? "") : r.text,
            // a deleted row exists only in the old file, an inserted one only in the new
            side: r.kind === "del" ? ("old" as const) : r.kind === "ins" ? ("new" as const) : ("both" as const),
          })),
          file,
        );
        const isCollapsed = collapsed[hi];
        return (
          <div key={hi} className="border-b border-line/60">
            <button
              onClick={() => setCollapsed((c) => ({ ...c, [hi]: !c[hi] }))}
              className="flex w-full items-center gap-1.5 bg-panel-2/70 px-3 py-1 text-left text-[11.5px] text-slate-400 hover:text-slate-200"
            >
              {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              <span className="text-sky-300/80">{t(OP_KEY[hunk.operation] ?? "sem.hunk.update")}</span>
              <span className="text-slate-600">
                {t("sem.range", {
                  from: hunk.beforeStart ?? 0,
                  to: hunk.beforeEnd ?? 0,
                  nto: hunk.afterStart ?? 0,
                  ntoEnd: hunk.afterEnd ?? 0,
                })}
              </span>
              <span className="ml-auto text-slate-600">{t("sem.rows", { count: rows.length })}</span>
            </button>
            {!isCollapsed ? (
              <table className="w-full table-fixed border-collapse">
                <colgroup>
                  <col style={{ width: 44 }} />
                  <col style={{ width: 44 }} />
                  <col />
                </colgroup>
                <tbody>
                  {rows.map((row, ri) => {
                    if (row.kind === "ctx") {
                      return (
                        <tr key={ri}>
                          <td className="select-none border-r border-line/50 px-2 text-right text-[11px] text-slate-600">{row.oldNo ?? ""}</td>
                          <td className="select-none border-r border-line/50 px-2 text-right text-[11px] text-slate-600">{row.newNo ?? ""}</td>
                          <td className="whitespace-pre-wrap break-words px-3 py-[1px]"><CodeLine text={row.text} file={file} tone="text-slate-500" tokens={rowTokens[ri]} /></td>
                        </tr>
                      );
                    }
                    if (row.kind === "move") {
                      // Unchanged text that is no longer in its old place. Both sides show it;
                      // the gutter says `⇅` so a reader sees why the line numbers differ.
                      return (
                        <tr key={ri} className="bg-move/[0.07]">
                          <td className="select-none border-r border-line/50 px-2 text-right text-[11px] text-move/70">{row.oldNo ?? ""}</td>
                          <td className="select-none border-r border-line/50 px-2 text-right text-[11px] text-move/70">{row.newNo ?? ""}</td>
                          <td className="whitespace-pre-wrap break-words px-3 py-[1px]">
                            <span className="mr-1.5 select-none text-move">⇅</span>
                            <CodeLine text={row.text} file={file} tokens={rowTokens[ri]} />
                          </td>
                        </tr>
                      );
                    }
                    if (row.kind === "ins") {
                      const to = row.newNo != null ? moveToLine?.get(row.newNo) : undefined;
                      return (
                        <tr key={ri} className="bg-add/15">
                          <td className="select-none border-r border-line/50 px-2 text-right text-[11px] text-slate-600" />
                          <td className="select-none border-r border-line/50 px-2 text-right text-[11px] text-slate-600">{row.newNo ?? ""}</td>
                          <td className="whitespace-pre-wrap break-words px-3 py-[1px]">
                            <span className="mr-1.5 select-none text-add">+</span>
                            <CodeLine text={row.text} file={file} tone="text-slate-200" tokens={rowTokens[ri]} />
                            {to ? (
                              <span className="ml-2 inline-flex items-center gap-1 rounded bg-move/15 px-1 text-[10.5px] text-move">
                                <ArrowRightLeft className="h-2.5 w-2.5" />
                                {t("sem.movedFrom", { line: to.fromStart })}
                              </span>
                            ) : null}
                          </td>
                        </tr>
                      );
                    }
                    if (row.kind === "del") {
                      return (
                        <tr key={ri} className="bg-del/15">
                          <td className="select-none border-r border-line/50 px-2 text-right text-[11px] text-slate-600">{row.oldNo ?? ""}</td>
                          <td className="select-none border-r border-line/50 px-2 text-right text-[11px] text-slate-600" />
                          <td className="whitespace-pre-wrap break-words px-3 py-[1px]">
                            <span className="mr-1.5 select-none text-del">-</span>
                            <CodeLine text={row.text} file={file} tone="text-slate-400 line-through decoration-del/50" tokens={rowTokens[ri]} />
                          </td>
                        </tr>
                      );
                    }
                    // update: old and new stacked in one logical row
                    return (
                      <tr key={ri} className="align-top">
                        <td colSpan={3} className="p-0">
                          <table className="w-full table-fixed border-collapse">
                            <colgroup>
                              <col style={{ width: 44 }} />
                              <col style={{ width: 44 }} />
                              <col />
                            </colgroup>
                            <tbody>
                              <tr className="bg-del/15">
                                <td className="select-none border-r border-line/50 px-2 text-right text-[11px] text-slate-600">{row.oldNo ?? ""}</td>
                                <td className="select-none border-r border-line/50 px-2 text-right text-[11px] text-slate-600" />
                                <td className="whitespace-pre-wrap break-words px-3 py-[1px]">
                                  <span className="mr-1.5 select-none text-del">-</span>
                                  {/* Changed lines carry word-level marks, and those marks are
                                      what the reader is looking at. Colourising inside them would
                                      put a second meaning on the same characters — the green/red
                                      would compete with keyword blue — so changed rows stay
                                      uncoloured on purpose. */}
                                  <Marks segments={row.before.segments} tone="old" />
                                </td>
                              </tr>
                              <tr className="bg-add/15">
                                <td className="select-none border-r border-line/50 px-2 text-right text-[11px] text-slate-600" />
                                <td className="select-none border-r border-line/50 px-2 text-right text-[11px] text-slate-600">{row.newNo ?? ""}</td>
                                <td className="whitespace-pre-wrap break-words px-3 py-[1px]">
                                  <span className="mr-1.5 select-none text-add">+</span>
                                  <Marks segments={row.after.segments} tone="new" />
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : null}
          </div>
        );
      })}
      {result.moveBlocks.length ? (
        <div className="border-t border-line px-3 py-2">
          <div className="mb-1 text-[11.5px] text-slate-500">{t("sem.moveBlocks")}</div>
          {result.moveBlocks.map((m, i) => (
            <div key={i} className="flex items-center gap-2 text-[11.5px] text-move">
              <ArrowRightLeft className="h-3 w-3" />
              <span>
                {t("sem.moveLine", { from: m.fromStart, to: m.fromEnd, nto: m.toStart, ntoEnd: m.toEnd })}
              </span>
              <span className="truncate text-slate-500">{m.text.split("\n")[0]}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
    <DiffRuler
      marks={rulerMarksFrom(result.hunks, result.hunks.reduce((n, h) => n + h.lines.length, 0))}
      viewport={viewport}
      onJump={(f) => {
        const el = scrollRef.current;
        if (el) el.scrollTo({ top: (el.scrollHeight - el.clientHeight) * f, behavior: "smooth" });
      }}
    />
    </div>
  );
}