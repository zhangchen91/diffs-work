/**
 * Code diff with a small but real tokenizer: comments, strings, identifiers,
 * numbers and punctuation, so "changed a string literal" and "renamed a symbol"
 * are distinguishable. Declarations are extracted to list what moved at the
 * symbol level (the LSP-shaped part of the output).
 *
 * Not a full parser: no type resolution, no cross-file references. That is the
 * Rust engine's job; this module defines the shape and the tests.
 */
import { diffLines, buildHunks, type Hunk } from "@diffs/diff-core";
import { diffWords } from "@diffs/diff-core";

export type TokenKind = "comment" | "string" | "number" | "ident" | "punct";

export interface Token {
  kind: TokenKind;
  text: string;
}

const KEYWORDS = new Set([
  "export", "import", "from", "const", "let", "var", "function", "class", "interface", "type", "enum",
  "return", "if", "else", "for", "while", "do", "switch", "case", "break", "continue", "try", "catch",
  "finally", "throw", "new", "this", "super", "extends", "implements", "async", "await", "yield",
  "def", "fn", "pub", "struct", "impl", "use", "mod", "match", "func", "package", "public", "private",
  "static", "void", "namespace", "using", "template", "include", "then", "fi", "done", "select", "update",
]);

export interface Language {
  id: string;
  label: string;
  lineComment: string[];
  blockComment?: [string, string];
  quotes: string[];
}

export const LANGUAGES = {
  typescript: { id: "typescript", label: "TypeScript", lineComment: ["//"], blockComment: ["/*", "*/"], quotes: ['"', "'", "`"] },
  javascript: { id: "javascript", label: "JavaScript", lineComment: ["//"], blockComment: ["/*", "*/"], quotes: ['"', "'", "`"] },
  python: { id: "python", label: "Python", lineComment: ["#"], quotes: ['"', "'"] },
  rust: { id: "rust", label: "Rust", lineComment: ["//"], blockComment: ["/*", "*/"], quotes: ['"'] },
  go: { id: "go", label: "Go", lineComment: ["//"], blockComment: ["/*", "*/"], quotes: ['"', "`"] },
  java: { id: "java", label: "Java", lineComment: ["//"], blockComment: ["/*", "*/"], quotes: ['"'] },
  shell: { id: "shell", label: "Shell", lineComment: ["#"], quotes: ['"', "'"] },
  sql: { id: "sql", label: "SQL", lineComment: ["--"], blockComment: ["/*", "*/"], quotes: ["'", '"'] },
  css: { id: "css", label: "CSS", lineComment: [], blockComment: ["/*", "*/"], quotes: ['"', "'"] },
  html: { id: "html", label: "HTML", lineComment: [], blockComment: ["<!--", "-->"], quotes: ['"', "'"] },
  json: { id: "json", label: "JSON", lineComment: [], quotes: ['"'] },
  text: { id: "text", label: "Text", lineComment: [], quotes: [] },
} satisfies Record<string, Language>;

const EXT: Record<string, keyof typeof LANGUAGES> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  py: "python", rs: "rust", go: "go", java: "java", kt: "java", cs: "java",
  sh: "shell", bash: "shell", zsh: "shell", sql: "sql", css: "css",
  html: "html", htm: "html", vue: "html", json: "json", jsonc: "json",
};

export function languageOf(filename: string): Language {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return LANGUAGES[EXT[ext] ?? "text"];
}

/** Tokenize one line (comments and simple strings; multi-line strings are a known gap). */
export function tokenizeLine(line: string, lang: Language): Token[] {
  const out: Token[] = [];
  let i = 0;
  const push = (kind: TokenKind, text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind && kind !== "string") last.text += text;
    else out.push({ kind, text });
  };

  while (i < line.length) {
    const ch = line[i];

    const lc = lang.lineComment.find((c) => line.startsWith(c, i));
    if (lc) {
      out.push({ kind: "comment", text: line.slice(i) });
      break;
    }
    if (lang.blockComment && line.startsWith(lang.blockComment[0], i)) {
      const end = line.indexOf(lang.blockComment[1], i + lang.blockComment[0].length);
      const stop = end < 0 ? line.length : end + lang.blockComment[1].length;
      out.push({ kind: "comment", text: line.slice(i, stop) });
      i = stop;
      continue;
    }
    if (lang.quotes.includes(ch)) {
      let j = i + 1;
      while (j < line.length && line[j] !== ch) {
        if (line[j] === "\\") j++;
        j++;
      }
      push("string", line.slice(i, Math.min(j + 1, line.length)));
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < line.length && /[\w$]/.test(line[j])) j++;
      push("ident", line.slice(i, j));
      i = j;
      continue;
    }
    if (/\d/.test(ch)) {
      let j = i;
      while (j < line.length && /[\d._xXa-fA-F]/.test(line[j])) j++;
      push("number", line.slice(i, j));
      i = j;
      continue;
    }
    if (/\s/.test(ch)) {
      let j = i;
      while (j < line.length && /\s/.test(line[j])) j++;
      push("punct", line.slice(i, j));
      i = j;
      continue;
    }
    push("punct", ch);
    i++;
  }
  return out;
}

export interface Symbol {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "const" | "method" | "unknown";
  line: number;
  text: string;
}

const DECL = /(?:^|\s)(?:export\s+)?(?:default\s+)?(?:async\s+)?(function|class|interface|type|const|let|var|def|fn|struct|enum|impl|func)\s+([A-Za-z_$][\w$]*)/;

