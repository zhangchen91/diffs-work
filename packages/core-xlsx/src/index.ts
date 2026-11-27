import { readWorkbook, isXlsx, type Workbook } from "./read.ts";
import { diffWorkbooks, summarizeXlsxDiff, type WorkbookDiff } from "./diff.ts";

export * from "./read.ts";
export * from "./diff.ts";
export * from "./zip.ts";

/** Read + compare two xlsx files in one call (the shape the UI and tools use). */
export function compareXlsx(oldBytes: Uint8Array, newBytes: Uint8Array): { oldWb: Workbook; newWb: Workbook; diff: WorkbookDiff; summary: string } {
  const oldWb = readWorkbook(oldBytes);
  const newWb = readWorkbook(newBytes);
  const diff = diffWorkbooks(oldWb, newWb);
  return { oldWb, newWb, diff, summary: summarizeXlsxDiff(diff) };
}

export { isXlsx };