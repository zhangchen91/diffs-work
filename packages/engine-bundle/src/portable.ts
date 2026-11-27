/**
 * Portable diff result contract.
 *
 * Every engine (TS packages today, Rust wasm tomorrow) must produce this shape:
 * the UI only ever renders `PortableDiff`. That lets us swap the implementation
 * behind a file family without touching the viewer, and it keeps the wasm
 * closed-source surface tiny (input: two ArrayBuffers + options; output: JSON).
 */
import type { Hunk } from "../../diff-core/src/index";

export type DiffFamilyKind = "text" | "code" | "docx" | "pdf" | "xlsx" | "pptx";

export interface DiffSummary {
  added: number;
  removed: number;
  changed: number;
  /** 0..1 — how much of the document moved */
  ratio: number;
}

export interface PortableDiff {
  schema: "diffs.work/portable@1";
  kind: DiffFamilyKind;
  /** which engine produced it */
  engine: string;
  summary: DiffSummary;
  /** text/code only */
  hunks?: Hunk[];
  /** docx: per-revision list (docxodus rev view) */
  revisions?: Array<{ index: number; author: string; date: string; text: string }>;
  /** pdf: per-page overlay boxes */
  pages?: Array<{ index: number; changed: boolean; boxes: Array<{ x: number; y: number; w: number; h: number; op: "add" | "del" | "mod" }> }>;
  /** xlsx: per-sheet cell deltas */
  sheets?: Array<{ name: string; cells: Array<{ ref: string; op: "add" | "del" | "mod"; old?: string; new?: string }> }>;
  /** pptx: per-slide deltas */
  slides?: Array<{ index: number; changed: boolean; added: number; removed: number }>;
  /** engine free-form extras (rendered in the "raw" tab, never trusted as HTML) */
  raw?: unknown;
  warnings?: string[];
}

export function emptySummary(): DiffSummary {
  return { added: 0, removed: 0, changed: 0, ratio: 0 };
}