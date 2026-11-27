import * as React from "react";
import { ChevronLeft, ChevronRight, FileSpreadsheet, Search, Rows3 } from "lucide-react";
import type { SheetDiff, CellChange, WorkbookDiff } from "@diffs/core-xlsx";
import { charDiff } from "@diffs/core-text";
import { cn } from "../lib/cn";
import { Badge } from "../lib/primitives";
import { useI18n } from "@diffs/i18n";

const OP_CLASS: Record<string, string> = {
  add: "bg-emerald-500/[0.14] border-emerald-500/40",
  del: "bg-red-500/[0.14] border-red-500/40",
  mod: "bg-amber-500/[0.14] border-amber-500/40",
  formula: "bg-sky-500/[0.14] border-sky-500/40",
  move: "bg-violet-500/[0.14] border-violet-500/40",
  style: "bg-fuchsia-500/[0.14] border-fuchsia-500/40",
};
const OP_KEY: Record<string, string> = {
  add: "xlsx.op.add",
  del: "xlsx.op.del",
  mod: "xlsx.op.mod",
  formula: "xlsx.op.formula",
  move: "xlsx.op.move",
  style: "xlsx.op.style",
};

/** "AB12" → { row: 12, col: 28 } (1-based). */
function parseRef(ref: string): { row: number; col: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref || "");
  if (!m) return { row: 0, col: 0 };
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(m[2]), col };
}

function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Excel diff, PageIndex-style:
 *
 *   left  — a real cell grid around each changed row (old above, new below),
 *           changed cells outlined in green / red / amber;
 *   right — the change list, click to scroll + flash the matching cell;
 *           prev/next walks the list in row-then-column order.
 *
 * The grid is sparse: only rows and columns that carry a change (plus one row of
 * context either side) are drawn, so a 500-row sheet does not become 500 DOM rows.
 */
