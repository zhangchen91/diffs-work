/**
 * PDF object-level diff.
 *
 * Not a raster comparison: both files are opened with pdf.js, every page's text
 * layer is read with `getTextContent()`, items are reconstructed into lines with
 * their positions, and the two documents are aligned page by page. Each changed
 * line keeps the source rectangles of its items, so the viewer can draw exact
 * highlight boxes over a freshly rendered page.
 *
 * Limitation, stated in the UI: a page without a text layer (a scan) has nothing
 * to compare here — it is reported as "no text layer" instead of pretending.
 */
import { loadPdfjs } from "@diffs/engine-bundle";

export interface PdfLine {
  page: number;
  /** vertical position in PDF user space (top-down, pt) */
  y: number;
  x: number;
  text: string;
  /** rectangles of the items on this line, PDF user space */
  rects: Array<{ x: number; y: number; w: number; h: number }>;
}

export interface PdfDoc {
  pages: number;
  width: number;
  height: number;
  lines: PdfLine[];
  /** pages that carried no extractable text (scans) */
  emptyPages: number[];
}

export type PdfOp = "equal" | "added" | "removed" | "changed";

export interface PdfRow {
  op: PdfOp;
  /** 1-based page number in the new file (or the old one when removed) */
  page: number;
  old?: PdfLine;
  new?: PdfLine;
  /** inline word diff: segments with their op */
  inline?: Array<{ op: "equal" | "ins" | "del"; text: string }>;
}

export interface PdfDiff {
  rows: PdfRow[];
  added: number;
  removed: number;
  changed: number;
  pages: number;
  oldPages: number;
  newPages: number;
  emptyPages: number[];
  summary: string;
}

interface RawItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function readDoc(bytes: ArrayBuffer): Promise<PdfDoc> {
  const { pdfjsLib } = await loadPdfjs();
  const api = pdfjsLib as any;
  // pdf.js transfers (detaches) the buffer it is handed, so it always gets a copy:
  // the caller's bytes are reused for rendering in the viewer.
  const doc = await api.getDocument({ data: new Uint8Array(bytes.slice(0)), isEvalSupported: false }).promise;
  const pageCount: number = doc.numPages;
  const lines: PdfLine[] = [];
  const emptyPages: number[] = [];
  let width = 595;
  let height = 842;

  for (let p = 1; p <= pageCount; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    width = viewport.width;
    height = viewport.height;
    const content = await page.getTextContent();
    const items: RawItem[] = (content.items as any[])
      .filter((it) => typeof it.str === "string" && it.str.trim() !== "")
      .map((it) => {
        const tr: number[] = it.transform ?? [1, 0, 0, 1, 0, 0];
        const size = Math.hypot(tr[2] ?? 0, tr[3] ?? 0) || it.height || 10;
        return {
          str: it.str,
          x: tr[4] ?? 0,
          // `transform[5]` is the text *baseline*, and PDF space has its origin at the
          // bottom-left while the viewer draws top-down. Using the baseline as the top edge
          // put every box half a line too low, so a highlight covered the upper half of the
          // line and left the rest outside it.
          y: viewport.height - (tr[5] ?? 0) - size,
          w: typeof it.width === "number" ? it.width : it.str.length * size * 0.5,
          h: size * 1.15,
        };
      });
    if (!items.length) emptyPages.push(p);
    lines.push(...itemsToLines(items, p));
    page.cleanup();
  }
  return { pages: pageCount, width, height, lines, emptyPages };
}

/** Group text items into visual lines (same baseline, reading order). */
function itemsToLines(items: RawItem[], page: number): PdfLine[] {
  const sorted = [...items].sort((a, b) => (Math.abs(a.y - b.y) < 2 ? a.x - b.x : a.y - b.y));
  const out: PdfLine[] = [];
  for (const it of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.y - it.y) < Math.max(3, it.h * 0.5)) {
      // same line: keep a space when the items are visually apart (column gaps)
      const prev = last.rects[last.rects.length - 1];
      const gap = it.x - (prev.x + prev.w);
      if (gap > Math.max(2, it.h * 0.25) && !/\s$/.test(last.text)) last.text += " ";
      last.text += it.str;
      last.rects.push({ x: it.x, y: it.y, w: it.w, h: it.h });
    } else {
      out.push({
        page,
        y: it.y,
        x: it.x,
        text: it.str,
        rects: [{ x: it.x, y: it.y, w: it.w, h: it.h }],
      });
    }
  }
  return out.map((l) => ({ ...l, text: l.text.replace(/\s+/g, " ").trim() })).filter((l) => l.text);
}

