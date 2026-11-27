export interface EnginePlanRow {
  id: string;
  status: "ready" | "lazy" | "planned";
  size: string;
  note: string;
  files: Array<{ path: string; size: string }>;
}

export const ENGINE_PLAN: EnginePlanRow[] = [
  {
    id: "text-core.wasm",
    status: "ready",
    size: "〜40 KB",
    note: ".md / .txt / .csv / .json / .yml — 行级 diff + 词级内联高亮，首页即可用（当前由开源的 TS 参考实现提供，Rust 版做对拍）。",
    files: [{ path: "text-core.wasm", size: "40 KB" }],
  },
  {
    id: "code-core.wasm",
    status: "ready",
    size: "〜120 KB",
    note: "源码文件 — 语言识别、符号级增量，PR 视角摘要。",
    files: [{ path: "code-core.wasm", size: "120 KB" }],
  },
  {
    id: "pdfjs + overlay.wasm",
    status: "lazy",
    size: "〜1.8 MB",
    note: ".pdf — pdf.js 渲染 + 差异框；扫描件走 tesseract 的 chi_sim / eng 语言包（用到哪页拉哪页）。",
    files: [
      { path: "pdf.mjs", size: "0.4 MB" },
      { path: "pdf.worker.min.mjs", size: "1.4 MB" },
      { path: "overlay.wasm", size: "按需" },
      { path: "tessdata/chi_sim", size: "2.3 MB" },
    ],
  },
  {
    id: "docxodus.wasm",
    status: "lazy",
    size: "〜30 MB · 分片",
    note: ".docx — OOXML 修订视图；30MB 包体由 80+ 个 .NET 程序集组成，浏览器只拉实际调用的那些。",
    files: [
      { path: "embed.bundle.js", size: "0.45 MB" },
      { path: "Docxodus.wasm", size: "4.9 MB" },
      { path: "DocumentFormat.OpenXml.wasm", size: "5.2 MB" },
      { path: "dotnet.js", size: "按需" },
    ],
  },
  {
    id: "exceljs.js + cell-diff.wasm",
    status: "lazy",
    size: "〜0.9 MB",
    note: ".xlsx — 单元格级对齐；公式、数字格式、合并单元格单独比较。",
    files: [
      { path: "exceljs.min.js", size: "0.9 MB" },
      { path: "cell-diff.wasm", size: "按需" },
    ],
  },
  {
    id: "office-x2t.wasm",
    status: "lazy",
    size: "〜9 MB",
    note: ".pptx / .ppt / .doc 老格式 — 先用转换器标准化，再走对应的族。",
    files: [{ path: "x2t.wasm", size: "9 MB" }],
  },
];