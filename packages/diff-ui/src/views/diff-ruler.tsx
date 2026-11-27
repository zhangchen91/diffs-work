import * as React from "react";
import { cn } from "../lib/cn";

/**
 * A thin ruler down the side of a long diff showing *where* the changes are.
 *
 * A fifty-hundred-line comparison is unreadable by scrolling: the reader cannot tell whether the
 * one thing they care about is above or below. This is not a preview of the code — it is an index
 * of the changes, one mark per row, coloured by what happened there, with the rows actually on
 * screen shown as a lighter band.
 *
 * It stays out of the way: 10px wide, no labels, and click-to-jump.
 */
export interface RulerMark {
  /** 0..1 position along the document. */
  at: number;
  kind: "add" | "del" | "mod" | "move";
}

const TONE: Record<RulerMark["kind"], string> = {
  add: "bg-add/80",
  del: "bg-del/80",
  mod: "bg-mod/80",
  move: "bg-move/80",
};

export function DiffRuler({
  marks,
  viewport,
  onJump,
  className,
}: {
  marks: RulerMark[];
  /** The visible fraction, as [start, end] in 0..1. */
  viewport?: [number, number] | null;
  onJump?: (fraction: number) => void;
  className?: string;
}): React.ReactElement | null {
  if (!marks.length) return null;
  return (
    <div
      className={cn("relative w-2.5 shrink-0 select-none bg-panel-2/40", className)}
      data-testid="diff-ruler"
      title={`${marks.length} change${marks.length === 1 ? "" : "s"}`}
      onClick={(e) => {
        if (!onJump) return;
        const box = e.currentTarget.getBoundingClientRect();
        onJump(Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)));
      }}
    >
      {viewport ? (
        <div
          className="pointer-events-none absolute inset-x-0 border-y border-line/60 bg-white/[0.04]"
          style={{ top: `${viewport[0] * 100}%`, height: `${Math.max(2, (viewport[1] - viewport[0]) * 100)}%` }}
        />
      ) : null}
      {marks.map((m, i) => (
        <div
          key={i}
          className={cn("absolute inset-x-px h-[2px] rounded-full", TONE[m.kind])}
          style={{ top: `${m.at * 100}%` }}
        />
      ))}
    </div>
  );
}

/** Turn a result's hunks into ruler marks, in one pass. */
export function rulerMarksFrom(
  hunks: Array<{ operation: string; lines: Array<{ kind: string }> }>,
  totalRows: number,
): RulerMark[] {
  if (totalRows <= 0) return [];
  const out: RulerMark[] = [];
  let row = 0;
  for (const h of hunks) {
    for (const l of h.lines) {
      row += 1;
      // Both vocabularies reach here: the semantic view says `ins` / `del` / `upd-*`, the line
      // view says `insert` / `delete` / `equal`. A ruler that only understood one of them drew
      // nothing for the other.
      const kind =
        l.kind === "ins" || l.kind === "upd-ins" || l.kind === "insert"
          ? "add"
          : l.kind === "del" || l.kind === "upd-del" || l.kind === "delete" || l.kind === "style"
            ? "del"
            : l.kind === "move"
              ? "move"
              : null;
      if (kind) out.push({ at: Math.min(1, row / totalRows), kind });
    }
    // A change that only edits a value shows both halves; the `mod` tone keeps them distinct.
    if (h.operation === "update") {
      const last = out[out.length - 1];
      if (last && last.kind === "del") out[out.length - 1] = { ...last, kind: "mod" };
    }
  }
  return out;
}