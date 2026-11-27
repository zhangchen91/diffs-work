/**
 * The kernel's spreadsheet result, adapted to the viewer's model.
 *
 * Lived in the website's studio only, so the local viewer had no choice but the TypeScript reader —
 * slower, and missing the facts only the kernel collects (formula-only changes, column widths).
 * Moved here so both surfaces can prefer the kernel and fall back to the reader.
 */
import type { WorkbookDiff } from "@diffs/core-xlsx";

export interface RustSheetDiff {
  engine: string;
  summary?: string;
  added?: number;
  removed?: number;
  modified?: number;
  sheets: Array<{
    name: string;
    oldName?: string | null;
    colWidths?: Array<{ c: string; w: number }>;
    diff: {
      added: number;
      removed: number;
      modified: number;
      styleChanged?: number;
      formulaChanged?: number;
      changes?: Array<{
        ref: string;
        op: string;
        old?: string;
        new?: string;
        oldFormula?: string;
        newFormula?: string;
        oldStyle?: string;
        newStyle?: string;
        segments?: Array<{ op: string; text: string }>;
      }>;
    };
  }>;
}

/** Map the kernel's cell list onto the viewer's WorkbookDiff. */
export function rustSheetToWorkbook(r: RustSheetDiff): WorkbookDiff {
  const sheets = r.sheets.map((s) => {
    const changes = (s.diff.changes || []).map((c) => ({
      ref: c.ref,
      op: (c.op === "formula" ? "formula" : c.op) as never,
      old: c.old !== undefined || c.oldFormula || c.oldStyle ? { text: c.old ?? c.oldFormula ?? "", formula: c.oldFormula } : undefined,
      new: c.new !== undefined || c.newFormula || c.newStyle ? { text: c.new ?? c.newFormula ?? "", formula: c.newFormula } : undefined,
      ...(c.op === "style" && c.oldStyle
        ? { inline: [{ op: "delete" as const, text: c.oldStyle }, { op: "insert" as const, text: `→ ${c.newStyle ?? ""}` }] }
        : {}),
      ...(c.segments?.length
        ? {
            inline: c.segments.map((x) => ({
              op: (x.op === "ins" ? "insert" : x.op === "del" ? "delete" : "equal") as "insert" | "delete" | "equal",
              text: x.text,
            })),
          }
        : {}),
    }));
    return {
      name: s.name,
      oldName: s.oldName && s.oldName !== s.name ? s.oldName : undefined,
      status: s.diff.added + s.diff.removed + s.diff.modified > 0 ? "changed" : "same",
      added: s.diff.added,
      removed: s.diff.removed,
      modified: s.diff.modified,
      styleChanged: s.diff.styleChanged || 0,
      colWidths: Object.fromEntries((s.colWidths ?? []).map((x) => [x.c, x.w])),
      formulaOnly: s.diff.formulaChanged || 0,
      changes: changes as never,
      maxRow: 0,
      maxCol: 0,
      warnings: [],
    };
  });
  // `WorkbookDiff` needs more than `sheets`: the view reads `totals` for its header and
  // `addedSheets` for its list. The first version returned only `{ kind, sheets }`, which did not
  // fail — it blanked the page, because the view threw while reading a field that was not there.
  const totals = sheets.reduce(
    (t, s) => ({
      added: t.added + s.added,
      removed: t.removed + s.removed,
      modified: t.modified + s.modified,
      formulaOnly: t.formulaOnly + (s.formulaOnly ?? 0),
      sheets: t.sheets + 1,
    }),
    { added: 0, removed: 0, modified: 0, formulaOnly: 0, sheets: 0 },
  );
  const names = new Set(sheets.map((s) => s.name));
  return {
    kind: "xlsx",
    sheets,
    totals,
    addedSheets: sheets.filter((s) => s.oldName === undefined && s.status === "changed").map((s) => s.name),
    removedSheets: [],
    warnings: r.summary ? [] : [],
  } as unknown as WorkbookDiff;
}
