import { buildHunks, diffWords, stats, type Hunk } from "@diffs/diff-core";

export interface TextDiffResult {
  kind: "text" | "code";
  hunks: Hunk[];
  added: number;
  removed: number;
  oldLines: number;
  newLines: number;
  /** per row inline word diff, keyed by `${oldLine}:${newLine}` — only for paired rows */
  inline: Record<string, Array<{ op: "equal" | "insert" | "delete"; text: string }>>;
}

const LANG_BY_EXT: Record<string, string> = {
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  txt: "text",
  log: "text",
  csv: "csv",
  tsv: "tsv",
  json: "json",
  jsonl: "json",
  yaml: "yaml",
  yml: "yaml",
  xml: "xml",
  html: "html",
  htm: "html",
  css: "css",
  toml: "toml",
  ini: "ini",
  sql: "sql",
};

export function normalizeText(input: string): string[] {
  return input
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
}

/** Pair up consecutive delete/insert runs so we can highlight word level changes. */
export function pairInline(hunks: Hunk[]): TextDiffResult["inline"] {
  const inline: TextDiffResult["inline"] = {};
  for (const h of hunks) {
    let i = 0;
    while (i < h.lines.length) {
      if (h.lines[i].kind !== "delete") {
        i++;
        continue;
      }
      const dels: typeof h.lines = [];
      while (i < h.lines.length && h.lines[i].kind === "delete") dels.push(h.lines[i++]);
      const ins: typeof h.lines = [];
      while (i < h.lines.length && h.lines[i].kind === "insert") ins.push(h.lines[i++]);
      const pairs = Math.min(dels.length, ins.length);
      for (let k = 0; k < pairs; k++) {
        inline[`${dels[k].oldLine}:${ins[k].newLine}`] = diffWords(dels[k].text, ins[k].text);
      }
    }
  }
  return inline;
}

export function diffText(oldText: string, newText: string, context?: number): TextDiffResult {
  const a = normalizeText(oldText);
  const b = normalizeText(newText);
  const hunks = context === undefined ? buildHunks(a, b) : buildHunks(a, b, context);
  const s = stats(hunks);
  return {
    kind: "text",
    hunks,
    added: s.added,
    removed: s.removed,
    oldLines: a.length,
    newLines: b.length,
    inline: pairInline(hunks),
  };
}

export function languageOf(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return LANG_BY_EXT[ext] ?? "text";
}

export { stats };

export { charDiff, type CharSeg } from "./char-diff.ts";
