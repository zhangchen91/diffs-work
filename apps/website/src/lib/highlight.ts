/**
 * A small syntax highlighter for the code views.
 *
 * Not a parser: it colours three things — comments, string literals and keywords — from the same
 * language table `@diffs/core-code` already keeps. That is enough to make a diff scannable (the
 * eye finds strings and comments instantly) without shipping a grammar per language, which at
 * forty-odd extensions would be hundreds of kilobytes on the first screen.
 *
 * It never changes the text: every span concatenated in order is exactly the input line.
 */
import { detectLanguage, LANGUAGES } from "@diffs/core-code";

type Kind = "comment" | "string" | "keyword";
export interface Token {
  text: string;
  kind: Kind | null;
}

/** Words that are keywords in nearly every language here. */
const COMMON = new Set([
  "if", "else", "for", "while", "return", "function", "class", "const", "let", "var",
  "import", "export", "from", "new", "try", "catch", "throw", "switch", "case", "break",
  "continue", "true", "false", "null", "undefined", "async", "await", "yield",
]);

/**
 * Split one line into coloured tokens.
 *
 * @param line   the source line
 * @param filename used to pick the language (keywords, comment markers)
 * @param inBlockComment whether the previous line ended inside `/* … *\/`; returned so a block
 *   comment that spans lines stays coloured on every line
 */
export function highlight(
  line: string,
  filename: string,
  inBlockComment = false,
  /**
   * A quote character that was still open at the end of the previous line: `"""` in Python,
   * `` ` `` in a template literal. Python docstrings and multi-line templates are ordinary code,
   * and without this the body of a docstring was rendered as plain text while the opening line
   * got two empty string spans.
   */
  openQuote: string | null = null,
): { tokens: Token[]; inBlockComment: boolean; openQuote: string | null } {
  const lang = detectLanguage(filename) ?? LANGUAGES.ts;
  // The language table is authoritative. `COMMON` is only a fallback for a family the tables know
  // nothing about — merging it in unconditionally painted `const` and `let` as keywords in a
  // Python file, which is worse than no colour at all: it asserts something false.
  const keywords = new Set(lang?.keywords?.length ? lang.keywords : COMMON);
  const lineComment = lang?.comments.find((c) => c !== "/*") ?? null;
  const hasBlock = (lang?.comments ?? []).includes("/*");

  const tokens: Token[] = [];
  let buf = "";
  let i = 0;
  let block = inBlockComment;
  let quote = openQuote;
  const flush = (kind: Kind | null) => {
    if (buf) {
      tokens.push({ text: buf, kind });
      buf = "";
    }
  };

  while (i < line.length) {
    // inside /* … */
    if (block) {
      const end = hasBlock ? line.indexOf("*/", i) : -1;
      if (end < 0) {
        // the rest of the line is comment; a plain buffer would come back as kind: null and the
        // continuation would render unstyled
        flush(null);
        tokens.push({ text: line.slice(i), kind: "comment" });
        i = line.length;
        break;
      }
      flush(null);
      tokens.push({ text: line.slice(i, end + 2), kind: "comment" });
      i = end + 2;
      block = false;
      continue;
    }

    // line comment
    if (lineComment && line.startsWith(lineComment, i)) {
      flush(null);
      tokens.push({ text: line.slice(i), kind: "comment" });
      return { tokens, inBlockComment: false, openQuote: null };
    }

    // block comment start
    if (hasBlock && line.startsWith("/*", i)) {
      flush(null);
      const end = line.indexOf("*/", i + 2);
      if (end < 0) {
        tokens.push({ text: line.slice(i), kind: "comment" });
        return { tokens, inBlockComment: true, openQuote: null };
      }
      tokens.push({ text: line.slice(i, end + 2), kind: "comment" });
      i = end + 2;
      continue;
    }

    const c = line[i];
    // continuing a string opened on an earlier line
    if (quote) {
      const end = line.indexOf(quote, i);
      if (end < 0) {
        flush(null);
        tokens.push({ text: line.slice(i), kind: "string" });
        i = line.length;
        break;
      }
      flush(null);
      tokens.push({ text: line.slice(i, end + quote.length), kind: "string" });
      i = end + quote.length;
      quote = null;
      continue;
    }

    // string literal: `"""` and `'''` are one token, not three empty strings
    if (c === '"' || c === "'" || c === "`") {
      flush(null);
      const triple = c !== "`" && line.startsWith(c + c + c, i) ? c + c + c : null;
      const close = triple ?? c;
      let from = i + close.length;
      // an escaped quote is not a closer: scan forward, skipping `\\x` pairs
      let end = -1;
      while (from <= line.length) {
        const at = line.indexOf(close, from);
        if (at < 0) break;
        let backslashes = 0;
        for (let b = at - 1; b >= 0 && line[b] === "\\"; b -= 1) backslashes += 1;
        if (backslashes % 2 === 0) {
          end = at;
          break;
        }
        from = at + 1;
      }
      if (end < 0) {
        tokens.push({ text: line.slice(i), kind: "string" });
        quote = close;
        i = line.length;
        break;
      }
      tokens.push({ text: line.slice(i, end + close.length), kind: "string" });
      i = end + close.length;
      continue;
    }

    // a word
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < line.length && /[A-Za-z0-9_$]/.test(line[j])) j += 1;
      const word = line.slice(i, j);
      if (keywords.has(word)) {
        flush(null);
        tokens.push({ text: word, kind: "keyword" });
      } else {
        buf += word;
      }
      i = j;
      continue;
    }

    buf += c;
    i += 1;
  }
  flush(null);
  return { tokens, inBlockComment: block, openQuote: quote };
}

