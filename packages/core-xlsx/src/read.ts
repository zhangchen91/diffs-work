/**
 * XLSX reader: workbook → sheets → sparse cells.
 *
 * Handles what a reviewer actually needs to compare:
 *   shared + inline strings, numbers, booleans, formula errors, dates (numFmt),
 *   formulas (both the formula and the cached value), merged ranges.
 *
 * Not handled (deliberately, for now): styles/formatting-only changes, charts,
 * conditional formatting, pivot tables. A formatting-only edit therefore reads
 * as "no change" — the UI says so instead of pretending.
 */
import { readZip, readText, resolvePath, type Unzipped } from "./zip.ts";

export interface Cell {
  /** A1 reference */
  ref: string;
  /** 1-based row / column */
  row: number;
  col: number;
  /** displayed value as text (after number-format), or "" */
  text: string;
  /** raw numeric value when the cell held a number/date */
  num?: number;
  kind: "s" | "n" | "b" | "e" | "f" | "empty";
  /** formula text without the leading "=", when the cell is a formula */
  formula?: string;
}

export interface Sheet {
  name: string;
  index: number;
  /** hidden / veryHidden sheets are read but marked */
  state: "visible" | "hidden" | "veryHidden";
  cells: Map<string, Cell>;
  merges: string[];
  maxRow: number;
  maxCol: number;
}

export interface Workbook {
  sheets: Sheet[];
  date1904: boolean;
  /** sheet names in workbook order */
  names: string[];
}

const COL_RE = /^\$?([A-Z]{1,3})\$?(\d+)$/;

