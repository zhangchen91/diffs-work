import * as React from "react";
import { ArrowLeftRight, CornerDownRight } from "lucide-react";
import { cn } from "../lib/cn";
import { useI18n } from "@diffs/i18n";

/**
 * AST-level diff view (structure nodes with line AND column ranges).
 *
 * This is the view that shows what a row diff cannot: a change inside a line.
 * Each side lists its hunks; a hunk whose range fits on one line is painted only
 * over the touched columns, the rest of the line stays as it reads in the file.
 *
 * Column numbers are character offsets, consistent between the kernel (Rust char
 * indices) and this renderer (JS string indices), so CJK text slices correctly.
 */
export interface AstRange {
  start_row: number;
  start_column: number;
  end_row: number;
  end_column: number;
}

export interface AstHunk {
  operation: "insert" | "delete" | "update" | "move";
  range: AstRange;
  text: string;
  reference_line: number | null;
  move_target: AstRange | null;
}

export interface AstDiffResult {
  engine: string;
  language: string;
  summary: string;
  before: { hunks: AstHunk[] };
  after: { hunks: AstHunk[] };
  updates: number;
  moves: number;
  inserts: number;
  deletes: number;
  largeResidual?: boolean;
}

const OP_STYLE: Record<string, { glyph: string; cls: string; hit: string }> = {
  insert: { glyph: "+", cls: "text-add", hit: "bg-add/25 ring-1 ring-add/40" },
  delete: { glyph: "-", cls: "text-del", hit: "bg-del/25 ring-1 ring-del/40" },
  update: { glyph: "~", cls: "text-mod", hit: "bg-mod/25 ring-1 ring-mod/40" },
  move: { glyph: ">", cls: "text-move", hit: "bg-move/25 ring-1 ring-move/40" },
};

