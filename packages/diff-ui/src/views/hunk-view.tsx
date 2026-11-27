import * as React from "react";
import { cn } from "../lib/cn";
import { CodeLine } from "./code-line";
import { highlightSided } from "../lib/highlight";
import type { TextDiffResult } from "@diffs/core-text";
import { useI18n } from "@diffs/i18n";
import { DiffRuler, rulerMarksFrom } from "./diff-ruler";

/** Rich row produced by the markdown/AST engines (inline marks + move tags). */
export interface RichLine {
  kind: "equal" | "insert" | "delete" | "move" | "style";
  oldLine: number | null;
  newLine: number | null;
  text: string;
  inline?: Array<{ op: "equal" | "insert" | "delete"; text: string; mark?: string }>;
}

export interface RichHunk {
  header: string;
  lines: RichLine[];
}

export function RichHunkView({ hunks, doc, file = "" }: { hunks: RichHunk[]; doc?: "md" | "code"; file?: string }): React.ReactElement {
  const { t } = useI18n();
  // Ruler + keyboard navigation, the same two affordances the block view has: `n` / `p` step
  // through the changes, so a long comparison can be read without scrolling by hand.
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = React.useState<[number, number] | null>(null);
  const rows = React.useMemo(
    () => hunks.flatMap((h) => h.lines.map((l) => l.kind)),
    [hunks],
  );
  const jump = (fraction: number) => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: (el.scrollHeight - el.clientHeight) * fraction, behavior: "smooth" });
  };
  // Mark the rows that carry a change so `n` / `p` can stop on them.
  const changeTops = React.useMemo(() => {
    const el = scrollRef.current;
    if (!el) return [] as number[];
    return Array.from(el.querySelectorAll<HTMLElement>("tr[data-change]")).map((tr) => tr.offsetTop);
  }, [hunks]);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "n" && e.key !== "p") return;
      const el = scrollRef.current;
      if (!el) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      // Measure in the container's own coordinate space: `offsetTop` is relative to the nearest
      // positioned ancestor, which is the table, so every row reports the same small number.
      const top = el.getBoundingClientRect().top;
      const stops = Array.from(el.querySelectorAll<HTMLElement>("tr[data-change]"))
        .map((tr) => tr.getBoundingClientRect().top - top + el.scrollTop)
        .sort((a, b) => a - b);
      if (!stops.length) return;
      const here = el.scrollTop;
      // The row we jumped to sits at `here + 24` after scrolling; compare against that, not
      // against the raw scroll position, or the same stop is chosen forever.
      const anchor = here + 24;
      const next =
        e.key === "n"
          ? stops.find((y) => y > anchor + 8) ?? stops[stops.length - 1]
          : [...stops].reverse().find((y) => y < anchor - 8) ?? stops[0];
      el.scrollTo({ top: Math.max(0, next - 24), behavior: "auto" });
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hunks]);
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const span = el.scrollHeight - el.clientHeight;
    const start = span > 0 ? el.scrollTop / span : 0;
    const visible = el.scrollHeight > 0 ? el.clientHeight / el.scrollHeight : 1;
    setViewport([start, Math.min(1, start + visible)]);
  };
  if (!hunks.length)
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-2 text-center text-slate-400"
        data-testid="diffs"
      >
        <div className="text-[15px] text-slate-300">{t("compare.same")}</div>
        <div className="text-[12px] text-slate-600">{t("compare.same.desc")}</div>
      </div>
    );
  return (
    <div className="flex min-h-0 max-h-[70vh]">
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="scroll-thin min-h-0 flex-1 overflow-auto font-mono text-[12.5px] leading-[1.6]"
      data-testid="diffs"
    >
      {hunks.map((h, i) => {
        // colour the hunk as one run, with each row tagged by the file it came from, so a
        // docstring or comment spanning lines keeps its colour and a deleted opener does not
        // tint the context below it
        const lineTokens = highlightSided(
          h.lines.map((l) => ({
            text: l.text,
            side: l.kind === "delete" ? ("old" as const) : l.kind === "insert" ? ("new" as const) : ("both" as const),
          })),
          file,
        );
        return (
        <div key={i} className="border-b border-line/60">
          <div className="sticky left-0 bg-panel-2/80 px-3 py-1 text-[11.5px] text-sky-300/80">{h.header}</div>
          <table className="w-full table-fixed border-collapse">
            <colgroup>
              <col style={{ width: 44 }} />
              <col style={{ width: 44 }} />
              <col />
            </colgroup>
            <tbody>
              {h.lines.map((l, k) => (
                <tr
                  key={k}
                  data-change={l.kind === "equal" ? undefined : ""}
                  className={
                    l.kind === "insert"
                      ? "bg-emerald-500/[0.09]"
                      : l.kind === "delete"
                        ? "bg-red-500/[0.09]"
                        : l.kind === "move"
                          ? "bg-violet-500/[0.08]"
                          : undefined
                  }
                >
                  <td className="select-none border-r border-line/50 px-2 text-right text-[11px] text-slate-600">{l.oldLine ?? ""}</td>
                  <td className="select-none border-r border-line/50 px-2 text-right text-[11px] text-slate-600">{l.newLine ?? ""}</td>
                  <td className="whitespace-pre-wrap break-words px-3 py-[1px]">
                    <span className="mr-1.5 select-none text-slate-600">
                      {l.kind === "insert" ? "+" : l.kind === "delete" ? "-" : l.kind === "move" ? "~" : " "}
                    </span>
                    {l.inline ? (
                      l.inline.map((seg, j) => (
                        <span
                          key={j}
                          className={
                            seg.op === "insert"
                              ? "rounded-[2px] bg-emerald-500/25 text-emerald-100"
                              : seg.op === "delete"
                                ? "rounded-[2px] bg-red-500/25 text-red-100 line-through"
                                : seg.mark === "strong"
                                  ? "font-semibold text-slate-200"
                                  : undefined
                          }
                        >
                          {seg.text}
                        </span>
                      ))
                    ) : (
                      <CodeLine
                        text={l.text}
                        file={file}
                        tokens={lineTokens[k]}
                        tone={l.kind === "delete" ? "text-red-200/80" : l.kind === "insert" ? "text-emerald-200/90" : undefined}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        );
      })}
    </div>
    <DiffRuler
      marks={rulerMarksFrom(
        hunks.map((h) => ({ operation: "update", lines: h.lines.map((l) => ({ kind: l.kind })) })),
        rows.length,
      )}
      viewport={viewport}
      onJump={jump}
    />
    </div>
  );
}


export interface InlineSeg {
  op: "equal" | "insert" | "delete";
  text: string;
}

/** Side-by-side / unified rendering of hunks. Pure presentation, no engine calls. */
export function HunkView({
  result,
  mode = "unified",
  maxLines = 400,
}: {
  result: TextDiffResult | null;
  mode?: "unified" | "split";
  maxLines?: number;
}): React.ReactElement {
  const { t } = useI18n();
  if (!result) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-[13px] text-slate-500">
        {t("compare.pickTwo")}
      </div>
    );
  }
  if (!result.hunks.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <div className="text-[15px] font-medium text-slate-300">{t("compare.same")} ✨</div>
      </div>
    );
  }

  let budget = maxLines;
  return (
    <div className="scroll-thin h-full overflow-auto font-mono text-[12.5px] leading-[1.55]">
      {result.hunks.map((h, hi) => {
        const rows = budget > 0 ? h.lines : [];
        budget -= h.lines.length;
        return (
          <div key={hi} className="border-b border-line/60">
            <div className="sticky left-0 bg-panel-2/80 px-3 py-1 text-[11.5px] text-sky-300/80 select-none">
              {h.header}
            </div>
            <table className="w-full table-fixed border-collapse">
              <colgroup>
                <col style={{ width: 48 }} />
                <col style={{ width: 48 }} />
                <col />
              </colgroup>
              <tbody>
                {rows.map((l, li) => {
                  const inline =
                    l.kind === "equal" ? null : result.inline[`${l.oldLine}:${l.newLine}`];
                  return (
                    <tr
                      key={li}
                      className={cn(
                        l.kind === "insert" && "bg-emerald-500/[0.09]",
                        l.kind === "delete" && "bg-red-500/[0.09]",
                      )}
                    >
                      <td className="select-none border-r border-line/50 px-2 text-right text-[11px] text-slate-600">
                        {l.oldLine ?? ""}
                      </td>
                      <td className="select-none border-r border-line/50 px-2 text-right text-[11px] text-slate-600">
                        {l.newLine ?? ""}
                      </td>
                      <td className="whitespace-pre-wrap break-words px-3 py-[1px]">
                        <span
                          className={cn(
                            "mr-1.5 select-none",
                            l.kind === "insert" && "text-emerald-400",
                            l.kind === "delete" && "text-red-400",
                            l.kind === "equal" && "text-slate-700",
                          )}
                        >
                          {l.kind === "insert" ? "+" : l.kind === "delete" ? "−" : " "}
                        </span>
                        <InlineText text={l.kind === "equal" ? l.text : inline ? "" : l.text} inline={inline} kind={l.kind} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
      {budget <= 0 ? (
        <div className="px-3 py-3 text-center text-[12px] text-slate-500">
          {t("compare.truncated", { count: maxLines })}
        </div>
      ) : null}
    </div>
  );
}

function InlineText({
  text,
  inline,
  kind,
}: {
  text: string;
  inline: InlineSeg[] | null;
  kind: "equal" | "insert" | "delete";
}): React.ReactElement {
  if (!inline || kind === "equal") {
    return (
      <span className={cn(kind === "delete" && "text-red-200/90", kind === "insert" && "text-emerald-200/90")}>
        {text}
      </span>
    );
  }
  return (
    <>
      {inline.map((seg, i) => {
        const hit = (kind === "delete" && seg.op === "delete") || (kind === "insert" && seg.op === "insert");
        return (
          <span
            key={i}
            className={cn(
              hit && kind === "delete" && "rounded-[2px] bg-red-500/30 text-red-100",
              hit && kind === "insert" && "rounded-[2px] bg-emerald-500/30 text-emerald-100",
              !hit && kind === "delete" && "text-red-200/70",
              !hit && kind === "insert" && "text-emerald-200/70",
            )}
          >
            {seg.text}
          </span>
        );
      })}
    </>
  );
}