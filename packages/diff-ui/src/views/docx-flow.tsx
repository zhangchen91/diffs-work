import * as React from "react";
import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { useI18n } from "@diffs/i18n";
import { cn } from "../lib/cn";
import { REGION_TONE_TEXT, MARK_TONE } from "../lib/revision-tone";
import { Badge } from "../lib/primitives";
import { DocxSplitView } from "./docx-split";

/**
 * A Word diff rendered from the kernel's own revision list.
 *
 * The alternative was an editor-grade renderer (31 MB) that lays out pages pixel-for-pixel
 * and can also edit. Reviewing two versions needs neither: it needs the paragraphs in
 * reading order with each change marked. That is exactly what `opc_diff` returns, so the
 * page is built from it and nothing else is shipped.
 */
export type DocxOp = "insert" | "delete" | "modify" | "move";

export interface DocxChange {
  kind: DocxOp;
  old?: string;
  new?: string;
  oldIndex?: number;
  newIndex?: number;
  segments?: Array<{ op: "same" | "ins" | "del"; text: string }>;
}

const OP_CLASS: Record<DocxOp, string> = {
  insert: REGION_TONE_TEXT.insert,
  delete: REGION_TONE_TEXT.delete,
  modify: "bg-amber-500/[0.16] text-amber-800",
  move: REGION_TONE_TEXT.move,
};
const OP_KEY: Record<DocxOp, string> = {
  insert: "word.op.insert",
  delete: "word.op.delete",
  modify: "word.op.modify",
  move: "word.op.move",
};

/** One line of the laid-out page. */
interface Row {
  key: string;
  op: DocxOp | "same";
  text: string;
  segments?: DocxChange["segments"];
  change?: DocxChange;
}

/**
 * Build the page from the new document's own paragraph order.
 *
 * The kernel returns every paragraph of the new side plus the revisions; walking that list
 * and marking each paragraph that a revision points at keeps the reading order honest.
 * Reconstructing order from the revisions alone duplicated and misplaced paragraphs.
 */
function layout(paragraphs: string[], changes: DocxChange[]): Row[] {
  const byNewIndex = new Map<number, DocxChange>();
  const deletedAt = new Map<number, DocxChange[]>();
  for (const c of changes) {
    if (c.kind === "delete" && typeof c.oldIndex === "number") {
      const list = deletedAt.get(c.oldIndex) ?? [];
      list.push(c);
      deletedAt.set(c.oldIndex, list);
    } else if (typeof c.newIndex === "number") {
      byNewIndex.set(c.newIndex, c);
    }
  }

  const rows: Row[] = [];
  const used = new Set<string>();
  for (let i = 0; i < paragraphs.length; i++) {
    // a paragraph removed from the old side shows just before the paragraph that took its place
    const gone = deletedAt.get(i);
    if (gone) {
      for (const d of gone) {
        rows.push({ key: `del-${i}-${d.old ?? ""}`, op: "delete", text: d.old ?? "" });
        used.add(`del-${i}-${d.old ?? ""}`);
      }
    }
    const hit = byNewIndex.get(i);
    rows.push({
      key: `p-${i}`,
      op: hit ? hit.kind : "same",
      text: paragraphs[i] ?? "",
      segments: hit?.segments,
      change: hit,
    });
  }
  // deletions whose index is past the end of the new document
  for (const [idx, list] of deletedAt) {
    if (idx < paragraphs.length) continue;
    for (const d of list) {
      const key = `del-tail-${idx}-${d.old ?? ""}`;
      if (!used.has(key)) rows.push({ key, op: "delete", text: d.old ?? "" });
    }
  }
  return rows;
}

