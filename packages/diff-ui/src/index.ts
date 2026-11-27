/**
 * Every diff view, in one place.
 *
 * The website and the local viewer each used to carry their own copy of these components. They
 * drifted — the local copy of `hunk-view` was 67 lines shorter and had lost syntax highlighting
 * entirely, so the same comparison looked different depending on which app showed it, and every
 * fix had to be made twice. This package is the one implementation.
 */
export { DiffPane, moveIndex, type DiffPaneProps, type ViewMode } from "./views/diff-pane";
export { RichHunkView, HunkView, type RichHunk } from "./views/hunk-view";
export { CodeLine, highlightLines } from "./views/code-line";
export { XlsxDiffView } from "./views/xlsx-view";
export { PdfDiffView } from "./views/pdf-view";
export { DocxFlowView } from "./views/docx-flow";
export { DocxSplitView } from "./views/docx-split";
export { PptxDeckView } from "./views/pptx-deck";
export { SemanticDiffView, type SemDiffResult, type SemMove } from "./views/semantic-view";
export { SemanticSplitView, type SplitLine } from "./views/semantic-split";
export { AstDiffView, type AstDiffResult } from "./views/ast-view";
export { DiffRuler, rulerMarksFrom } from "./views/diff-ruler";
export { UnsupportedPanel } from "./views/unsupported-panel";
export { rustToHunks, OpcRevisionList } from "./views/rust-views";
export type { CodeFromRust, OpcFromRust } from "./views/rust-types";
export { FORMATS, EXT_TO_FAMILY, NEEDS_ENGINE, familyOf, formatMeta, type Family, type FormatMeta } from "./lib/formats";
export { REGION_TONE, REGION_TONE_TEXT, MARK_TONE, MARK_TONE_DARK } from "./lib/revision-tone";
export { highlightSided } from "./lib/highlight";
export { cn } from "./lib/cn";
export { laneFor, kernelCalls, type CompareLane, type CompareTarget } from "./lib/lanes";
export { runComparison, type ComparisonResult, type ComparisonSlots, type Kernel } from "./lib/run-comparison";
export { rustSheetToWorkbook, type RustSheetDiff } from "./lib/rust-sheet";
