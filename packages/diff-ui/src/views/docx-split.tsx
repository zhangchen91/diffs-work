import * as React from "react";
import { useI18n } from "@diffs/i18n";
import { cn } from "../lib/cn";

/**
 * Word, two panes: the old document and the new one, each in its own reading order.
 *
 * A paragraph diff reads differently from a code diff — you want to see the clause as it
 * was and as it is, side by side — so the same side-by-side idea is applied to paragraphs.
 */
export function DocxSplitView({
  before,
  after,
  changes,
  sideBySide = true,
}: {
  sideBySide?: boolean;
  before: string[];
  after: string[];
  changes: Array<{
    kind: string;
    old?: string;
    new?: string;
    oldIndex?: number;
    newIndex?: number;
    segments?: Array<{ op: "same" | "ins" | "del"; text: string }>;
  }>;
}): React.ReactElement {
  const { t } = useI18n();
  const deleted = React.useMemo(() => {
    const m = new Map<number, Array<{ text: string; segments?: Array<{ op: string; text: string }> }>>();
    for (const c of changes) {
      if (c.kind !== "delete" || typeof c.oldIndex !== "number") continue;
      m.set(c.oldIndex, [...(m.get(c.oldIndex) ?? []), { text: c.old ?? "", segments: c.segments }]);
    }
    return m;
  }, [changes]);
  const inserted = React.useMemo(() => {
    const m = new Map<number, { kind: string; segments?: Array<{ op: string; text: string }> }>();
    for (const c of changes) {
      if (typeof c.newIndex !== "number") continue;
      m.set(c.newIndex, { kind: c.kind, segments: c.segments });
    }
    return m;
  }, [changes]);

  // Only the words that changed get tinted; the rest of the paragraph stays plain, so a
  // revised amount reads as the digits that moved rather than a whole red paragraph.
  const segs = (list?: Array<{ op: string; text: string }>, want?: "ins" | "del") =>
    list?.map((s, i) =>
      want && s.op === want ? (
        <span key={i} className={want === "ins" ? "bg-emerald-500/30" : "bg-red-500/30 line-through decoration-red-500/50"}>{s.text}</span>
      ) : s.op === "same" ? (
        <span key={i}>{s.text}</span>
      ) : null,
    );

  const rows = Math.max(before.length, after.length);
  // a reader should not have to guess what the purple means
  const counts = React.useMemo(() => {
    const c: Record<string, number> = { delete: 0, insert: 0, move: 0 };
    for (const x of changes) if (x.kind in c) c[x.kind]++;
    return c;
  }, [changes]);

  return (
    <div className="scroll-thin flex h-full min-h-0 flex-1 flex-col overflow-y-auto bg-white" data-testid="docx-split">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-6 py-1.5 text-[11.5px] text-slate-500">
        <span className="rounded bg-emerald-500/[0.16] px-1.5 py-0.5 text-emerald-800">新增 {counts.insert}</span>
        <span className="rounded bg-red-500/[0.14] px-1.5 py-0.5 text-red-800">删除 {counts.delete}</span>
        <span className="rounded bg-violet-500/[0.16] px-1.5 py-0.5 text-violet-800">移动 {counts.move}</span>
        <span className="ml-auto">改动处只标变化的字，其余保持不变</span>
      </div>
      {/* One column on a phone: two 150px columns of contract text are unreadable. The
          before/after labels make it clear which is which when they stack. */}
      <div
        className={cn("mx-auto grid w-full max-w-[1100px] grid-cols-1 items-start gap-6 p-4 text-[13.5px] leading-relaxed sm:p-6", sideBySide && "md:grid-cols-2")}
        style={{ color: "#1f2328" }}
      >
        <div>
          <div className="mb-2 border-b border-slate-200 pb-1 text-[11px] text-slate-500">{t("ast.before")}</div>
          {before.map((p, i) => {
            // A deleted line is struck through only when the whole paragraph went. When the
            // kernel paired it with a replacement, the strike belongs on the words that went,
            // not across the entire line.
            const gone = deleted.get(i);
            const wholeGone = !!gone && gone.every((d) => !d.segments);
            return (
            <div
              key={i}
              className={cn("mb-1 rounded px-1", gone && "bg-red-500/[0.10]", wholeGone && "line-through decoration-red-400/60")}
            >
              {(() => {
                const hit = deleted.get(i);
                if (!hit) return p;
                return hit.map((d, k) => (d.segments ? <span key={k}>{segs(d.segments, "del")}</span> : <span key={k}>{d.text}</span>));
              })()}
            </div>
            );
          })}
        </div>
        <div>
          <div className="mb-2 border-b border-slate-200 pb-1 text-[11px] text-slate-500">{t("ast.after")}</div>
          {after.map((p, i) => {
            const hit = inserted.get(i);
            const kind = hit?.kind;
            return (
              <div
                key={i}
                className={cn(
                  "mb-1 rounded px-1",
                  kind === "insert" && "bg-emerald-500/[0.14] text-emerald-800",
                  kind === "move" && "bg-violet-500/[0.14] text-violet-800",
                )}
              >
                {hit?.segments ? segs(hit.segments, "ins") : p}
              </div>
            );
          })}
        </div>
      </div>
      <div className="sr-only">{rows}</div>
    </div>
  );
}
