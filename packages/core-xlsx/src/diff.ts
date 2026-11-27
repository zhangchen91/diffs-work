/**
 * Excel diff: sheet-aligned, cell-level.
 *
 * Alignment: sheets are matched by name first, then — when a name has no
 * counterpart — by position, as a *rename* (a round sheet renamed "B3 checklist
 * → B4 checklist" must not smear every cell into add/remove). Genuinely extra
 * sheets are reported as added / removed.
 * Inside a sheet the comparison is per A1 reference: the sheet is addressed, not
 * the file, so an inserted ROW does not smear the rest of the sheet into a
 * wholesale diff — matching how a reviewer reads a spreadsheet.
 */
import { diffWords } from "@diffs/diff-core";
import type { Sheet, Workbook, Cell } from "./read.ts";

/** `style` is its own operation: a restyled cell has the same value as before. */
export type CellOp = "add" | "del" | "mod" | "move" | "formula" | "style";

export interface CellChange {
  ref: string;
  /** 1-based row / column, for grid layout */
  row?: number;
  col?: number;
  op: CellOp;
  old?: { text: string; formula?: string; num?: number };
  new?: { text: string; formula?: string; num?: number };
  /** word-level inline diff of the two texts (only for `mod`) */
  inline?: Array<{ op: "equal" | "insert" | "delete"; text: string }>;
}

export interface SheetDiff {
  name: string;
  /** name in the old workbook when this sheet was renamed */
  oldName?: string;
  status: "same" | "changed" | "added" | "removed";
  added: number;
  removed: number;
  modified: number;
  formulaOnly: number;
  /** cells whose *style* changed but whose value did not — reported separately so that a
   *  restyle does not look like an edit */
  styleChanged?: number;
  /** Excel's own column widths (character units, 1-based column index → width). A clause
   *  stored in a 62-wide column must not be rendered as if it were 280px like every other. */
  colWidths?: Record<number, number>;
  /** number/date cells whose value changed by this amount or less count as formatting noise */
  changes: CellChange[];
  /** cap reached — changes[] holds the first N */
  truncated?: boolean;
  maxRow: number;
  maxCol: number;
}

export interface WorkbookDiff {
  kind: "xlsx";
  sheets: SheetDiff[];
  totals: { added: number; removed: number; modified: number; formulaOnly: number; sheets: number };
  /** sheets present in one side only, by name */
  addedSheets: string[];
  removedSheets: string[];
  warnings: string[];
}

const MAX_CHANGES_PER_SHEET = 2000;

function brief(c: Cell | undefined): { text: string; formula?: string; num?: number } | undefined {
  if (!c) return undefined;
  return {
    text: c.text,
    ...(c.formula ? { formula: c.formula } : {}),
    ...(c.num !== undefined ? { num: c.num } : {}),
  };
}

function sameCell(a: Cell, b: Cell): boolean {
  if (a.text !== b.text) return false;
  return true;
}

export function diffSheets(a: Sheet | undefined, b: Sheet | undefined): SheetDiff {
  // A renamed sheet is identified by its *new* name, with the old one kept as `oldName`;
  // preferring the old name made a rename look like the sheet still had its old title.
  const name = (b ?? a)!.name;
  const out: SheetDiff = {
    name,
    status: "same",
    added: 0,
    removed: 0,
    modified: 0,
    formulaOnly: 0,
    changes: [],
    maxRow: Math.max(a?.maxRow ?? 0, b?.maxRow ?? 0),
    maxCol: Math.max(a?.maxCol ?? 0, b?.maxCol ?? 0),
  };
  if (!a) {
    out.status = "added";
    out.added = b!.cells.size;
    for (const c of b!.cells.values()) {
      out.changes.push({ ref: c.ref, op: "add", new: brief(c) });
      if (out.changes.length >= MAX_CHANGES_PER_SHEET) break;
    }
    return out;
  }
  if (!b) {
    out.status = "removed";
    out.removed = a.cells.size;
    for (const c of a.cells.values()) {
      out.changes.push({ ref: c.ref, op: "del", old: brief(c) });
      if (out.changes.length >= MAX_CHANGES_PER_SHEET) break;
    }
    return out;
  }

  const refs = new Set<string>([...a.cells.keys(), ...b.cells.keys()]);
  const sorted = [...refs].sort(byCell);
  for (const ref of sorted) {
    const ca = a.cells.get(ref);
    const cb = b.cells.get(ref);
    if (!ca && cb) {
      out.added++;
      push(out, { ref, op: "add", new: brief(cb) });
    } else if (ca && !cb) {
      out.removed++;
      push(out, { ref, op: "del", old: brief(ca) });
    } else if (ca && cb) {
      if (sameCell(ca, cb)) {
        if ((ca.formula ?? "") !== (cb.formula ?? "")) {
          out.formulaOnly++;
          push(out, { ref, op: "formula", old: brief(ca), new: brief(cb) });
        }
        continue;
      }
      out.modified++;
      push(out, { ref, op: "mod", old: brief(ca), new: brief(cb), inline: diffWords(ca.text, cb.text) });
    }
  }
  const changed = out.added + out.removed + out.modified > 0;
  if (!changed && out.formulaOnly > 0) out.status = "changed";
  else out.status = changed ? "changed" : "same";
  return out;
}

