/**
 * Which view to render for a comparison, and how.
 *
 * This block existed twice — once in the website's studio and once in the local viewer's — and the
 * copies disagreed: the local one had no PDF branch, no Word or slides, no syntax view and no
 * mode switch, so the same pair looked different depending on which app showed it. It is one
 * component now, and each app decides only what data to hand it.
 */
import * as React from "react";
import { HunkView } from "./hunk-view";
import { RichHunkView, type RichHunk } from "./hunk-view";
import { XlsxDiffView } from "./xlsx-view";
import { PdfDiffView } from "./pdf-view";
import { DocxFlowView } from "./docx-flow";
import { PptxDeckView } from "./pptx-deck";
import { SemanticDiffView, type SemDiffResult, type SemMove } from "./semantic-view";
import { AstDiffView, type AstDiffResult } from "./ast-view";
import { OpcRevisionList } from "./rust-views";
import { rustToHunks } from "./rust-views";
import type { CodeFromRust, OpcFromRust } from "./rust-types";
import type { PdfDiff } from "@diffs/core-pdf";
import type { WorkbookDiff } from "@diffs/core-xlsx";
import { cn } from "../lib/cn";

export type ViewMode = "semantic" | "ast" | "unified";

/** after-side line number → the move block that placed it there */
export function moveIndex(moves: SemMove[]): Map<number, SemMove> {
  const m = new Map<number, SemMove>();
  for (const b of moves ?? []) for (let n = b.toStart; n <= b.toEnd; n += 1) m.set(n, b);
  return m;
}

export interface DiffPaneProps {
  runId: number;
  mode: ViewMode;
  /** old and new side by side */
  twoPane: boolean;
  /** the fixed-height frame that page-based viewers need */
  needsPaneFrame: boolean;
  file?: string;

  sem?: SemDiffResult | null;
  ast?: AstDiffResult | null;
  rust?: CodeFromRust | null;
  /** the TypeScript line diff, when no kernel result exists */
  result?: unknown;
  code?: { hunks: RichHunk[] } | null;
  markdown?: { hunks: RichHunk[] } | null;
  xlsx?: { diff: WorkbookDiff } | null;
  pdf?: PdfDiff | null;
  opc?: { kind: "docx" | "pptx"; result: OpcFromRust } | null;
  isDocx?: boolean;
  oldBytes?: ArrayBuffer;
  newBytes?: ArrayBuffer;
  beforeText?: string;
  afterText?: string;
  /** an older renderer for markdown/code that carries its own hunks */
  rich?: {
    kind: "code" | "markdown";
    name?: string;
    rust?: CodeFromRust | null;
    code?: { hunks: RichHunk[] } | null;
    md?: { hunks: RichHunk[] } | null;
  } | null;
}

export function DiffPane(p: DiffPaneProps): React.ReactElement {
  const sem = p.sem ?? null;
  const ast = p.ast ?? null;
  const opc = p.opc ?? null;
  return (
    <div className={cn("bg-panel/40", p.needsPaneFrame ? "h-[520px]" : "max-h-[70vh]")}>
      <div className={cn("flex min-h-0", p.needsPaneFrame ? "h-full" : "")}>
        <div className="min-w-0 flex-1 overflow-auto">
          {p.mode === "unified" && p.rich?.kind === "code" && p.rich.rust ? (
            <RichHunkView key={`u-${p.runId}`} hunks={rustToHunks(p.rich.rust)} doc="code" file={p.rich.name ?? ""} />
          ) : p.mode === "unified" && p.rich?.kind === "code" && p.rich.code ? (
            <RichHunkView key={`u-${p.runId}`} hunks={p.rich.code.hunks} doc="code" file={p.rich.name ?? ""} />
          ) : p.mode === "unified" && p.rich?.kind === "markdown" && p.rich.md ? (
            <RichHunkView key={`u-${p.runId}`} hunks={p.rich.md.hunks} doc="md" />
          ) : ast && p.mode === "ast" && p.beforeText && p.afterText ? (
            <AstDiffView result={ast} beforeText={p.beforeText} afterText={p.afterText} />
          ) : sem && p.mode === "semantic" ? (
            <SemanticDiffView
              key={`sem-${p.runId}`}
              result={sem}
              moveToLine={moveIndex(sem.moveBlocks)}
              file={p.file ?? ""}
              split={p.twoPane}
            />
          ) : p.pdf && p.oldBytes && p.newBytes ? (
            <PdfDiffView key={p.runId} diff={p.pdf} oldBytes={p.oldBytes} newBytes={p.newBytes} sideBySide={p.twoPane} />
          ) : p.isDocx && opc ? (
            // Built from the kernel's own revision list; the editor-grade renderer that used to
            // sit here weighed 31 MB to lay out pages, and reviewing two versions only needs the
            // paragraphs in order with the changes marked.
            <DocxFlowView
              split={p.twoPane}
              changes={opc.result.revisions as never}
              paragraphs={(opc.result as { paragraphs?: string[] }).paragraphs ?? []}
              oldParagraphs={(opc.result as { oldParagraphs?: string[] }).oldParagraphs ?? []}
            />
          ) : opc && opc.kind === "pptx" ? (
            <PptxDeckView
              sideBySide={p.twoPane}
              revisions={opc.result.revisions as never}
              slides={(opc.result as { slides?: number }).slides ?? 0}
              containers={(opc.result as { containers?: never }).containers ?? []}
            />
          ) : opc ? (
            <OpcRevisionList result={opc.result} />
          ) : p.xlsx ? (
            <XlsxDiffView key={p.runId} diff={p.xlsx.diff} />
          ) : p.rust ? (
            <RichHunkView key={p.runId} hunks={rustToHunks(p.rust)} doc="code" file={p.file ?? ""} />
          ) : p.result ? (
            <HunkView result={p.result as never} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