function splitLines(text: string): string[] {
  const t = text.replace(/\r\n?/g, "\n");
  const lines = t.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Hunks covering a row, in painting order (later ones win). */
function byRow(hunks: AstHunk[]): Map<number, AstHunk[]> {
  const m = new Map<number, AstHunk[]>();
  for (const h of hunks) {
    for (let r = h.range.start_row; r <= h.range.end_row; r++) {
      const list = m.get(r) ?? [];
      list.push(h);
      m.set(r, list);
    }
  }
  return m;
}

function Pane({
  title,
  text,
  hunks,
  side,
}: {
  title: string;
  text: string;
  hunks: AstHunk[];
  side: "before" | "after";
}): React.ReactElement {
  const lines = React.useMemo(() => splitLines(text), [text]);
  const marks = React.useMemo(() => byRow(hunks), [hunks]);
  const changedRows = React.useMemo(() => new Set(marks.keys()), [marks]);
  const context = 2;

  // rows to draw: changed ones plus context; collapse the rest
  const visible = React.useMemo(() => {
    if (lines.length <= 200) return lines.map((_, i) => i);
    const keep = new Set<number>();
    for (const r of changedRows) {
      for (let k = Math.max(0, r - context); k <= Math.min(lines.length - 1, r + context); k++) keep.add(k);
    }
    return [...keep].sort((a, b) => a - b);
  }, [lines, changedRows]);

  return (
    <div className="min-w-0 flex-1 overflow-hidden">
      <div className="border-b border-line bg-panel-2/60 px-3 py-1 text-[11.5px] text-slate-500">{title}</div>
      <div className="scroll-thin h-full overflow-auto font-mono text-[12px] leading-[1.6]">
        {visible.map((row, i) => {
          const prev = i > 0 ? visible[i - 1] : -1;
          const gap = row - prev > 1;
          const hs = marks.get(row) ?? [];
          const line = lines[row] ?? "";
          return (
            <React.Fragment key={row}>
              {gap ? (
                <div className="px-3 py-0.5 text-[11px] text-slate-600">⋯ {row - prev - 1} 行</div>
              ) : null}
              <div className="flex">
                <span className="w-10 shrink-0 select-none border-r border-line/40 px-1 text-right text-[11px] text-slate-600">
                  {row + 1}
                </span>
                <span className="w-3 shrink-0 select-none text-center text-[11px]">
                  {hs.length ? (
                    <span className={OP_STYLE[hs[0].operation]?.cls}>{OP_STYLE[hs[0].operation]?.glyph}</span>
                  ) : null}
                </span>
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words pr-3">
                  {hs.length === 0 ? (
                    <span className="text-slate-500">{line || " "}</span>
                  ) : (
                    <MarkedLine
                      line={line}
                      hunks={hs.filter((h) => h.range.start_row === h.range.end_row)}
                      wholeRow={hs.some((h) => h.range.start_row !== h.range.end_row)}
                    />
                  )}
                </span>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

/** Paint only the touched columns of one line. */
function MarkedLine({
  line,
  hunks,
  wholeRow,
}: {
  line: string;
  hunks: AstHunk[];
  wholeRow: boolean;
}): React.ReactElement {
  if (wholeRow || hunks.length === 0) {
    return <span className="rounded-[2px] bg-mod/20 px-0.5">{line || " "}</span>;
  }
  // merge overlapping spans, then slice the line into plain / marked pieces
  const spans = hunks
    .map((h) => ({ from: Math.max(0, h.range.start_column), to: Math.min(line.length, h.range.end_column), op: h.operation }))
    .filter((s) => s.to > s.from)
    .sort((a, b) => a.from - b.from);
  if (!spans.length) return <span className="text-slate-500">{line || " "}</span>;
  const merged: Array<{ from: number; to: number; op: string }> = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.from <= last.to) last.to = Math.max(last.to, s.to);
    else merged.push({ ...s });
  }
  const out: React.ReactNode[] = [];
  let cursor = 0;
  merged.forEach((s, i) => {
    if (s.from > cursor) out.push(<span key={`p${i}`} className="text-slate-500">{line.slice(cursor, s.from)}</span>);
    out.push(
      <span key={`m${i}`} className={cn("rounded-[2px]", OP_STYLE[s.op]?.hit ?? "bg-mod/25")} data-ast-hit={s.op}>
        {line.slice(s.from, s.to)}
      </span>,
    );
    cursor = s.to;
  });
  if (cursor < line.length) out.push(<span key="tail" className="text-slate-500">{line.slice(cursor)}</span>);
  return <>{out}</>;
}

/** Narrow a hunk list to one kind of change, or keep all of them. */
function filterHunks(hunks: AstHunk[], only: string): AstHunk[] {
  return only ? hunks.filter((h) => h.operation === only) : hunks;
}

export function AstDiffView({
  result,
  beforeText,
  afterText,
}: {
  result: AstDiffResult;
  beforeText: string;
  afterText: string;
}): React.ReactElement {
  const { t } = useI18n();
  const [side, setSide] = React.useState<"both" | "after">("both");
  // clicking a count narrows the list to that kind of change; clicking it again shows all
  const [only, setOnly] = React.useState<"" | "update" | "move" | "insert" | "delete">("");
  const moves = result.after.hunks.filter((h) => h.operation === "move" && h.move_target);
  const toggle = (k: "update" | "move" | "insert" | "delete") => setOnly((cur) => (cur === k ? "" : k));
  const chip = (k: "update" | "move" | "insert" | "delete", label: string, n: number, cls: string) => (
    <button
      onClick={() => toggle(k)}
      aria-pressed={only === k}
      className={cn("rounded px-1.5 py-0.5 transition-opacity", cls, only && only !== k && "opacity-40")}
    >
      {label} {n}
    </button>
  );
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="ast-diff">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-1.5 text-[11.5px]">
        {chip("update", "改", result.updates, "bg-mod/15 text-mod")}
        {chip("move", "移", result.moves, "bg-move/15 text-move")}
        {chip("insert", "增", result.inserts, "bg-add/15 text-add")}
        {chip("delete", "删", result.deletes, "bg-del/15 text-del")}
        <span className="text-slate-600">{result.language}</span>
        <span className="ml-auto flex items-center gap-1 rounded border border-line p-0.5">
          {(["both", "after"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setSide(m)}
              className={cn(
                "rounded px-2 py-0.5",
                side === m ? "bg-white/[0.08] text-slate-200" : "text-slate-500 hover:text-slate-300",
              )}
            >
              {m === "both" ? t("ast.side.both") : t("ast.side.after")}
            </button>
          ))}
        </span>
      </div>
      <div className="flex min-h-0 flex-1">
        {side === "both" ? (
          <Pane title={t("ast.before")} text={beforeText} hunks={filterHunks(result.before.hunks, only)} side="before" />
        ) : null}
        <Pane title={t("ast.after")} text={afterText} hunks={filterHunks(result.after.hunks, only)} side="after" />
      </div>
      {moves.length ? (
        <div className="max-h-24 overflow-auto border-t border-line px-3 py-1.5 text-[11.5px]">
          {moves.slice(0, 8).map((m, i) => (
            <div key={i} className="flex items-center gap-1.5 text-move">
              <ArrowLeftRight className="h-3 w-3 shrink-0" />
              <span>
                {t("ast.moved", {
                  from: (m.move_target?.start_row ?? 0) + 1,
                  to: m.range.start_row + 1,
                })}
              </span>
              <CornerDownRight className="h-3 w-3 shrink-0 opacity-60" />
              <span className="truncate text-slate-500">{m.text}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}