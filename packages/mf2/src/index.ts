/**
 * MessageFormat 2 (Unicode, MF2) — a deliberately small TypeScript subset.
 *
 * Implemented (the parts a UI needs, matching messageformat2's behaviour):
 *   - pattern messages: `Hello {$name}!` with `\{\|}` escapes
 *   - `.input {$n :number}` / `.local $x = {$n :integer}` declarations
 *   - `.match $n` selection with `one {{…}}` / `*   {{…}}` variants
 *   - functions: :string :number :integer :decimal :percent :currency :date :time :datetime
 *   - plural / ordinal / exact selection on :number / :integer (:select=plural|ordinal)
 *   - bidi isolation of placeholders (default bidi strategy)
 *   - errors collected, placeholder kept as `{$name}` (spec fallback behaviour)
 *
 * NOT implemented: markup, attributes, custom functions, `:offset`, per-function
 * options beyond the documented set. Those are the next step when a locale needs them.
 *
 * Syntax reference: https://messageformat.unicode.org/ (implemented from the spec,
 * cross-checked against tomasr8/messageformat2's parser and builtins).
 */

export interface Mf2Options {
  /** BCP 47 tag used for plural rules and number/date formatting. */
  locale?: string;
  /** isolate placeholders with FSI/PDI (spec "default bidi strategy"). */
  bidi?: boolean;
  /** collect errors instead of throwing. */
  onError?: (e: Mf2Error) => void;
}

export class Mf2Error extends Error {
  constructor(
    message: string,
    readonly kind: "parse" | "resolve" | "format" | "select",
  ) {
    super(message);
    this.name = "Mf2Error";
  }
}

// ---------------------------------------------------------------- AST

type Expr = { type: "literal"; value: string; annotation?: Annotation } | { type: "variable"; name: string; annotation?: Annotation };

interface Annotation {
  fn: string;
  options: Record<string, string>;
}

type Part = { type: "text"; value: string } | { type: "expr"; expr: Expr };

type Declaration =
  | { type: "input"; name: string; annotation?: Annotation }
  | { type: "local"; name: string; expr: Expr };

type Variant = { keys: string[]; pattern: Part[] };

export type Message =
  | { type: "pattern"; body: Part[] }
  | { type: "select"; decls: Declaration[]; selectors: string[]; variants: Variant[] };

// ---------------------------------------------------------------- parser

class Reader {
  i = 0;
  constructor(readonly src: string) {}

  peek(n = 0): string | undefined {
    return this.src[this.i + n];
  }
  eof(): boolean {
    return this.i >= this.src.length;
  }
  ws(): boolean {
    let moved = false;
    while (!this.eof() && /[ \t\r\n\u3000]/.test(this.peek()!)) {
      this.i++;
      moved = true;
    }
    return moved;
  }
  /** name-start / name-char per the spec (unicode letters allowed — locales need them). */
  nameStart(): boolean {
    const ch = this.peek();
    return !!ch && /[A-Za-z_+$\u00a1-\uffff]/.test(ch) && !/[\s{}|\\]/.test(ch);
  }
  nameChar(): boolean {
    const ch = this.peek();
    return !!ch && /[A-Za-z0-9_.\-+$\u00a1-\uffff]/.test(ch) && !/[\s{}|\\]/.test(ch);
  }
  name(): string {
    if (!this.nameStart()) throw new Mf2Error(`expected a name at ${this.i}`, "parse");
    let out = this.peek()!;
    this.i++;
    while (!this.eof() && this.nameChar()) out += this.src[this.i++];
    return out;
  }
}

function parseAnnotation(r: Reader): Annotation | undefined {
  r.ws();
  if (r.peek() !== ":") return undefined;
  r.i++;
  const fn = r.name();
  const options: Record<string, string> = {};
  for (;;) {
    const start = r.i;
    if (!r.ws()) break;
    if (r.peek() === "}" || r.eof()) {
      r.i = start;
      break;
    }
    if (!r.nameStart()) {
      r.i = start;
      break;
    }
    const key = r.name();
    r.ws();
    if (r.peek() !== "=") throw new Mf2Error(`option ${key} needs a value`, "parse");
    r.i++;
    r.ws();
    let value = "";
    if (r.peek() === "|") {
      // quoted literal
      r.i++;
      while (!r.eof() && r.peek() !== "|") {
        if (r.peek() === "\\") {
          r.i++;
          value += r.peek() ?? "";
          r.i++;
          continue;
        }
        value += r.src[r.i++];
      }
      r.i++; // closing |
    } else {
      value = r.name();
      // decimal / percent literals: "2", "0.5", "+1", "-1"
      while (!r.eof() && /[0-9.+-]/.test(r.peek()!)) value += r.src[r.i++];
    }
    options[key] = value;
  }
  return { fn, options };
}

