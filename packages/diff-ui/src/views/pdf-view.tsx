import * as React from "react";
import { ChevronLeft, ChevronRight, Loader2, ScanLine } from "lucide-react";
import type { PdfDiff, PdfRow } from "@diffs/core-pdf";
import { loadPdfjs } from "@diffs/engine-bundle";
import { cn } from "../lib/cn";
import { REGION_TONE } from "../lib/revision-tone";
import { Badge } from "../lib/primitives";
import { useI18n } from "@diffs/i18n";

const OP_CLASS: Record<string, string> = {
  added: REGION_TONE.insert + " text-emerald-200",
  removed: REGION_TONE.delete + " text-red-200",
  changed: REGION_TONE.change + " text-amber-200",
};
const OP_KEY: Record<string, string> = {
  added: "pdf.op.added",
  removed: "pdf.op.removed",
  changed: "pdf.op.changed",
};

const SCALE = 1.35;

/**
 * PDF diff view: the new file is rendered page by page with pdf.js and the
 * changed lines get boxes drawn at their real coordinates; the list on the
 * right walks the changes and scrolls the page to the matching box.
 */
export function PdfDiffView({
  diff,
  newBytes,
  oldBytes,
  sideBySide,
}: {
  sideBySide?: boolean;
  diff: PdfDiff;
  newBytes: ArrayBuffer;
  oldBytes: ArrayBuffer;
}): React.ReactElement {
  const { t } = useI18n();
  const [page, setPage] = React.useState(1);
  const [activeIdx, setActiveIdx] = React.useState(-1);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const hostRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const [renderState, setRenderState] = React.useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = React.useState("");
  const [dims, setDims] = React.useState({ w: 595, h: 842 });

  const changes = React.useMemo(() => diff.rows.filter((r) => r.op !== "equal"), [diff]);
  const pageChanges = React.useMemo(
    () => changes.filter((r) => r.page === page),
    [changes, page],
  );

  // A marker sits wherever the text is, often well below the fold, so a page opened at the
  // top looks like it has no changes at all. Scroll to the first one once it is painted.
  React.useEffect(() => {
    if (renderState !== "ready") return;
    const first = hostRef.current?.querySelector<HTMLElement>("span.pointer-events-none");
    first?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [renderState, page]);

  // first changed page is where the reader wants to land
  React.useEffect(() => {
    const first = changes[0];
    if (first) setPage(first.page);
  }, [changes]);

  React.useEffect(() => {
    let cancelled = false;
    setRenderState("loading");
    (async () => {
      try {
        const { pdfjsLib } = await loadPdfjs();
        const api = pdfjsLib as unknown as {
          getDocument: (o: { data: Uint8Array }) => { promise: Promise<unknown> };
        };
        // copy: pdf.js detaches the buffer it receives and the caller still owns `newBytes`
        const doc = (await api.getDocument({ data: new Uint8Array(newBytes.slice(0)) }).promise) as {
          getPage: (n: number) => Promise<{
            getViewport: (o: { scale: number }) => { width: number; height: number };
            render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> };
          }>;
        };
        const p = await doc.getPage(page);
        const viewport = p.getViewport({ scale: SCALE });
        const canvas = canvasRef.current;
        if (cancelled || !canvas) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no 2d context");
        ctx.scale(dpr, dpr);
        await p.render({ canvasContext: ctx, viewport }).promise;
        if (cancelled) return;
        setDims({ w: viewport.width / SCALE, h: viewport.height / SCALE });
        setRenderState("ready");
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setRenderState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page, newBytes]);

  const focus = (idx: number) => {
    const r = changes[idx];
    if (!r) return;
    setActiveIdx(idx);
    setPage(r.page);
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${idx}"]`)?.scrollIntoView({ block: "nearest" });
  };
  const step = (d: number) => {
    if (!changes.length) return;
    focus((activeIdx + d + changes.length) % changes.length);
  };

  const active = activeIdx >= 0 ? changes[activeIdx] : null;

  // Below md the page column and the change list stack: a fixed 320px aside left the page about
  // 70px wide on a phone.
  return (
    <div className={cn("flex h-full min-h-0 flex-col", sideBySide && "md:flex-row")} data-testid="pdf-diff">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[12px] text-slate-400">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded border border-line px-1.5 py-0.5 disabled:opacity-40"
            aria-label="prev page"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span>
            {page} / {diff.pages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(diff.pages, p + 1))}
            disabled={page >= diff.pages}
            className="rounded border border-line px-1.5 py-0.5 disabled:opacity-40"
            aria-label="next page"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <span className="ml-auto text-[11px] text-slate-600">{t("pdf.hint")}</span>
        </div>
        <div className="scroll-thin relative min-h-0 flex-1 overflow-auto bg-slate-800/40 p-4" ref={hostRef}>
          {renderState === "loading" ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : null}
          {renderState === "error" ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/[0.08] p-3 text-[12.5px] text-red-200">
              {t("pdf.failed", { error })}
            </div>
          ) : null}
          <div className="relative mx-auto w-fit shadow-xl">
            <canvas ref={canvasRef} className="block bg-white" />
            {renderState === "ready"
              ? pageChanges.map((r, i) => {
                  const items = (r.new ?? r.old)?.rects ?? [];
                  const isActive = active && active.page === r.page && pageChanges[i] === active;
                  return items.map((rect, k) => (
                    <span
                      key={`${i}-${k}`}
                      className={cn(
                        "pointer-events-none absolute rounded-[2px]",
                        r.op === "added" && "bg-emerald-400/30 ring-1 ring-emerald-500/70",
                        r.op === "removed" && "bg-red-400/30 ring-1 ring-red-500/70",
                        r.op === "changed" && "bg-amber-400/30 ring-1 ring-amber-500/70",
                        isActive && "ring-2 ring-brand",
                      )}
                      style={{
                        left: rect.x * SCALE,
                        top: rect.y * SCALE,
                        width: Math.max(rect.w * SCALE, 6),
                        height: Math.max(rect.h * SCALE, 8),
                      }}
                    />
                  ));
                })
              : null}
            <span className="sr-only">{`${dims.w}x${dims.h}`}</span>
          </div>
          {diff.emptyPages.length ? (
            <div className="mx-auto mt-3 flex w-fit items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.08] px-3 py-1.5 text-[12px] text-amber-200">
              <ScanLine className="h-3.5 w-3.5" />
              {t("pdf.noTextLayer", { pages: diff.emptyPages.join(", ") })}
            </div>
          ) : null}
        </div>
      </div>

      <aside className={cn("flex w-full shrink-0 flex-col border-t border-line", sideBySide ? "max-h-[45%] md:max-h-none md:w-80 md:border-l md:border-t-0" : "max-h-[45%]")}>
        <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[12px] text-slate-400">
          <span>{t("pdf.changes", { count: changes.length })}</span>
          <span className="ml-auto flex items-center gap-1">
            <button onClick={() => step(-1)} className="rounded border border-line px-1.5 py-0.5 hover:text-white" aria-label="prev">
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => step(1)} className="rounded border border-line px-1.5 py-0.5 hover:text-white" aria-label="next">
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5 border-b border-line px-3 py-1.5">
          <Badge tone="muted" className={OP_CLASS.added}>
            {t("pdf.op.added")} {diff.added}
          </Badge>
          <Badge tone="muted" className={OP_CLASS.removed}>
            {t("pdf.op.removed")} {diff.removed}
          </Badge>
          <Badge tone="muted" className={OP_CLASS.changed}>
            {t("pdf.op.changed")} {diff.changed}
          </Badge>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-auto" ref={listRef}>
          {changes.map((r, i) => (
            <button
              key={i}
              data-idx={i}
              onClick={() => focus(i)}
              className={cn(
                "flex w-full flex-col gap-0.5 border-b border-line/50 px-3 py-1.5 text-left text-[12px]",
                i === activeIdx ? "bg-white/[0.07]" : "hover:bg-white/[0.03]",
              )}
            >
              <span className="flex items-center gap-1.5">
                <span className={cn("rounded px-1 text-[10.5px]", OP_CLASS[r.op])}>{t(OP_KEY[r.op])}</span>
                <span className="text-slate-600">
                  {t("pdf.page", { page: r.page })}
                </span>
              </span>
              <PdfRowText row={r} />
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}

function PdfRowText({ row }: { row: PdfRow }): React.ReactElement {
  if (row.op === "changed" && row.inline) {
    return (
      <span className="truncate">
        {row.inline.map((seg, i) =>
          seg.op === "equal" ? (
            <span key={i} className="text-slate-400">
              {seg.text}
            </span>
          ) : seg.op === "del" ? (
            <span key={i} className="text-red-300/80 line-through">
              {seg.text}
            </span>
          ) : (
            <span key={i} className="text-emerald-200">
              {seg.text}
            </span>
          ),
        )}
      </span>
    );
  }
  const text = row.new?.text ?? row.old?.text ?? "";
  return (
    <span className={cn("truncate", row.op === "added" ? "text-emerald-200" : "text-red-200/80 line-through")}>
      {text}
    </span>
  );
}