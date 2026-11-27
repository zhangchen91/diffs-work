import { diffText, normalizeText, type TextDiffResult } from "@diffs/core-text";

export interface CodeLanguage {
  id: string;
  label: string;
  /** line comment prefixes — used for comment-aware noise filtering */
  comments: string[];
  /** keywords used by the lightweight structural tokenizer */
  keywords: string[];
}

export const LANGUAGES: Record<string, CodeLanguage> = {
  ts: { id: "typescript", label: "TypeScript", comments: ["//", "/*"], keywords: ["export", "import", "const", "let", "function", "class", "interface", "type", "return", "async", "await", "if", "else", "for", "while"] },
  tsx: { id: "tsx", label: "TSX", comments: ["//", "/*"], keywords: ["export", "import", "const", "function", "return", "useState", "useEffect"] },
  js: { id: "javascript", label: "JavaScript", comments: ["//", "/*"], keywords: ["export", "import", "const", "let", "function", "class", "return", "async", "await"] },
  jsx: { id: "jsx", label: "JSX", comments: ["//", "/*"], keywords: ["export", "import", "const", "return"] },
  py: { id: "python", label: "Python", comments: ["#"], keywords: ["def", "class", "import", "from", "return", "async", "await", "if", "elif", "else", "for", "while", "in", "not", "and", "or", "is", "None", "True", "False", "try", "except", "finally", "raise", "with", "as", "pass", "lambda", "yield", "global", "nonlocal", "assert", "del", "break", "continue"] },
  rs: { id: "rust", label: "Rust", comments: ["//", "/*"], keywords: ["fn", "struct", "enum", "impl", "pub", "use", "let", "mut", "match", "return"] },
  go: { id: "go", label: "Go", comments: ["//", "/*"], keywords: ["func", "package", "import", "type", "struct", "return", "if", "for", "defer"] },
  java: { id: "java", label: "Java", comments: ["//", "/*"], keywords: ["public", "class", "private", "static", "void", "return", "import", "package"] },
  cs: { id: "csharp", label: "C#", comments: ["//", "/*"], keywords: ["public", "class", "private", "static", "void", "return", "using", "namespace"] },
  c: { id: "c", label: "C", comments: ["//", "/*"], keywords: ["include", "int", "void", "return", "struct", "static"] },
  cpp: { id: "cpp", label: "C++", comments: ["//", "/*"], keywords: ["include", "int", "void", "return", "class", "namespace", "template"] },
  sh: { id: "shell", label: "Shell", comments: ["#"], keywords: ["if", "then", "else", "fi", "for", "do", "done", "function", "export"] },
  sql: { id: "sql", label: "SQL", comments: ["--"], keywords: ["select", "from", "where", "join", "group", "order", "insert", "update", "delete"] },
  vue: { id: "vue", label: "Vue", comments: ["//", "<!--"], keywords: ["template", "script", "style", "export", "default"] },
  toml: { id: "toml", label: "TOML", comments: ["#"], keywords: ["[package]", "[dependencies]"] },
  yaml: { id: "yaml", label: "YAML", comments: ["#"], keywords: [] },
  json: { id: "json", label: "JSON", comments: [], keywords: [] },
  css: { id: "css", label: "CSS", comments: ["/*"], keywords: [] },
  html: { id: "html", label: "HTML", comments: ["<!--"], keywords: [] },

  // The docs promise these, so they must exist: a file the table does not know is reported as
  // "unknown" and never reaches the code view at all.
  kt: { id: "kotlin", label: "Kotlin", comments: ["//", "/*"], keywords: ["fun", "val", "var", "class", "object", "import", "return", "when", "if", "else"] },
  scala: { id: "scala", label: "Scala", comments: ["//", "/*"], keywords: ["def", "val", "var", "class", "object", "import", "return", "match", "case"] },
  swift: { id: "swift", label: "Swift", comments: ["//", "/*"], keywords: ["func", "var", "let", "class", "struct", "enum", "import", "return", "guard"] },
  lua: { id: "lua", label: "Lua", comments: ["--"], keywords: ["function", "local", "end", "if", "then", "else", "return", "for", "while"] },
  rb: { id: "ruby", label: "Ruby", comments: ["#"], keywords: ["def", "class", "module", "end", "if", "else", "return", "require"] },
  php: { id: "php", label: "PHP", comments: ["//", "#", "/*"], keywords: ["function", "class", "public", "private", "return", "namespace", "use"] },
  pl: { id: "perl", label: "Perl", comments: ["#"], keywords: ["sub", "my", "our", "use", "package", "return"] },
  r: { id: "r", label: "R", comments: ["#"], keywords: ["function", "if", "else", "for", "while", "return", "library"] },
  dart: { id: "dart", label: "Dart", comments: ["//", "/*"], keywords: ["class", "void", "final", "var", "import", "return", "async", "await"] },
  scss: { id: "scss", label: "SCSS", comments: ["//", "/*"], keywords: [] },
  xml: { id: "xml", label: "XML", comments: ["<!--"], keywords: [] },
};