export function XlsxDiffView({ diff }: { diff: WorkbookDiff }): React.ReactElement {
  const { t } = useI18n();
  const sheets = React.useMemo(
    () => diff.sheets.filter((s) => s.status !== "same" || s.changes.length > 0),
    [diff],
  );
  const [active, setActive] = React.useState(0);
  const [onlyChanged, setOnlyChanged] = React.useState(true);
  /** hide cells that only changed style: a template swap repaints everything */
  const [hideStyle, setHideStyle] = React.useState(true);
  const [query, setQuery] = React.useState("");
  const [activeIdx, setActiveIdx] = React.useState(-1);
  const [flash, setFlash] = React.useState(0);
  const gridRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  const sheet: SheetDiff | undefined = sheets[active] ?? sheets[0];

  React.useEffect(() => {
    setActiveIdx(-1);
    setQuery("");
  }, [sheet?.name]);

  // cells of the active sheet, sorted row then column (the order a reviewer reads)
  const allChanges = React.useMemo(() => {
    const list = (sheet?.changes ?? []).map((c) => {
      const pos = parseRef(c.ref);
      return { ...c, row: c.row ?? pos.row, col: c.col ?? pos.col };
    });
    return list.sort((a, b) => (a.row ?? 0) - (b.row ?? 0) || (a.col ?? 0) - (b.col ?? 0));
  }, [sheet]);

  const visibleChanges = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = hideStyle ? allChanges.filter((c) => c.op !== "style") : allChanges;
    if (!q) return base;
    return base.filter(
      (c) =>
        c.ref.toLowerCase().includes(q) ||
        (c.old?.text ?? "").toLowerCase().includes(q) ||
        (c.new?.text ?? "").toLowerCase().includes(q),
    );
  }, [allChanges, query, hideStyle]);

  const styleTotal = diff.sheets.reduce((n, s) => n + (s.styleChanged ?? 0), 0);

  const focus = React.useCallback(
    (idx: number) => {
      const c = visibleChanges[idx];
      if (!c) return;
      setActiveIdx(idx);
      setFlash((n) => n + 1);
      const cell = gridRef.current?.querySelector<HTMLElement>(`[data-ref="${c.ref}"]`);
      cell?.scrollIntoView({ block: "nearest", inline: "center" });
      const row = listRef.current?.querySelector<HTMLElement>(`[data-idx="${idx}"]`);
      row?.scrollIntoView({ block: "nearest" });
    },
    [visibleChanges],
  );

  const step = (d: number) => {
    if (!visibleChanges.length) return;
    const next = (activeIdx + d + visibleChanges.length) % visibleChanges.length;
    focus(next);
  };

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        step(1);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        step(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIdx, visibleChanges.length]);

  if (!sheets.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <div className="text-[15px] text-slate-300">{t("xlsx.same.title")}</div>
        <div className="text-[12px] text-slate-500">{t("xlsx.same.desc", { sheets: diff.totals.sheets })}</div>
      </div>
    );
  }

  const sheetList = onlyChanged ? sheets : diff.sheets;
  // grid shape: every changed row, plus one row of context, and every changed column
  const byRef = new Map(
    (hideStyle ? allChanges.filter((c) => c.op !== "style") : allChanges).map((c) => [`${c.row}:${c.col}`, c]),
  );
  const rows = [...new Set(allChanges.map((c) => c.row as number))].sort((a, b) => a - b);
  const gridRows: number[] = [];
  for (const r of rows) {
    if (!gridRows.includes(r - 1) && r - 1 > 0) gridRows.push(r - 1);
    if (!gridRows.includes(r)) gridRows.push(r);
    if (!gridRows.includes(r + 1)) gridRows.push(r + 1);
  }
  gridRows.sort((a, b) => a - b);
  const cols = [...new Set(allChanges.map((c) => c.col as number))].sort((a, b) => a - b);
  // Excel stores 62 characters for a clause column and 9 for a number; render them at
  // those proportions (clamped) instead of one guessed width for every column.
  const colW = (c: number): number => {
    const raw = sheet?.colWidths?.[c];
    const chars = raw && raw > 0 ? raw : 12;
    return Math.round(Math.min(Math.max(chars * 7.2, 64), 620));
  };
  const activeCell = activeIdx >= 0 ? visibleChanges[activeIdx] : null;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="xlsx-diff">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <FileSpreadsheet className="h-4 w-4 text-emerald-400" />
        <Badge tone="default">
          <span className="text-emerald-400">+{diff.totals.added}</span>
          <span className="text-slate-600">/</span>
          <span className="text-red-400">-{diff.totals.removed}</span>
          <span className="text-slate-600">/</span>
          <span className="text-amber-400">~{diff.totals.modified}</span>
        </Badge>
        {diff.totals.formulaOnly ? <Badge tone="muted">{t("xlsx.formulaOnly", { count: diff.totals.formulaOnly })}</Badge> : null}
        {styleTotal > 0 ? <Badge tone="muted" className="text-fuchsia-300">✎{styleTotal}</Badge> : null}
        <span className="text-[12px] text-slate-500">{t("xlsx.summary", { sheets: diff.totals.sheets, added: diff.totals.added, removed: diff.totals.removed, modified: diff.totals.modified })}</span>
        <label className="ml-auto flex items-center gap-1.5 text-[12px] text-slate-400">
          <input type="checkbox" checked={hideStyle} onChange={(e) => setHideStyle(e.target.checked)} />
          {t("xlsx.hideStyle")}
        </label>
        <label className="flex items-center gap-1.5 text-[12px] text-slate-400">
          <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />
          {t("xlsx.onlyChanged")}
        </label>
      </div>

      {/* Below md the sheet list becomes a horizontal strip above the grid: a 208px vertical
          column left the cells themselves about 100px wide on a phone. */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="flex w-full shrink-0 overflow-x-auto overflow-y-hidden border-b border-line py-1 md:block md:w-52 md:overflow-auto md:border-b-0 md:border-r">
          {sheetList.map((s) => {
            const sel = s.name === sheet?.name;
            return (
              <button
                key={s.name}
                onClick={() => setActive(Math.max(0, sheets.indexOf(s)))}
                className={cn(
                  "flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[12.5px]",
                  sel ? "bg-white/[0.06] text-white" : "text-slate-400 hover:text-white",
                )}
                title={s.oldName && s.oldName !== s.name ? t("xlsx.renamed", { old: s.oldName, new: s.name }) : s.name}
              >
                <ChevronRight className={cn("h-3.5 w-3.5 shrink-0", sel ? "text-brand" : "text-slate-600")} />
                <span className="truncate">{s.name}</span>
                {s.added + s.removed + s.modified > 0 ? (
                  <span className="ml-auto shrink-0 text-[10.5px] text-slate-500">+{s.added} -{s.removed} ~{s.modified}</span>
                ) : null}
              </button>
            );
          })}
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
          {/* grid */}
          <div className="scroll-thin min-w-0 flex-1 overflow-auto" ref={gridRef}>
            {sheet ? (
              <>
                <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-panel/95 px-3 py-1.5 text-[12px] text-slate-400 backdrop-blur">
                  <Rows3 className="h-3.5 w-3.5" />
                  {sheet.oldName && sheet.oldName !== sheet.name ? (
                    <>{t("xlsx.renamed", { old: sheet.oldName, new: sheet.name })}</>
                  ) : (
                    <>{t("xlsx.sheet", { name: sheet.name })}</>
                  )}
                  <span className="ml-auto text-[11px] text-slate-600">{t("xlsx.gridHint")}</span>
                </div>
                <table className="border-collapse text-[12px]">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 w-10 border-b border-r border-line bg-panel-2 px-1 py-1 text-[11px] text-slate-600">#</th>
                      {cols.map((c) => (
                        <th
                          key={c}
                          style={{ width: colW(c), minWidth: colW(c) }}
                          className="border-b border-r border-line bg-panel-2 px-2 py-1 text-left text-[11px] font-medium text-slate-500"
                        >
                          {colLetter(c)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {gridRows.map((r) => (
                      <tr key={r}>
                        <td className="sticky left-0 z-10 border-b border-r border-line bg-panel-2 px-1 py-1 text-right text-[11px] text-slate-600">{r}</td>
                        {cols.map((c) => {
                          const key = `${r}:${c}`;
                          const ch = byRef.get(key);
                          const isActive = activeCell && activeCell.ref === `${colLetter(c)}${r}`;
                          return (
                            <td
                              key={key}
                              data-ref={`${colLetter(c)}${r}`}
                              style={{ width: colW(c), minWidth: colW(c) }}
                              className={cn(
                                "border-b border-r border-line/60 px-2 py-1 align-top",
                                ch && OP_CLASS[ch.op],
                                isActive && "ring-2 ring-brand ring-offset-0",
                              )}
                              title={ch?.ref}
                            >
                              <CellBody change={ch} flash={isActive ? flash : 0} />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : null}
          </div>

          {/* change list */}
          <aside className="flex max-h-[45%] w-full shrink-0 flex-col border-t border-line md:max-h-none md:w-80 md:border-l md:border-t-0">
            <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[12px] text-slate-400">
              <span>{t("xlsx.changes", { count: visibleChanges.length })}</span>
              <div className="ml-auto flex items-center gap-1">
                <button onClick={() => step(-1)} className="rounded border border-line px-1.5 py-0.5 hover:text-white" aria-label="prev">
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => step(1)} className="rounded border border-line px-1.5 py-0.5 hover:text-white" aria-label="next">
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div className="flex items-center gap-1.5 border-b border-line px-3 py-1.5">
              <Search className="h-3.5 w-3.5 text-slate-600" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("xlsx.search")}
                className="w-full bg-transparent text-[12px] text-slate-200 outline-none placeholder:text-slate-600"
              />
            </div>
            <div className="scroll-thin min-h-0 flex-1 overflow-auto" ref={listRef}>
              {visibleChanges.map((c, i) => (
                <button
                  key={`${c.ref}-${c.op}-${i}`}
                  data-idx={i}
                  onClick={() => focus(i)}
                  className={cn(
                    "flex w-full flex-col gap-0.5 border-b border-line/50 px-3 py-1.5 text-left text-[12px]",
                    i === activeIdx ? "bg-white/[0.07]" : "hover:bg-white/[0.03]",
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <span className={cn("rounded px-1 text-[10.5px]", OP_CLASS[c.op])}>{t(OP_KEY[c.op] ?? "xlsx.op.mod")}</span>
                    <span className="font-mono text-slate-300">{c.ref}</span>
                  </span>
                  {i === activeIdx ? (
                    // Selected: the full text, with only the characters that actually changed
                    // marked. Two long clauses differing in one number must show that number,
                    // not ask the reader to compare two paragraphs by eye.
                    <span className="flex flex-col gap-1 pt-1 text-[11.5px] leading-relaxed" data-testid="cell-detail">
                      <span className="break-words text-slate-400">
                        {charDiff(c.old?.text ?? "", c.new?.text ?? "").map((seg, k) =>
                          seg.op === "del" ? (
                            <span key={k} className="bg-red-500/25 text-red-200 line-through decoration-red-400/70">
                              {seg.text}
                            </span>
                          ) : seg.op === "same" ? (
                            <span key={k}>{seg.text}</span>
                          ) : null,
                        )}
                      </span>
                      <span className="break-words text-slate-200">
                        {charDiff(c.old?.text ?? "", c.new?.text ?? "").map((seg, k) =>
                          seg.op === "ins" ? (
                            <span key={k} className="bg-emerald-500/25 text-emerald-100">
                              {seg.text}
                            </span>
                          ) : seg.op === "same" ? (
                            <span key={k}>{seg.text}</span>
                          ) : null,
                        )}
                      </span>
                    </span>
                  ) : (
                    <span className="truncate text-slate-500">
                      <span className="text-red-300/70 line-through">{c.old?.text ? short(c.old.text) : "—"}</span>
                      <span className="mx-1 text-slate-700">→</span>
                      <span className="text-emerald-200/90">{c.new?.text ? short(c.new.text) : "—"}</span>
                    </span>
                  )}
                </button>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function short(s: string, n = 48): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/** Cell body: old value struck through above the new value, word-diffed when short. */
function CellBody({ change, flash }: { change?: CellChange; flash: number }): React.ReactElement {
  const [lit, setLit] = React.useState(false);
  React.useEffect(() => {
    if (!flash) return;
    setLit(true);
    const timer = setTimeout(() => setLit(false), 900);
    return () => clearTimeout(timer);
  }, [flash]);

  if (!change) return <span className="text-slate-500">{change === undefined ? "" : "—"}</span>;
  const oldText = change.old?.text ?? "";
  const newText = change.new?.text ?? "";
  const formula = change.new?.formula ?? change.old?.formula;
  // An edited cell reads across, not down: the two versions sit side by side so a long
  // clause can be compared character by character. Stacking them (old struck through above
  // new) forced the eye to jump a line for every edit.
  // No left|right split inside the cell: halving a 620px column still leaves ~300px, which
  // wraps a clause into one character per line. The grid shows the full new value at the
  // column's own width; the change list shows old against new side by side when selected.
  if (change.op === "mod" && oldText && newText) {
    // With a word-level split only the words that changed are tinted; without one the two
    // full clauses are printed and the reader has to spot the difference by eye, which is
    // what made an edited cell unreadable.
    const segs = (change.inline ?? []) as Array<{ op: string; text: string }>;
    const del = segs.filter((x) => x.op === "delete" || x.op === "del");
    const ins = segs.filter((x) => x.op === "insert" || x.op === "ins");
    if (segs.length && (del.length || ins.length)) {
      return (
        <div className={cn("flex flex-col gap-0.5", lit && "animate-pulse")}>
          {del.length ? (
            <span className="text-slate-400">
              {segs.map((x, i) =>
                (x.op === "del" || x.op === "delete") ? (
                  <span key={i} className="bg-red-500/25 text-red-200 line-through decoration-red-400/70">{x.text}</span>
                ) : x.op === "same" ? (
                  <span key={i}>{x.text}</span>
                ) : null,
              )}
            </span>
          ) : null}
          <span className="text-slate-200">
            {segs.map((x, i) =>
              (x.op === "ins" || x.op === "insert") ? (
                <span key={i} className="bg-emerald-500/25 text-emerald-100">{x.text}</span>
              ) : x.op === "same" ? (
                <span key={i}>{x.text}</span>
              ) : null,
            )}
          </span>
        </div>
      );
    }
    return (
      <div className={cn("flex flex-col gap-0.5", lit && "animate-pulse")}>
        <span className="text-red-300/60 line-through decoration-red-500/40">{oldText}</span>
        <span className="text-emerald-100">{newText}</span>
        {formula ? <span className="font-mono text-[10px] text-sky-300/70">={short(formula, 60)}</span> : null}
      </div>
    );
  }
  return (
    <div className={cn("flex flex-col gap-0.5", lit && "animate-pulse")}>
      {change.op !== "add" && oldText ? (
        <span className="text-red-300/70 line-through decoration-red-500/40">{short(oldText, 90)}</span>
      ) : null}
      {change.op !== "del" && newText ? (
        <span className="text-emerald-100">{short(newText, 90)}</span>
      ) : null}
      {formula ? <span className="font-mono text-[10px] text-sky-300/70">={short(formula, 60)}</span> : null}
    </div>
  );
}