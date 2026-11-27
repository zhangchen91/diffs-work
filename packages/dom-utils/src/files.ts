/**
 * `legacy-office` is the pre-2007 OLE2/BIFF binaries (.doc/.xls/.ppt). They are a family of their
 * own rather than a variant of docx: the OOXML reader cannot read them, and pretending otherwise
 * told a CLI user to "open the local viewer", where it also cannot be read.
 */
export type FileFamily = "docx" | "xlsx" | "pptx" | "pdf" | "markdown" | "text" | "code" | "svg" | "csv" | "legacy-office" | "unknown";

/**
 * The one table every surface consults: the website, the local site, the CLI, the Harness plugin
 * and the MCP server all reach the same family through here.
 *
 * Keep it equal to the language table in the docs. An extension missing from this record is
 * reported as `unknown` and the file never reaches the code view at all — which reads as "this
 * tool does not support Kotlin", not as "one list is short".
 */
const EXT_FAMILY: Record<string, FileFamily> = {
  // Kept equal to the website's EXT_TO_FAMILY: the site, the local viewer, the CLI, the
  // plugin and the extension must answer the same family for the same extension. They had
  // drifted — .doc read as docx here and as an unreadable binary on the site.
  // Markdown
  markdown: "markdown", md: "markdown", mdx: "markdown",
  // Plain text
  cfg: "text", ini: "text", json: "text", jsonc: "text", jsonl: "text", log: "text",
  txt: "text", xml: "text", yaml: "text", yml: "text",
  // Code
  bash: "code", c: "code", cc: "code", cjs: "code", cpp: "code", cs: "code", css: "code", cts: "code",
  cxx: "code", dart: "code", go: "code", h: "code", hh: "code", hpp: "code", htm: "code", html: "code",
  hxx: "code", java: "code", js: "code", jsx: "code", kt: "code", kts: "code", less: "code", lua: "code",
  mjs: "code", mts: "code", php: "code", pl: "code", plist: "code", pm: "code", py: "code", pyi: "code",
  pyw: "code", r: "code", rb: "code", rs: "code", sass: "code", scala: "code", scss: "code", sh: "code",
  csv: "csv", tsv: "csv",
  sql: "code", svg: "svg", swift: "code", toml: "code", ts: "code", tsx: "code", vue: "code", xsd: "code",
  xsl: "code", zsh: "code",
  // Word
  docm: "docx", docx: "docx",
  // Excel
  xlsm: "xlsx", xlsx: "xlsx",
  // PowerPoint
  pptm: "pptx", pptx: "pptx",
  // Pre-2007 binaries (unreadable)
  doc: "legacy-office", ppt: "legacy-office", xls: "legacy-office",
  // PDF
  pdf: "pdf",
};

export function extOf(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

export function familyOf(filename: string): FileFamily {
  // An unrecognised extension is plain text, not a refusal: that is what the site does, and a
  // `.zzz` file was "comparable" in the browser and "needs a WASM renderer" in the CLI. Falling
  // back to text is also the only answer that can be wrong for at most one file.
  return EXT_FAMILY[extOf(filename)] ?? "text";
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** The 4 families that need a heavy renderer — everything else is text-family. */
export function needsBinaryEngine(family: FileFamily): boolean {
  return family === "docx" || family === "xlsx" || family === "pptx" || family === "pdf";
}

export function engineFor(family: FileFamily): string | null {
  switch (family) {
    case "docx":
      return "docxodus";
    case "xlsx":
      return "exceljs";
    case "pdf":
      return "pdfjs";
    case "pptx":
      return "office-x2t";
    default:
      return null;
  }
}