/**
 * Colour a run of lines. Some constructs span lines — a Python docstring, a template literal, a
 * `/* … *\/` comment — so the state has to be threaded from one line to the next. Colouring each
 * line on its own left docstring bodies as plain text.
 */
/** How far an unterminated string may carry its colour before we stop believing it. */
const QUOTE_CARRY = 40;

/** Colour one file's lines in order (no diff sides). */
export function highlightLines(lines: string[], file: string): Token[][] {
  return highlightSided(lines.map((text) => ({ text, side: "both" as const })), file);
}

/** Which file a rendered row came from. A deleted row exists only on the old side. */
type Side = "old" | "new" | "both";

/**
 * Create the per-line state holders.
 *
 * Three independent walks, because a diff interleaves two files: a deleted line opens something
 * only in the *old* file, an inserted line only in the *new* one, and a context line is in both.
 * Colouring the rendered sequence as if it were one file let a deleted docstring opener bleed into
 * the context lines below it — the same bug the stray-quote cap was for, arriving from the other
 * direction.
 */
function createRun(file: string) {
  const mk = () => ({ inBlockComment: false, openQuote: null as string | null, carried: 0 });
  const st = { old: mk(), new: mk(), both: mk() };
  return (itemS: { text: string; side: Side }): Token[] => {
    const sides: Side[] = itemS.side === "both" ? ["old", "new", "both"] : [itemS.side];
    // the "both" state is what a shared walk sees; per-side states are what a split walk needs
    let tokens: Token[] = [];
    for (const side of sides) {
      const s = st[side];
      if (s.openQuote && s.carried >= QUOTE_CARRY) s.openQuote = null;
      const r = highlight(itemS.text, file, s.inBlockComment, s.openQuote);
      s.inBlockComment = r.inBlockComment;
      s.openQuote = r.openQuote;
      s.carried = s.openQuote ? s.carried + 1 : 0;
      // the last side walked wins for display; with a single side this is just that side
      tokens = r.tokens;
    }
    return tokens;
  };
}

/**
 * Colour rows that carry their side. Use this for a diff view.
 */
export function highlightSided(items: Array<{ text: string; side: Side }>, file: string): Token[][] {
  const step = createRun(file);
  return items.map(step);
}

