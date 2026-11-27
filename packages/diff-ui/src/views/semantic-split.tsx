import * as React from "react";
import { useI18n } from "@diffs/i18n";
import { cn } from "../lib/cn";
import { CodeLine } from "./code-line";

/**
 * Two panes, old on the left and new on the right, each with its own line numbers.
 *
 * This is the shape a reviewer is used to from a terminal diff: the whole line is tinted,
 * not just the words that changed, and both sides keep their own numbering so a reader can
 * see where a line used to be. It is a second way to look at the same hunks the single-pane
 * view shows — not a replacement, since on a narrow screen one column is all that fits.
 */

export interface SplitLine {
  /** `move`: unchanged text carried by a relocation — shown on both sides, gutter-marked. */
  kind: "ctx" | "ins" | "del" | "upd" | "move";
  oldNo?: number | null;
  newNo?: number | null;
  text?: string;
  before?: { text: string; segments?: Array<{ op: "same" | "ins" | "del"; text: string }> };
  after?: { text: string; segments?: Array<{ op: "same" | "ins" | "del"; text: string }> };
}

function renderSegs(segs?: Array<{ op: "same" | "ins" | "del"; text: string }>, want?: "ins" | "del") {
  if (!segs) return null;
  return segs.map((s, i) =>
    s.op === want ? (
      // `data-tone` marks the changed runs; the single-column view and the tests both look for it,
      // and this view was painting them without it.
      <span
        key={i}
        data-tone={want === "ins" ? "new" : "old"}
        className={
          want === "ins"
            ? "rounded-[2px] bg-add/30 px-[1px] text-slate-200"
            : "rounded-[2px] bg-del/30 px-[1px] text-slate-200 line-through decoration-del/70"
        }
      >
        {s.text}
      </span>
    ) : s.op === "same" ? (
      <span key={i}>{s.text}</span>
    ) : null,
  );
}

export function SemanticSplitView({ lines, file = "" }: { lines: SplitLine[]; file?: string }): React.ReactElement {
  const { t } = useI18n();
  return (
    <div className="font-mono text-[12.5px] leading-[1.55]" data-testid="semantic-split">
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          <col style={{ width: 44 }} />
          <col style={{ width: "calc(50% - 58px)" }} />
          <col style={{ width: 8 }} />
          <col style={{ width: 44 }} />
          {/* Both text columns are half the width. Left as an unsized <col /> the browser sized
              the right one to its content, so the two panes were lopsided and the code sat in a
              narrow strip beside a large empty area. */}
          <col style={{ width: "calc(50% - 58px)" }} />
        </colgroup>
        <thead>
          <tr>
            <th colSpan={2} className="sticky top-0 z-10 border-b border-line bg-panel px-3 py-1 text-left text-[11px] font-normal text-slate-500">
              {t("ast.before")}
            </th>
            <th className="sticky top-0 z-10 border-b border-line bg-panel" />
            <th colSpan={2} className="sticky top-0 z-10 border-b border-line bg-panel px-3 py-1 text-left text-[11px] font-normal text-slate-500">
              {t("ast.after")}
            </th>
          </tr>
        </thead>
        <tbody>
              {lines.map((l, i) => {
                const isCtx = l.kind === "ctx";
                const isMove = l.kind === "move";
                // An edit shows on both sides; an addition only on the right; a removal only on
                // the left; a moved row on both, because its text is unchanged on both. A row
                // shown on one side leaves the other blank on purpose -- it appeared or went.
                const leftShown = isCtx || isMove || l.kind === "del" || l.kind === "upd";
                const rightShown = isCtx || isMove || l.kind === "ins" || l.kind === "upd";
                const tint = isCtx
                  ? ""
                  : isMove
                    ? "bg-move/[0.07]"
                    : l.kind === "ins"
                      ? "bg-add/15"
                      : l.kind === "del"
                        ? "bg-del/15"
                        : "bg-mod/10";
                const marker = isCtx ? " " : isMove ? "⇅" : l.kind === "ins" ? "+" : l.kind === "del" ? "-" : "~";
                return (
                  <tr key={i} className={tint}>
                    <td className="select-none border-r border-line/40 px-2 text-right text-[11px] text-slate-600">
                      {leftShown ? (l.oldNo ?? "") : ""}
                    </td>
                    <td className="whitespace-pre-wrap break-words border-r border-line/60 px-3 py-px">
                      {leftShown ? (
                        <>
                          <span className="mr-1.5 select-none text-slate-600">{marker}</span>
                          {l.before?.segments ? renderSegs(l.before.segments, "del") : (
                            <CodeLine text={l.before?.text ?? l.text ?? ""} file={file} />
                          )}
                        </>
                      ) : null}
                    </td>
                    <td className={cn(
                      "p-0",
                      isCtx
                        ? ""
                        : isMove
                          ? "bg-move/70"
                          : l.kind === "ins"
                            ? "bg-emerald-500/70"
                            : l.kind === "del"
                              ? "bg-red-500/70"
                              : "bg-amber-500/70",
                    )} />
                    <td className="select-none border-r border-line/40 px-2 text-right text-[11px] text-slate-600">
                      {rightShown ? (l.newNo ?? "") : ""}
                    </td>
                    <td className="whitespace-pre-wrap break-words px-3 py-px">
                      {rightShown ? (
                        <>
                          <span className="mr-1.5 select-none text-slate-600">{marker}</span>
                          {l.after?.segments ? renderSegs(l.after.segments, "ins") : (
                            <span className="text-slate-300">{l.after?.text ?? l.text}</span>
                          )}
                        </>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
        </tbody>
      </table>
    </div>
  );
}
