/**
 * Per-engine output → the protocol. One function per engine, and nowhere else knows the
 * difference between `add` and `ins`.
 */
import { toOp, result, type Change, type DiffResult } from "./protocol";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** sem_diff / ast_diff: hunks on both sides, plus move targets. */
export function fromCode(raw: any, engine: string): DiffResult {
  const changes: Change[] = [];
  const before = new Map<string, any>();
  for (const h of raw.before?.hunks ?? []) {
    const k = `${h.range?.start_row}:${h.range?.start_column}`;
    before.set(k, h);
  }
  for (const h of raw.after?.hunks ?? []) {
    const op = toOp(String(h.operation));
    if (!op) continue;
    // A move is reported on both sides; take it from the new side only so it is counted once.
    const twinKey = h.reference_line === null || h.reference_line === undefined
      ? null
      : `${h.reference_line}:${h.range?.start_column}`;
    const twin = twinKey ? before.get(twinKey) : undefined;
    changes.push({
      ops: [op],
      container: "",
      where: `第 ${(h.range?.start_row ?? 0) + 1} 行`,
      before: twin?.text,
      after: h.text,
      ...(op === "move"
        ? { from: twin ? `第 ${(twin.range?.start_row ?? 0) + 1} 行` : undefined, to: `第 ${(h.range?.start_row ?? 0) + 1} 行` }
        : {}),
    });
  }
  return result(engine, "code", raw.summary ?? "", changes);
}

/** sheet_diff: one entry per sheet, each with a cell list. */
export function fromSheet(raw: any, engine: string): DiffResult {
  const changes: Change[] = [];
  for (const s of raw.sheets ?? []) {
    for (const c of s.diff?.changes ?? []) {
      const op = toOp(String(c.op));
      // Style-only changes are not content changes; the protocol leaves them to the renderer.
      if (!op || String(c.op) === "style") continue;
      changes.push({
        ops: [op],
        container: String(s.name ?? ""),
        where: String(c.ref ?? ""),
        before: c.old,
        after: c.new,
      });
    }
  }
  return result(engine, "sheet", raw.summary ?? "", changes);
}

/** opc_diff (Word / PowerPoint): paragraph and slide text. */
export function fromOpc(raw: any, engine: string): DiffResult {
  const changes: Change[] = [];
  for (const r of raw.revisions ?? []) {
    const op = toOp(String(r.kind));
    if (!op) continue;
    changes.push({
      ops: [op],
      container: String(r.part ?? ""),
      where: String(r.path ?? ""),
      before: r.old,
      after: r.new,
    });
  }
  return result(engine, "opc", raw.summary ?? "", changes);
}