export function DocxFlowView({
  changes,
  paragraphs = [],
  oldParagraphs = [],
  split,
}: {
  changes: DocxChange[];
  paragraphs?: string[];
  oldParagraphs?: string[];
  /** Controlled from the toolbar, so Word has the same one/two-column switch as code. */
  split?: boolean;
}): React.ReactElement {
  const { t } = useI18n();
  const [wide, setWide] = React.useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 900px)").matches : false,
  );
  React.useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const [twoPane, setTwoPane] = React.useState<boolean | null>(null);
  // Controlled by the toolbar when given; otherwise the view decides from its own width.
  // When the toolbar drives it, that is the only input: a leftover internal state made the
  // first frame open in one column on a wide screen.
  const showSplit = split ?? twoPane ?? wide;
  const rows = React.useMemo(() => layout(paragraphs, changes), [paragraphs, changes]);
  const [active, setActive] = React.useState(-1);
  const rowRefs = React.useRef<Array<HTMLDivElement | null>>([]);

  React.useEffect(() => {
    if (active >= 0) rowRefs.current[active]?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [active]);

  React.useEffect(() => {
    (window as unknown as { __docxDbg?: unknown }).__docxDbg = {
      changes: changes.length,
      kinds: changes.map((c) => c.kind),
      raw: JSON.stringify(changes).slice(0, 600),
      paragraphs: paragraphs.length,
    };
  }, [changes, paragraphs]);

  const counts = React.useMemo(() => {
    const c: Record<DocxOp, number> = { insert: 0, delete: 0, modify: 0, move: 0 };
    for (const ch of changes) c[ch.kind]++;
    return c;
  }, [changes]);

  if (showSplit && oldParagraphs.length) {
    // No extra "one column" button at the bottom: there is one switch in the toolbar, the same
    // one the code view has, and a second control that changed state without showing which state
    // you were in was the reported confusion.
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col">
        {/* `split` is the toolbar's one/two-column switch, the same one the code view has. It
            defaulted to `true` here, so the document showed both versions side by side whatever
            the switch said — the reported "低级 bug": the layout did not follow the control. */}
        <DocxSplitView before={oldParagraphs} after={paragraphs} changes={changes as never} sideBySide={split} />
      </div>
    );
  }

  // The list sits beside the page only when there are two pages to compare. It was `md:flex-row`
  // unconditionally, so in one-column mode the list took the right-hand side and left the document
  // a few pixels wide — the text rendered as a vertical ribbon.
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", split && "md:flex-row")}>
      <div className="min-h-0 flex-1 overflow-auto bg-white p-3 sm:p-6" data-testid="docx-flow">
        <div className="mx-auto max-w-[720px] text-[14px] leading-relaxed" style={{ color: "#1f2328" }}>
          {rows.map((r, i) => (
            <div
              key={r.key}
              ref={(el) => { rowRefs.current[i] = el; }}
              className={cn(
                "mb-1 rounded px-1",
                r.op !== "same" && OP_CLASS[r.op as DocxOp],
                active >= 0 && rows[active]?.key === r.key && "ring-2 ring-brand",
              )}
            >
              {r.segments
                ? r.segments.map((s, k) =>
                    s.op === "del" ? (
                      <span key={k} className={MARK_TONE.del}>{s.text}</span>
                    ) : s.op === "ins" ? (
                      <span key={k} className={MARK_TONE.ins}>{s.text}</span>
                    ) : (
                      <span key={k}>{s.text}</span>
                    ),
                  )
                : r.text}
            </div>
          ))}
        </div>
      </div>

      <aside className={cn("flex w-full shrink-0 flex-col border-t border-line bg-panel", split ? "max-h-[45%] md:max-h-none md:w-80 md:border-l md:border-t-0" : "max-h-[45%]")}>
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2 text-[12px]">
          <FileText className="h-3.5 w-3.5 text-sky-400" />
          <span className="text-slate-300">{t("word.changes", { count: changes.length })}</span>
          <span className="ml-auto flex items-center gap-1">
            <button onClick={() => setActive((i) => (i <= 0 ? rows.length - 1 : i - 1))} className="rounded border border-line px-1.5 py-0.5 text-slate-400 hover:text-white" aria-label="prev">
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => setActive((i) => (i >= rows.length - 1 ? 0 : i + 1))} className="rounded border border-line px-1.5 py-0.5 text-slate-400 hover:text-white" aria-label="next">
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5 border-b border-line px-3 py-1.5">
          {(["insert", "delete", "modify", "move"] as DocxOp[]).map((k) => (
            <Badge key={k} tone="muted" className={OP_CLASS[k]}>
              {t(OP_KEY[k])} {counts[k]}
            </Badge>
          ))}
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-auto">
          {changes.map((c, i) => (
            <div key={i} className="border-b border-line/50 px-3 py-1.5 text-[12px]">
              <span className={cn("rounded px-1 text-[10.5px]", OP_CLASS[c.kind])}>{t(OP_KEY[c.kind])}</span>
              <div className="mt-0.5 break-words text-slate-400">{c.old ?? c.new ?? ""}</div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