export function colToNum(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function numToCol(n: number): string {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function parseRef(ref: string): { row: number; col: number } | null {
  const m = COL_RE.exec(ref.replace(/([A-Z]+)(\d+)/, "$1$2"));
  if (!m) return null;
  return { col: colToNum(m[1]), row: Number(m[2]) };
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

/** `<si>`/`<is>` body → text (concatenates `<t>` runs, skips `<rPh>` phonetics). */
function richText(body: string): string {
  const clean = body.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  const parts = [...clean.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]);
  return unescapeXml(parts.join(""));
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? unescapeXml(m[1]) : undefined;
}

/** Built-in + custom number format → "is this a date?" + a tiny formatter. */
function isDateFormat(code: string): boolean {
  const c = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, "");
  return /[ymdhs]/i.test(c) && !/^[#0.,%E+\- ]+$/.test(c);
}

function formatNumber(n: number, code: string): string {
  if (isDateFormat(code)) {
    // Excel serial → date (1900 epoch, with the 1900 leap-year bug)
    const ms = Math.round(n * 86400) * 1000;
    const d = new Date(Date.UTC(1899, 11, 30) + ms);
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
    const da = String(d.getUTCDate()).padStart(2, "0");
    const hh = d.getUTCHours();
    const mm = d.getUTCMinutes();
    const hasTime = /[hs]/i.test(code) && !/^[ymd\-/. ]+$/i.test(code);
    return hasTime ? `${y}-${mo}-${da} ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}` : `${y}-${mo}-${da}`;
  }
  if (/%/.test(code)) return `${(n * 100).toFixed(Math.min(digitsOf(code), 4))}%`;
  const decimals = digitsOf(code);
  const fixed = Number.isInteger(n) && decimals === 0 ? String(n) : n.toFixed(decimals);
  return /#,##0/.test(code) ? Number(fixed).toLocaleString("en-US", { maximumFractionDigits: 10 }) : fixed;
}

function digitsOf(code: string): number {
  const m = /\.([0#]+)/.exec(code.replace(/"[^"]*"/g, ""));
  return m ? m[1].length : 0;
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

interface StyleInfo {
  numFmt: string;
}

function readStyles(files: Unzipped): StyleInfo[] {
  const xml = readText(files, "xl/styles.xml");
  if (!xml) return [];
  const custom = new Map<number, string>();
  const numFmts = xml.slice(xml.indexOf("<numFmts"), xml.indexOf("</numFmts") + 10);
  for (const m of numFmts.matchAll(/<numFmt\b([^>]*)\/?>/g)) {
    const id = Number(attr(m[1], "numFmtId"));
    const code = attr(m[1], "formatCode") ?? "";
    if (Number.isFinite(id)) custom.set(id, code);
  }
  const cellXfs = xml.slice(xml.indexOf("<cellXfs"), xml.indexOf("</cellXfs") + 11);
  const out: StyleInfo[] = [];
  for (const m of cellXfs.matchAll(/<xf\b([^>]*?)(\/>|>)/g)) {
    const id = Number(attr(m[1], "numFmtId") ?? 0);
    const code = custom.get(id) ?? (BUILTIN_DATE_FORMATS.has(id) ? "yyyy-mm-dd" : "general");
    out.push({ numFmt: code });
  }
  return out;
}

function readSharedStrings(files: Unzipped): string[] {
  const xml = readText(files, "xl/sharedStrings.xml");
  if (!xml) return [];
  const out: string[] = [];
  for (const m of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) out.push(richText(m[1]));
  return out;
}

export interface SheetMeta {
  name: string;
  path: string;
  state: "visible" | "hidden" | "veryHidden";
}

export function readSheetMetas(files: Unzipped): { sheets: SheetMeta[]; date1904: boolean } {
  const wb = readText(files, "xl/workbook.xml") ?? "";
  const pr = /date1904="(1|true)"/i.test(wb);
  const rels = readText(files, "xl/_rels/workbook.xml.rels") ?? "";
  const relMap = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = attr(m[1], "Id");
    const target = attr(m[1], "Target");
    if (id && target) relMap.set(id, target);
  }
  const sheets: SheetMeta[] = [];
  for (const m of wb.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = attr(m[1], "name") ?? `Sheet${sheets.length + 1}`;
    const rid = attr(m[1], "r:id") ?? attr(m[1], "id") ?? "";
    const stateRaw = attr(m[1], "state") ?? "visible";
    const state = stateRaw === "hidden" || stateRaw === "veryHidden" ? stateRaw : "visible";
    const target = relMap.get(rid) ?? `worksheets/sheet${sheets.length + 1}.xml`;
    sheets.push({ name, path: resolvePath("xl", target), state });
  }
  return { sheets, date1904: pr };
}

export function readSheetXml(
  xml: string,
  shared: string[],
  styles: StyleInfo[],
  meta: SheetMeta,
  index: number,
): Sheet {
  const cells = new Map<string, Cell>();
  let maxRow = 0;
  let maxCol = 0;

  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = m[1];
    const body = m[2] ?? "";
    const ref = attr(attrs, "r") ?? "";
    const pos = parseRef(ref);
    if (!pos) continue;
    const t = attr(attrs, "t") ?? "n";
    const s = Number(attr(attrs, "s") ?? 0);
    const fmt = styles[s]?.numFmt ?? "general";

    const fMatch = /<f\b([^>]*)>([\s\S]*?)<\/f>/.exec(body) ?? /<f\b([^>]*)\/>/.exec(body);
    const vMatch = /<v>([\s\S]*?)<\/v>/.exec(body);
    const isMatch = /<is>([\s\S]*?)<\/is>/.exec(body);
    const raw = vMatch ? unescapeXml(vMatch[1]) : isMatch ? richText(isMatch[1]) : "";

    let kind: Cell["kind"] = "n";
    let text = "";
    let num: number | undefined;

    if (isMatch || t === "inlineStr") {
      kind = "s";
      text = isMatch ? richText(isMatch[1]) : raw;
    } else if (t === "s") {
      kind = "s";
      text = shared[Number(raw)] ?? "";
    } else if (t === "str") {
      kind = "s";
      text = raw;
    } else if (t === "b") {
      kind = "b";
      text = raw === "1" ? "TRUE" : "FALSE";
    } else if (t === "e") {
      kind = "e";
      text = raw;
    } else if (t === "d") {
      kind = "s";
      text = raw;
    } else if (raw !== "") {
      const n = Number(raw);
      num = n;
      text = Number.isFinite(n) ? formatNumber(n, fmt) : raw;
    }

    if (fMatch && kind === "n") kind = "f";

    if (!raw && !fMatch) continue;

    const cell: Cell = {
      ref: numToCol(pos.col) + pos.row,
      row: pos.row,
      col: pos.col,
      text,
      kind,
      ...(num !== undefined ? { num } : {}),
      ...(fMatch ? { formula: unescapeXml(fMatch[2] ?? "") } : {}),
    };
    const key = cell.ref;
    cells.set(key, cell);
    if (pos.row > maxRow) maxRow = pos.row;
    if (pos.col > maxCol) maxCol = pos.col;
  }

  const merges: string[] = [];
  for (const m of xml.matchAll(/<mergeCell\b([^>]*)\/?>/g)) {
    const ref = attr(m[1], "ref");
    if (ref) merges.push(ref);
  }

  return { name: meta.name, index, state: meta.state, cells, merges, maxRow, maxCol };
}

export function readWorkbook(bytes: Uint8Array): Workbook {
  const files = readZip(bytes);
  const { sheets: metas, date1904 } = readSheetMetas(files);
  const shared = readSharedStrings(files);
  const styles = readStyles(files);
  const sheets: Sheet[] = [];
  metas.forEach((meta, i) => {
    const xml = readText(files, meta.path);
    if (xml == null) {
      sheets.push({ name: meta.name, index: i, state: meta.state, cells: new Map(), merges: [], maxRow: 0, maxCol: 0 });
      return;
    }
    sheets.push(readSheetXml(xml, shared, styles, meta, i));
  });
  return { sheets, date1904, names: metas.map((m) => m.name) };
}

/** Cheap sniff: does this look like an OOXML spreadsheet? */
export function isXlsx(bytes: Uint8Array): boolean {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false;
  // 'xl/workbook.xml' appears in the (uncompressed) local file headers
  const probe = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 1 << 16)));
  return probe.includes("xl/workbook.xml") || probe.includes("xl/worksheets/");
}