const BY_EXT: Record<string, string> = {
  ts: "ts", tsx: "tsx", mts: "ts", cts: "ts",
  js: "js", jsx: "jsx", mjs: "js", cjs: "js",
  py: "py", pyi: "py", pyw: "py",
  rs: "rs", go: "go", java: "java", cs: "cs",
  c: "c", h: "c", cpp: "cpp", cc: "cpp", hpp: "cpp", cxx: "cpp", hh: "cpp", hxx: "cpp",
  kt: "kt", kts: "kt", scala: "scala", swift: "swift",
  lua: "lua", rb: "rb", php: "php", pl: "pl", pm: "pl", r: "r", dart: "dart",
  sh: "sh", bash: "sh", zsh: "sh",
  sql: "sql", vue: "vue", toml: "toml",
  yml: "yaml", yaml: "yaml", json: "json",
  css: "css", scss: "scss", sass: "scss", less: "scss", html: "html", htm: "html",
  xml: "xml", xsd: "xml", xsl: "xml", plist: "xml", svg: "xml", rss: "xml", atom: "xml",
};

export function detectLanguage(filename: string): CodeLanguage {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return LANGUAGES[BY_EXT[ext] ?? "ts"] ?? LANGUAGES.ts;
}

export interface CodeDiffResult extends TextDiffResult {
  language: string;
  symbols: { removed: string[]; added: string[] };
}

const DECL = /(?:^|\s)(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|def|fn|struct|enum|impl|func)\s+([A-Za-z_$][\w$]*)/;

/** very small "what changed structurally" extractor — the wasm engine implements the full LSP-grade version */
export function extractSymbols(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const m = DECL.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

export function diffCode(oldCode: string, newCode: string, filename = "file.ts", context?: number): CodeDiffResult {
  const base = diffText(oldCode, newCode, context);
  const lang = detectLanguage(filename);
  const removedLines: string[] = [];
  const addedLines: string[] = [];
  for (const h of base.hunks) {
    for (const l of h.lines) {
      if (l.kind === "delete") removedLines.push(l.text);
      if (l.kind === "insert") addedLines.push(l.text);
    }
  }
  return {
    ...base,
    kind: "code",
    language: lang.id,
    symbols: {
      removed: extractSymbols(removedLines),
      added: extractSymbols(addedLines),
    },
  };
}

/** count "noise" lines (comments, whitespace-only) — useful for review summaries */
export function noiseRatio(text: string, filename = "file.ts"): number {
  const lang = detectLanguage(filename);
  const lines = normalizeText(text);
  if (!lines.length) return 0;
  let noise = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) noise++;
    else if (lang.comments.some((c) => line.startsWith(c))) noise++;
  }
  return noise / lines.length;
}

export { diffText, normalizeText };