/**
 * Where a comparison's changes sit, as positions on a 0..1 axis.
 *
 * Split out of `diff-ruler.tsx` so a surface without JSX — the DSH plugin's client bundle, which
 * builds a tree by hand — can compute the marks without pulling a React component into its
 * TypeScript project. The drawing stays in the view.
 */

/** One mark: where it is, and what happened there. */
export interface RulerMark {
  /** 0..1 position along the document. */
  at: number;
  kind: "add" | "del" | "mod" | "move";
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