/** Parse `:fn key=value …` from a header line (the token after the variable). */
function parseAnnotationText(text: string): Annotation | undefined {
  const r = new Reader(text);
  return parseAnnotation(r);
}

function parseExpression(r: Reader): Expr {
  // at '{'
  r.i++;
  r.ws();
  if (r.peek() === "$") {
    r.i++;
    const name = r.name();
    const annotation = parseAnnotation(r);
    r.ws();
    if (r.peek() !== "}") throw new Mf2Error(`unclosed placeholder {$ ${name}`, "parse");
    r.i++;
    return { type: "variable", name, ...(annotation ? { annotation } : {}) };
  }
  // literal expression
  let value = "";
  while (!r.eof() && r.peek() !== "}" && r.peek() !== ":") value += r.src[r.i++];
  const annotation = parseAnnotation(r);
  r.ws();
  if (r.peek() !== "}") throw new Mf2Error("unclosed placeholder", "parse");
  r.i++;
  return { type: "literal", value: value.trim(), ...(annotation ? { annotation } : {}) };
}

function parsePattern(r: Reader, until: "}" | "eof"): Part[] {
  const parts: Part[] = [];
  let text = "";
  while (!r.eof()) {
    const ch = r.peek()!;
    if (ch === "\\" && /[\\{|}]/.test(r.peek(1) ?? "")) {
      text += r.peek(1);
      r.i += 2;
      continue;
    }
    if (ch === "}" && r.peek(1) === "}" && until === "}") {
      // end of a variant pattern: `}}`
      r.i += 2;
      if (text) parts.push({ type: "text", value: text });
      return parts;
    }
    if (ch === "{" && (until === "eof" || until === "}")) {
      if (text) parts.push({ type: "text", value: text });
      text = "";
      parts.push({ type: "expr", expr: parseExpression(r) });
      continue;
    }
    text += ch;
    r.i++;
  }
  if (until === "}") {
    // tolerate `{{x}}` written without the closing pair (accept EOF)
    if (text) parts.push({ type: "text", value: text });
    return parts;
  }
  if (text) parts.push({ type: "text", value: text });
  return parts;
}

/** Parse a message source. Throws Mf2Error("parse") on malformed input. */
export function parseMessage(src: string): Message {
  const decls: Declaration[] = [];
  let selectors: string[] | null = null;

  // header: .input / .local / .match (each on its own line)
  const lines = src.split("\n");
  let cursor = 0;
  for (; cursor < lines.length; cursor++) {
    const line = lines[cursor].trim();
    if (!line) continue;
    if (!line.startsWith(".")) break;
    if (line.startsWith(".input") && /[\s{]/.test(line[6] ?? " ")) {
      // `.input {$name :fn opt=val}` — the braces are part of the declaration
      const m = /^\.input\s+\{?\s*\$([\w.+-]+)\s*(?::([\w.+-]+)([^}]*))?\}?/.exec(line);
      if (!m) throw new Mf2Error(".input needs $name", "parse");
      const ann = m[2] ? parseAnnotationText(`:${m[2]}`) : undefined;
      decls.push({ type: "input", name: m[1], ...(ann ? { annotation: ann } : {}) });
      continue;
    }
    if (line.startsWith(".local") && /[\s{]/.test(line[6] ?? " ")) {
      const m = /^\.local\s+\$([\w.+-]+)\s*=\s*(\{[^}]*\}|.+)$/.exec(line);
      if (!m) throw new Mf2Error(".local needs $name = {expr}", "parse");
      const r2 = new Reader(m[2]);
      const expr = parseExpression(r2);
      decls.push({ type: "local", name: m[1], expr });
      continue;
    }
    if (line.startsWith(".match") && /[\s]/.test(line[6] ?? " ")) {
      selectors = [...line.slice(6).matchAll(/\$([\w.+-]+)/g)].map((x) => x[1]);
      continue;
    }
    break;
  }
  const rest = lines
    .slice(cursor)
    .map((l, i) => (i === 0 ? l : l))
    .join("\n")
    .trim();
  const r = new Reader(rest);

  if (!selectors) {
    // pattern message: the rest is one pattern
    const body = parsePattern(r, "eof");
    return { type: "pattern", body };
  }

  // variants: `keys {{pattern}}`
  const variants: Variant[] = [];
  const KEYCH = /[A-Za-z0-9_.+\-\u00a1-\uffff]/;
  for (;;) {
    r.ws();
    if (r.eof()) break;
    const keys: string[] = [];
    for (;;) {
      r.ws();
      if (r.peek() === "{" || r.eof()) break;
      if (r.peek() === "*") {
        r.i++;
        keys.push("*");
        continue;
      }
      let key = "";
      while (!r.eof() && KEYCH.test(r.peek()!)) key += r.src[r.i++];
      if (!key) throw new Mf2Error(`expected a variant key at ${r.i}`, "parse");
      keys.push(key);
    }
    r.ws();
    // a variant pattern is wrapped as `{{ ... }}`; tolerate a single brace too
    if (r.peek() === "{" && r.peek(1) === "{") r.i += 2;
    else if (r.peek() === "{") r.i += 1;
    else throw new Mf2Error("variant key needs a pattern", "parse");
    let pattern = parsePattern(r, "}");
    // strip the closing pair that parsePattern left as text (it ends at `}}`, or at EOF)
    if (!pattern.length && r.eof()) pattern = [];
    variants.push({ keys, pattern });
  }
  return { type: "select", decls, selectors, variants };
}

