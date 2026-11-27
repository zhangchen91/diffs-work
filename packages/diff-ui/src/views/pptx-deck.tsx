import * as React from "react";
import { ChevronLeft, ChevronRight, Presentation } from "lucide-react";
import { useI18n } from "@diffs/i18n";
import { cn } from "../lib/cn";
import { REGION_TONE_TEXT, MARK_TONE } from "../lib/revision-tone";
import { Badge } from "../lib/primitives";

/**
 * A deck diff, one card per slide.
 *
 * The revision list gave a flat table of paragraphs, which is not what a deck looks like:
 * a reviewer reads slide by slide. Grouping by the slide part and rendering each slide as
 * a page keeps the review in the shape of the document being reviewed.
 */
interface Rev {
  part?: string;
  kind: string;
  old?: string;
  new?: string;
}

const OP_CLASS: Record<string, string> = {
  insert: REGION_TONE_TEXT.insert,
  delete: REGION_TONE_TEXT.delete,
  move: REGION_TONE_TEXT.move,
  change: "bg-amber-500/[0.16] text-amber-800",
};

const slideOf = (part?: string): number => {
  const m = /slide(\d+)\.xml$/.exec(part ?? "");
  return m ? Number(m[1]) : 0;
};

export function PptxDeckView({
  revisions = [],
  slides = 0,
  containers = [],
  sideBySide = true,
}: {
  sideBySide?: boolean;
  revisions?: Rev[];
  slides?: number;
  containers?: Array<{ name: string; paragraphs: string[]; oldParagraphs: string[] }>;
}): React.ReactElement {
  const { t } = useI18n();

  // one card per slide, in deck order, including the slides nothing changed on: a reader
  // looking at "slide 3 of 3" needs to see where it sits in the deck
  const deck = React.useMemo(() => {
    if (containers.length) {
      return containers
        .map((c) => ({ slide: slideOf(c.name), ...c }))
        .sort((a, b) => a.slide - b.slide);
    }
    const m = new Map<number, Rev[]>();
    for (const r of revisions) {
      const n = slideOf(r.part);
      m.set(n, [...(m.get(n) ?? []), r]);
    }
    return [...m.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([slide, list]) => ({
        slide,
        name: `slide${slide}.xml`,
        paragraphs: list.map((r) => r.new ?? r.old ?? ""),
        oldParagraphs: [],
      }));
  }, [containers, revisions]);

  // text → how it changed. A delete and an insert the kernel paired are one edit, so the new
  // text is tinted as an edit (amber) rather than as an unrelated addition (green).
  const segsByText = React.useMemo(() => {
    const m = new Map<string, Array<{ op: string; text: string }>>();
    for (const r of revisions) {
      const segs = (r as { segments?: Array<{ op: string; text: string }> }).segments;
      if (segs?.length && r.new) m.set(r.new, segs);
    }
    return m;
  }, [revisions]);

  const changed = React.useMemo(() => {
    const m = new Map<number, Map<string, "edit" | "add" | "del">>();
    for (const r of revisions) {
      const n = slideOf(r.part);
      const map = m.get(n) ?? new Map<string, "edit" | "add" | "del">();
      const kind = (r as { paired?: boolean }).paired ? "edit" : r.kind === "insert" ? "add" : r.kind === "delete" ? "del" : "edit";
      const segs = (r as { segments?: Array<{ op: string; text: string }> }).segments;
      if (r.new) map.set(r.new, kind);
      if (r.old && !r.new) map.set(r.old, "del");
      if (kind === "edit" && segs?.length) segsByText.set(r.new ?? r.old ?? "", segs);
      m.set(n, map);
    }
    return m;
  }, [revisions]);

  // slides whose position changed, keyed by their new number
  const movedTo = React.useMemo(() => {
    const m = new Map<number, string>();
    for (const r of revisions) {
      if (r.kind !== "move") continue;
      const to = Number((r as { to?: string }).to ?? 0);
      if (to > 0) m.set(to, (r as { from?: string }).from ?? "");
    }
    return m;
  }, [revisions]);

  const [active, setActive] = React.useState(0);
  const cardRefs = React.useRef<Array<HTMLDivElement | null>>([]);
  React.useEffect(() => {
    cardRefs.current[active]?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [active]);

  return (
    <div className={cn("flex h-full min-h-0 flex-1 flex-col", sideBySide && "md:flex-row")}>
      <div className="scroll-thin min-h-0 flex-1 overflow-auto bg-slate-800/40 p-5" data-testid="pptx-deck">
        {deck.map((c, gi) => {
          if (gi !== active) return null;
          const marks = changed.get(c.slide) ?? new Map<string, "edit" | "add" | "del">();
          const untouched = marks.size === 0;
          return (
            <div
              key={c.slide}
              ref={(el) => { cardRefs.current[gi] = el; }}
              className="mx-auto w-full max-w-[680px] rounded-lg bg-white p-5 shadow-xl"
            >
              <div className="mb-3 flex items-center gap-2 border-b border-slate-200 pb-2">
                <Presentation className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-[11px] text-slate-500">
                  {t("pptx.slide", { count: c.slide || 0 })}
                  {slides > 0 ? ` / ${slides}` : ""}
                </span>
                {movedTo.has(c.slide) ? (
                  <span className="rounded bg-violet-500/[0.18] px-1.5 text-[11px] text-violet-700">
                    自第 {movedTo.get(c.slide)} 页移来
                  </span>
                ) : null}
                {untouched && !movedTo.has(c.slide) ? (
                  <span className="ml-auto text-[11px] text-slate-400">{t("pptx.same")}</span>
                ) : null}
              </div>
              <div className="space-y-1 text-[13.5px] leading-relaxed" style={{ color: "#1f2328" }}>
                {c.paragraphs.map((p, i) => {
                  const hit = marks.get(p);
                  const isTitle = i === 0;
                  return (
                    <div
                      key={i}
                      className={cn(
                        "rounded px-1.5 py-0.5",
                        isTitle && "mb-1 font-semibold",
                        hit === "edit" && "bg-amber-500/[0.20]",
                        hit === "add" && REGION_TONE_TEXT.insert,
                        hit === "del" && REGION_TONE_TEXT.delete,
                      )}
                    >
                      {(() => {
                        const segs = segsByText.get(p);
                        if (!segs) return p;
                        return segs.map((x, k) =>
                          x.op === "ins" ? (
                            <span key={k} className="bg-emerald-500/35">{x.text}</span>
                          ) : x.op === "same" ? (
                            <span key={k}>{x.text}</span>
                          ) : null,
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <aside className={cn("flex w-full shrink-0 flex-col border-t border-line bg-panel", sideBySide ? "max-h-[45%] md:max-h-none md:h-full md:w-72 md:border-l md:border-t-0" : "max-h-[45%]")}>
        <div className="flex items-center gap-1.5 border-b border-line px-3 py-2 text-[12px]">
          <Presentation className="h-3.5 w-3.5 text-sky-400" />
          <span className="text-slate-300">{t("word.changes", { count: revisions.length })}</span>
          <span className="ml-auto flex items-center gap-1">
            <button onClick={() => setActive((i) => (i <= 0 ? deck.length - 1 : i - 1))} className="rounded border border-line px-1.5 py-0.5 text-slate-400 hover:text-white" aria-label="prev">
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => setActive((i) => (i >= deck.length - 1 ? 0 : i + 1))} className="rounded border border-line px-1.5 py-0.5 text-slate-400 hover:text-white" aria-label="next">
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </span>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-auto">
          {deck.map((c, gi) => (
            <button
              key={c.slide}
              onClick={() => setActive(gi)}
              className={cn(
                "flex w-full flex-col gap-0.5 border-b border-line/50 px-3 py-2 text-left text-[12px]",
                gi === active ? "bg-white/[0.07]" : "hover:bg-white/[0.03]",
              )}
            >
              <span className="text-slate-300">{t("pptx.slide", { count: c.slide || 0 })}</span>
              <span className="truncate text-slate-500">
                {c.paragraphs[0] ?? ""} · {movedTo.has(c.slide) ? `移动 · 第 ${movedTo.get(c.slide)} 页来的` : `${changed.get(c.slide)?.size ?? 0} 处改动`}
              </span>
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}