function lcsAlign(a: string[], b: string[]): Array<{ op: "equal" | "del" | "ins"; ai?: number; bi?: number }> {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: Array<{ op: "equal" | "del" | "ins"; ai?: number; bi?: number }> = [];
  let i = 0;
  let j = 0;
  const dels: number[] = [];
  const ins: number[] = [];
  const flush = () => {
    const k = Math.min(dels.length, ins.length);
    for (let x = 0; x < k; x++) out.push({ op: "del", ai: dels[x] });
    for (let x = 0; x < k; x++) out.push({ op: "ins", bi: ins[x] });
    for (let x = k; x < dels.length; x++) out.push({ op: "del", ai: dels[x] });
    for (let x = k; x < ins.length; x++) out.push({ op: "ins", bi: ins[x] });
    dels.length = 0;
    ins.length = 0;
  };
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      flush();
      out.push({ op: "equal", ai: i, bi: j });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      dels.push(i++);
    } else {
      ins.push(j++);
    }
  }
  while (i < n) dels.push(i++);
  while (j < m) ins.push(j++);
  flush();
  return out;
}

/** Word-level inline diff between two changed lines. */
function inlineDiff(a: string, b: string): Array<{ op: "equal" | "ins" | "del"; text: string }> {
  const toks = (s: string) => s.split(/(\s+|(?=[，。；：、（）])|(?<=[，。；：、（）]))/).filter((t) => t !== "");
  const A = toks(a);
  const B = toks(b);
  const ops = lcsAlign(A, B);
  const out: Array<{ op: "equal" | "ins" | "del"; text: string }> = [];
  for (const o of ops) {
    const text = o.op === "del" ? A[o.ai!] : o.op === "ins" ? B[o.bi!] : A[o.ai!];
    const last = out[out.length - 1];
    if (last && last.op === o.op) last.text += text;
    else out.push({ op: o.op, text });
  }
  return out;
}

export async function diffPdf(oldBytes: ArrayBuffer, newBytes: ArrayBuffer): Promise<PdfDiff> {
  const [oldDoc, newDoc] = await Promise.all([readDoc(oldBytes), readDoc(newBytes)]);
  const oldText = oldDoc.lines.map((l) => l.text);
  const newText = newDoc.lines.map((l) => l.text);
  const ops = lcsAlign(oldText, newText);

  const rows: PdfRow[] = [];
  let added = 0;
  let removed = 0;
  let changed = 0;
  let pendingDel: PdfLine[] = [];
  let pendingIns: PdfLine[] = [];
  const flush = () => {
    const k = Math.min(pendingDel.length, pendingIns.length);
    for (let x = 0; x < k; x++) {
      changed++;
      rows.push({
        op: "changed",
        page: pendingIns[x].page,
        old: pendingDel[x],
        new: pendingIns[x],
        inline: inlineDiff(pendingDel[x].text, pendingIns[x].text),
      });
    }
    for (let x = k; x < pendingDel.length; x++) {
      removed++;
      rows.push({ op: "removed", page: pendingDel[x].page, old: pendingDel[x] });
    }
    for (let x = k; x < pendingIns.length; x++) {
      added++;
      rows.push({ op: "added", page: pendingIns[x].page, new: pendingIns[x] });
    }
    pendingDel = [];
    pendingIns = [];
  };
  for (const o of ops) {
    if (o.op === "equal") {
      flush();
      rows.push({ op: "equal", page: newDoc.lines[o.bi!].page, old: oldDoc.lines[o.ai!], new: newDoc.lines[o.bi!] });
    } else if (o.op === "del") pendingDel.push(oldDoc.lines[o.ai!]);
    else pendingIns.push(newDoc.lines[o.bi!]);
  }
  flush();

  return {
    rows,
    added,
    removed,
    changed,
    pages: newDoc.pages,
    oldPages: oldDoc.pages,
    newPages: newDoc.pages,
    emptyPages: [...new Set([...oldDoc.emptyPages, ...newDoc.emptyPages])].sort((a, b) => a - b),
    summary: `${newDoc.pages} page(s) · +${added} / -${removed} / ~${changed} lines`,
  };
}