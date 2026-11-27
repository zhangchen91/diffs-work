export interface EnginePlanRow {
  id: string;
  status: "ready" | "lazy" | "planned";
  size: string;
  /** message key */
  note: string;
  files: Array<{ path: string; size: string }>;
}

export const ENGINE_PLAN: EnginePlanRow[] = [
  {
    id: "text-core.wasm",
    status: "ready",
    size: "〜40 KB",
    note: "engine.text.note",
    files: [{ path: "text-core.wasm", size: "40 KB" }],
  },
  {
    id: "code-core.wasm",
    status: "ready",
    size: "〜120 KB",
    note: "engine.code.note",
    files: [{ path: "code-core.wasm", size: "120 KB" }],
  },
  {
    id: "pdfjs + overlay.wasm",
    status: "lazy",
    size: "〜1.8 MB",
    note: "engine.pdf.note",
    files: [
      { path: "pdf.mjs", size: "0.4 MB" },
      { path: "pdf.worker.min.mjs", size: "1.4 MB" },
      // `tessdata` used to be listed here. No code path loads it — OCR is not implemented — and
      // listing a 2.3 MB model that is never fetched overstates both the download and the
      // capability.
      { path: "overlay.wasm", size: "engine.size.lazy" },
    ],
  },
  {
    // Word used to be rendered by docxodus (~30 MB of .NET wasm) to turn two files into an
    // edited document. Reviewing two versions needs the paragraphs in order with the changes
    // marked, which our own kernel reads straight out of the OOXML parts: 0 bytes of engine
    // download beyond the one every family already shares.
    id: "diffs-engine.wasm (Word)",
    status: "ready",
    size: "engine.size.inline",
    note: "engine.docx.note",
    files: [{ path: "diffs-engine.wasm", size: "engine.size.inline" }],
  },
  {
    id: "exceljs.js + cell-diff.wasm",
    status: "lazy",
    size: "〜0.9 MB",
    note: "engine.xlsx.note",
    files: [
      { path: "exceljs.min.js", size: "0.9 MB" },
      { path: "cell-diff.wasm", size: "engine.size.lazy" },
    ],
  },
  // An `office-x2t.wasm` (9 MB) entry used to sit here. No such artifact ships and nothing
  // loads it: slides are read straight out of the OOXML by the kernel, the same way Word is.
  // Listing a 9 MB engine that never downloads overstates both the weight and the machinery.
];