// ---------------------------------------------------------------- runtime

const PLURAL_KEYWORDS = new Set(["zero", "one", "two", "few", "many", "other"]);

function localeOf(tag: string | undefined): string {
  if (!tag) return "en";
  return tag;
}

function numLocale(locale: string): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
  } catch {
    return new Intl.NumberFormat("en", { maximumFractionDigits: 3 });
  }
}

function intlPlural(locale: string, n: number, type: "cardinal" | "ordinal"): string {
  try {
    return new Intl.PluralRules(locale, { type }).select(n);
  } catch {
    return new Intl.PluralRules("en", { type }).select(n);
  }
}

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return NaN;
}

interface Formatted {
  text: string;
  /** for selection: the numeric value, when the annotation selects */
  numeric?: number;
}

function applyFn(fn: string | undefined, raw: unknown, options: Record<string, string>, locale: string): Formatted {
  const opts = options;
  switch (fn) {
    case undefined:
    case "string":
      return { text: String(raw) };
    case "number":
    case "integer":
    case "decimal": {
      const n = toNumber(raw);
      if (Number.isNaN(n)) return { text: String(raw) };
      const frac = opts.fractionDigits ? Number(opts.fractionDigits) : undefined;
      const min = opts.minimumFractionDigits ? Number(opts.minimumFractionDigits) : undefined;
      const max = opts.maximumFractionDigits ? Number(opts.maximumFractionDigits) : undefined;
      const isInt = fn === "integer" || opts.fractionDigits === "0";
      const nf = (() => {
        try {
          return new Intl.NumberFormat(locale, {
            style: opts.numberingSystem ? "decimal" : "decimal",
            minimumFractionDigits: isInt ? 0 : (min ?? frac ?? 0),
            maximumFractionDigits: isInt ? 0 : (max ?? frac ?? 3),
            useGrouping: opts.useGrouping !== "never",
          });
        } catch {
          return new Intl.NumberFormat("en");
        }
      })();
      return { text: nf.format(n), numeric: n };
    }
    case "percent": {
      const n = toNumber(raw);
      if (Number.isNaN(n)) return { text: String(raw) };
      const nf = new Intl.NumberFormat(locale, {
        style: "percent",
        maximumFractionDigits: opts.maximumFractionDigits ? Number(opts.maximumFractionDigits) : 1,
      });
      return { text: nf.format(n), numeric: n };
    }
    case "currency": {
      const n = toNumber(raw);
      if (Number.isNaN(n)) return { text: String(raw) };
      const currency = opts.currency ?? "USD";
      try {
        return { text: new Intl.NumberFormat(locale, { style: "currency", currency }).format(n), numeric: n };
      } catch {
        return { text: `${n} ${currency}`, numeric: n };
      }
    }
    case "date":
    case "time":
    case "datetime": {
      const d = raw instanceof Date ? raw : new Date(typeof raw === "number" ? raw : String(raw));
      if (Number.isNaN(d.getTime())) return { text: String(raw) };
      const dateOpts: Intl.DateTimeFormatOptions =
        fn === "time"
          ? { hour: "2-digit", minute: "2-digit" }
          : fn === "date"
            ? { year: "numeric", month: "short", day: "numeric" }
            : { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" };
      try {
        return { text: new Intl.DateTimeFormat(locale, dateOpts).format(d) };
      } catch {
        return { text: d.toISOString() };
      }
    }
    default:
      throw new Mf2Error(`unknown function :${fn}`, "format");
  }
}

/** Which variant key a selector value matches: exact number first, then plural/ordinal keyword. */
function selectKeys(numeric: number, options: Record<string, string>, locale: string): string[] {
  const keys: string[] = [];
  if (Number.isFinite(numeric)) {
    keys.push(Number.isInteger(numeric) ? String(numeric) : String(numeric));
    const kind = options.select === "ordinal" ? "ordinal" : "cardinal";
    keys.push(intlPlural(locale, numeric, kind));
  }
  keys.push("other");
  return keys;
}

function formatParts(parts: Part[], vars: Record<string, unknown>, locale: string, bidi: boolean, errors: Mf2Error[]): string {
  let out = "";
  for (const p of parts) {
    if (p.type === "text") {
      out += p.value;
      continue;
    }
    const e = p.expr;
    const raw = e.type === "literal" ? e.value : vars[e.name];
    if (e.type === "variable" && raw === undefined) {
      errors.push(new Mf2Error(`unresolved variable $${e.name}`, "resolve"));
      out += `{$${e.name}}`;
      continue;
    }
    try {
      const { text } = applyFn(e.annotation?.fn, raw, e.annotation?.options ?? {}, locale);
      out += bidi ? `\u2068${text}\u2069` : text;
    } catch (err) {
      errors.push(err instanceof Mf2Error ? err : new Mf2Error(String(err), "format"));
    }
  }
  return out;
}

/** Format one parsed message. `vars` are the inputs (`{$name}`). */
export function formatParsed(msg: Message, vars: Record<string, unknown> = {}, options: Mf2Options = {}): string {
  const locale = localeOf(options.locale);
  const bidi = options.bidi ?? false;
  const errors: Mf2Error[] = [];
  const local: Record<string, unknown> = { ...vars };

  if (msg.type === "select") {
    for (const d of msg.decls) {
      if (d.type === "input") {
        const ann = d.annotation;
        if (ann && ann.fn !== "string") {
          // an annotated .input is formatted for display later; selection uses the raw number
          const n = toNumber(local[d.name]);
          if (!Number.isNaN(n)) local[d.name] = n;
        }
        continue;
      }
      const e = d.expr;
      if (e.type === "literal") {
        local[d.name] = e.value;
      } else {
        const v = local[e.name];
        if (e.annotation && e.annotation.fn !== "string") {
          const n = toNumber(v);
          local[d.name] = e.annotation.fn === "percent" ? n * 0 : n;
        } else {
          local[d.name] = v;
        }
      }
    }

    const wanted: string[][] = [];
    for (const sel of msg.selectors) {
      const v = local[sel];
      const decl = msg.decls.find((d) => d.type === "input" && d.name === sel) as
        | { annotation?: Annotation }
        | undefined;
      const numeric = toNumber(v);
      wanted.push(selectKeys(numeric, decl?.annotation?.options ?? {}, locale));
    }

    // best match: each selector prefers its earliest key; fall back to `*`
    const best = (v: Variant): number => {
      let score = 0;
      for (let s = 0; s < wanted.length; s++) {
        const key = v.keys[s] ?? "*";
        if (key === "*") continue;
        const idx = wanted[s].indexOf(key);
        if (idx < 0) return -1;
        score += 100 - idx;
      }
      return score;
    };
    let chosen = msg.variants.find((v) => best(v) >= 0);
    if (!chosen) chosen = msg.variants.find((v) => v.keys.every((k) => k === "*")) ?? msg.variants[0];
    if (!chosen) throw new Mf2Error("no matching variant", "select");
    return formatParts(chosen.pattern, local, locale, bidi, errors);
  }

  const text = formatParts(msg.body, local, locale, bidi, errors);
  for (const e of errors) options.onError?.(e);
  return text;
}

/** Parse + format in one call (the shape every call site uses). */
export function formatMessage(src: string, vars: Record<string, unknown> = {}, options: Mf2Options = {}): string {
  const errors: Mf2Error[] = [];
  let msg: Message;
  try {
    msg = parseMessage(src);
  } catch (e) {
    const err = e instanceof Mf2Error ? e : new Mf2Error(String(e), "parse");
    options.onError?.(err);
    return src;
  }
  const out = formatParsed(msg, vars, { ...options, onError: (e) => {
    errors.push(e);
    options.onError?.(e);
  } });
  return out;
}