export function extractSymbols(lines: string[], lang: Language): Symbol[] {
  const out: Symbol[] = [];
  lines.forEach((line, i) => {
    const stripped = tokenizeLine(line, lang).filter((t) => t.kind !== "comment");
    const code = stripped.map((t) => t.text).join("");
    const m = DECL.exec(code);
    if (!m) return;
    const kw = m[1];
    const kind: Symbol["kind"] =
      kw === "class" ? "class"
        : kw === "interface" ? "interface"
          : kw === "type" ? "type"
            : kw === "function" || kw === "def" || kw === "fn" || kw === "func" ? "function"
              : kw === "const" || kw === "let" || kw === "var" ? "const"
                : "unknown";
    out.push({ name: m[2], kind, line: i + 1, text: line.trim().slice(0, 160) });
  });
  return out;
}

export interface CodeHunk extends Hunk {
  inline: Record<string, Array<{ op: "equal" | "insert" | "delete"; text: string }>>;
  /** per-line semantic label, e.g. comment-only or string-literal change */
  labels?: Record<number, string>;
}

export interface CodeDiffResult {
  kind: "code";
  language: string;
  hunks: CodeHunk[];
  added: number;
  removed: number;
  /** declarations whose text changed or disappeared */
  symbolsRemoved: Symbol[];
  symbolsAdded: Symbol[];
  symbolsChanged: Array<{ name: string; old: string; new: string }>;
  noise: { commentOnly: number; whitespaceOnly: number };
  summary: string;
}

/** Pair delete/insert runs, mark inline word diffs, and label comment-only edits. */
function enrich(hunks: Hunk[], lang: Language, oldLines: string[], newLines: string[]): { hunks: CodeHunk[]; noise: { commentOnly: number; whitespaceOnly: number } } {
  let commentOnly = 0;
  let whitespaceOnly = 0;
  const out: CodeHunk[] = hunks.map((h) => {
    const inline: CodeHunk["inline"] = {};
    const labels: Record<number, string> = {};
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
        const a = dels[k];
        const b = ins[k];
        inline[`${a.oldLine}:${b.newLine}`] = diffWords(a.text, b.text);
        const ta = tokenizeLine(a.text, lang);
        const tb = tokenizeLine(b.text, lang);
        const contentA = ta.filter((t) => t.kind !== "comment").map((t) => t.text).join("");
        const contentB = tb.filter((t) => t.kind !== "comment").map((t) => t.text).join("");
        if (a.text.trim() === b.text.trim()) {
          whitespaceOnly++;
          labels[b.newLine as number] = "仅空白/缩进";
        } else if (contentA === contentB) {
          commentOnly++;
          labels[b.newLine as number] = "仅注释";
        } else {
          const onlyStrings = ta.length === tb.length && ta.every((t, x) => t.kind === tb[x].kind) &&
            ta.filter((t) => t.kind !== "string").map((t) => t.text).join("") === tb.filter((t) => t.kind !== "string").map((t) => t.text).join("");
          if (onlyStrings) labels[b.newLine as number] = "仅字面量";
        }
      }
      for (let k = pairs; k < dels.length; k++) {
        const ta = tokenizeLine(dels[k].text, lang);
        if (ta.every((t) => t.kind === "comment" || !t.text.trim())) {
          commentOnly++;
          labels[dels[k].oldLine as number] = "仅注释";
        }
      }
      for (let k = pairs; k < ins.length; k++) {
        const tb = tokenizeLine(ins[k].text, lang);
        if (tb.every((t) => t.kind === "comment" || !t.text.trim())) {
          commentOnly++;
          labels[ins[k].newLine as number] = "仅注释";
        }
      }
    }
    void oldLines;
    void newLines;
    return { ...h, inline, labels };
  });
  return { hunks: out, noise: { commentOnly, whitespaceOnly } };
}

export function diffSource(oldSrc: string, newSrc: string, filename: string): CodeDiffResult {
  const lang = languageOf(filename);
  const a = oldSrc.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const b = newSrc.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const base = buildHunks(a, b);
  const { hunks, noise } = enrich(base, lang, a, b);

  const symA = extractSymbols(a, lang);
  const symB = extractSymbols(b, lang);
  const byNameA = new Map(symA.map((s) => [s.name, s]));
  const byNameB = new Map(symB.map((s) => [s.name, s]));
  const symbolsAdded = symB.filter((s) => !byNameA.has(s.name));
  const symbolsRemoved = symA.filter((s) => !byNameB.has(s.name));
  const symbolsChanged = symB
    .filter((s) => byNameA.has(s.name) && byNameA.get(s.name)!.text !== s.text)
    .map((s) => ({ name: s.name, old: byNameA.get(s.name)!.text, new: s.text }));

  let added = 0;
  let removed = 0;
  for (const h of hunks) for (const l of h.lines) (l.kind === "insert" ? added++ : l.kind === "delete" ? removed++ : 0);

  const summary = [
    `${hunks.length} 处差异`,
    `+${added}/-${removed}`,
    symbolsAdded.length ? `新增符号 ${symbolsAdded.map((s) => s.name).join(",")}` : "",
    symbolsRemoved.length ? `删除符号 ${symbolsRemoved.map((s) => s.name).join(",")}` : "",
    noise.commentOnly ? `仅注释 ${noise.commentOnly}` : "",
    noise.whitespaceOnly ? `仅空白 ${noise.whitespaceOnly}` : "",
  ].filter(Boolean).join(" · ");

  return {
    kind: "code",
    language: lang.id,
    hunks: hunks.map((h) => ({ ...h, inline: (h as CodeHunk).inline ?? {}, labels: (h as CodeHunk).labels })),
    added,
    removed,
    symbolsRemoved,
    symbolsAdded,
    symbolsChanged,
    noise,
    summary,
  };
}