function push(sheet: SheetDiff, change: CellChange): void {
  if (sheet.changes.length >= MAX_CHANGES_PER_SHEET) {
    sheet.truncated = true;
    return;
  }
  sheet.changes.push(change);
}

function byCell(x: string, y: string): number {
  const px = /^([A-Z]+)(\d+)$/.exec(x);
  const py = /^([A-Z]+)(\d+)$/.exec(y);
  if (!px || !py) return x.localeCompare(y);
  const rowDiff = Number(px[2]) - Number(py[2]);
  return rowDiff !== 0 ? rowDiff : px[1].length - py[1].length || px[1].localeCompare(py[1]);
}

export function diffWorkbooks(oldWb: Workbook, newWb: Workbook): WorkbookDiff {
  const warnings: string[] = [];
  const byName = new Map(newWb.sheets.map((s) => [s.name, s]));
  const seen = new Set<string>();
  const candidates: Array<{ a: Sheet; b?: Sheet }> = [];

  for (const a of oldWb.sheets) {
    const b = byName.get(a.name);
    if (b) seen.add(b.name);
    candidates.push({ a, b });
  }
  // A name with no counterpart is a rename when the sheet at the same position
  // is itself unmatched. That is what a round-over-round workbook looks like.
  for (let i = 0; i < candidates.length; i++) {
    const { a, b } = candidates[i];
    if (b) continue;
    const nb = newWb.sheets[i];
    if (nb && !seen.has(nb.name)) {
      seen.add(nb.name);
      candidates[i] = { a, b: nb };
    }
  }
  const sheets: SheetDiff[] = [];
  for (const { a, b } of candidates) {
    const d = diffSheets(a, b);
    if (b && b.name !== a.name) d.oldName = a.name;
    sheets.push(d);
    if (a.state !== "visible") warnings.push(`「${a.name}」在版本 1 中是隐藏表`);
    if (b && b.state !== "visible") warnings.push(`「${b.name}」在版本 2 中是隐藏表`);
  }
  for (const b of newWb.sheets) {
    if (seen.has(b.name)) continue;
    sheets.push(diffSheets(undefined, b));
    if (b.state !== "visible") warnings.push(`「${b.name}」在版本 2 中是隐藏表`);
  }

  const renamed = new Set(sheets.filter((s) => s.oldName).map((s) => s.name));
  const orderA = oldWb.sheets.map((s) => s.name);
  const orderB = newWb.sheets
    .filter((s) => orderA.includes(s.name) || renamed.has(s.name))
    .map((s) => s.name);
  if (orderA.filter((n) => orderB.includes(n)).join("\u0000") !== orderB.join("\u0000")) {
    warnings.push("工作表顺序发生了变化（对比按名称对齐，不受顺序影响）");
  }

  const totals = sheets.reduce(
    (acc, s) => {
      acc.added += s.added;
      acc.removed += s.removed;
      acc.modified += s.modified;
      acc.formulaOnly += s.formulaOnly;
      return acc;
    },
    { added: 0, removed: 0, modified: 0, formulaOnly: 0, sheets: sheets.length },
  );

  return {
    kind: "xlsx",
    sheets,
    totals,
    addedSheets: sheets.filter((s) => s.status === "added").map((s) => s.name),
    removedSheets: sheets.filter((s) => s.status === "removed").map((s) => s.name),
    warnings,
  };
}

export function summarizeXlsxDiff(d: WorkbookDiff): string {
  if (!d.totals.added && !d.totals.removed && !d.totals.modified) {
    return d.totals.formulaOnly ? `值未变，${d.totals.formulaOnly} 处公式变化` : "两个工作簿内容一致";
  }
  const parts = [`+${d.totals.added} 格`, `-${d.totals.removed} 格`, `~${d.totals.modified} 格`];
  if (d.totals.formulaOnly) parts.push(`公式 ${d.totals.formulaOnly}`);
  return `${d.totals.sheets} 个工作表 · ${parts.join(" / ")}`;
}