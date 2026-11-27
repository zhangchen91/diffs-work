import * as React from "react";

export type Family =
  | "docx" | "xlsx" | "pptx" | "pdf" | "markdown" | "code" | "text"
  /** a drawing: the elements carry ids and coordinates, so the view can name what moved */
  | "svg"
  /** tabular text: rows and columns, so a changed cell is named rather than a changed line */
  | "csv"
  /** .doc / .xls / .ppt: the pre-2007 binary formats, which this app cannot read */
  | "legacy-office";

export interface FormatMeta {
  id: Family;
  /** message key, translate with t() */
  label: string;
  exts: string[];
  /** message key, translate with t() */
  blurb: string;
  /** message key */
  engine: string;
  /** message key */
  engineSize: string;
  /** can we diff it, right now, with zero upload (text-family in this release) */
  live: boolean;
  accent: string;
}

export const FORMATS: FormatMeta[] = [
  {
    id: "markdown",
    label: "format.markdown.label",
    exts: [".md", ".mdx"],
    blurb: "formats.markdown.blurb",
    engine: "formats.engine.md",
    engineSize: "formats.size.md",
    live: true,
    accent: "#22d3ee",
  },
  {
    id: "csv",
    label: "format.csv.label",
    exts: [".csv", ".tsv"],
    blurb: "format.csv.blurb",
    engine: "diff (text)",
    engineSize: "formats.size.csv",
    live: true,
    accent: "#38bdf8",
  },
  {
    id: "svg",
      label: "format.svg.label",
      exts: [".svg"],
      blurb: "format.svg.blurb",
      engine: "diff (text)",
      engineSize: "formats.size.svg",
      live: true,
    accent: "#f472b6",
  },
  {
    id: "text",
    label: "format.text.label",
    exts: [".txt", ".csv", ".tsv", ".json", ".yml", ".xml", ".log"],
    blurb: "formats.text.blurb",
    engine: "text-core",
    engineSize: "formats.size.text",
    live: true,
    accent: "#a3e635",
  },
  {
    id: "code",
    label: "format.code.label",
    // The full set, matching the family table every surface uses. Listing nine made the tool look
    // like it only understood the most common languages.
    exts: [
      ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs",
      ".py", ".rs", ".go", ".java", ".kt", ".scala", ".cs", ".swift",
      ".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".hh", ".hxx",
      ".rb", ".php", ".lua", ".r", ".dart", ".sh", ".bash", ".sql",
      ".html", ".css", ".scss", ".vue",
    ],
    blurb: "formats.code.blurb",
    engine: "formats.engine.code",
    engineSize: "formats.size.code",
    live: true,
    accent: "#f472b6",
  },
  {
    id: "docx",
    label: "format.docx.label",
    exts: [".docx", ".doc", ".docm"],
    blurb: "formats.docx.blurb",
    engine: "diffs-engine.wasm",
    engineSize: "formats.size.docx",
    live: false,
    accent: "#60a5fa",
  },
  {
    id: "xlsx",
    label: "format.xlsx.label",
    // `.xls` is the old binary BIFF format, not a zip: the kernel answers "not a zip /
    // xlsx" for it. Listing it promised something the app cannot do.
    exts: [".xlsx", ".xlsm"],
    blurb: "formats.xlsx.blurb",
    engine: "formats.engine.xlsx",
    engineSize: "formats.size.xlsx",
    live: false,
    accent: "#34d399",
  },
  {
    id: "pptx",
    label: "format.pptx.label",
    exts: [".pptx", ".ppt"],
    blurb: "formats.pptx.blurb",
    engine: "formats.engine.pptx",
    engineSize: "formats.size.pptx",
    live: false,
    accent: "#fb923c",
  },
  {
    // Not shown on the formats page: this entry exists so formatMeta() can answer for the
    // pre-2007 binaries instead of falling back to an unrelated family.
    id: "legacy-office",
    label: "format.legacy.label",
    exts: [".doc", ".xls", ".ppt"],
    blurb: "format.legacy.blurb",
    engine: "—",
    engineSize: "—",
    live: false,
    accent: "#94a3b8",
  },
  {
    id: "pdf",
    label: "format.pdf.label",
    exts: [".pdf"],
    blurb: "formats.pdf.blurb",
    engine: "pdfjs + overlay.wasm",
    engineSize: "formats.size.pdf",
    live: false,
    accent: "#f87171",
  },
];

/** Families whose renderer is a separate engine, not the in-page text diff. */
export const NEEDS_ENGINE: Partial<Record<Family, true>> = {
  docx: true,
  xlsx: true,
  pdf: true,
  // pptx is handled by the shared opc_diff branch in run(), which returns before this table
  // is consulted; keeping it here only invited the "unsupported" panel to hide the result
};

export const EXT_TO_FAMILY: Record<string, Family> = {
  md: "markdown", markdown: "markdown", mdx: "markdown",
  txt: "text", log: "text", json: "text", jsonl: "text",
  csv: "csv", tsv: "csv",
  yml: "text", yaml: "text", xml: "text", ini: "text", cfg: "text", jsonc: "text",
  svg: "svg",
  ts: "code", tsx: "code", mts: "code", cts: "code",
  js: "code", jsx: "code", mjs: "code", cjs: "code",
  py: "code", pyi: "code", pyw: "code",
  rs: "code", go: "code", java: "code", kt: "code", kts: "code", scala: "code", cs: "code", swift: "code",
  c: "code", h: "code", cpp: "code", cc: "code", cxx: "code", hpp: "code", hh: "code", hxx: "code",
  rb: "code", php: "code", pl: "code", pm: "code", lua: "code", r: "code", dart: "code",
  sh: "code", bash: "code", zsh: "code", sql: "code", vue: "code", toml: "code",
  css: "code", scss: "code", sass: "code", less: "code", html: "code", htm: "code", xsd: "code", xsl: "code", plist: "code",
  docx: "docx", docm: "docx",
  // .doc / .xls / .ppt are OLE2/BIFF binaries. They used to be mapped to their OOXML family,
  // where the kernel opened them as a zip, found nothing and reported zero changes — the
  // most misleading answer possible. `legacy-office` lets the UI say what actually happened.
  doc: "legacy-office", xls: "legacy-office", ppt: "legacy-office",
  xlsx: "xlsx", xlsm: "xlsx",
  pptx: "pptx", pptm: "pptx",
  pdf: "pdf",
};

export function familyOf(name: string): Family {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_FAMILY[ext] ?? "text";
}

export function formatMeta(f: Family): FormatMeta {
  return FORMATS.find((x) => x.id === f) ?? FORMATS[1];
}