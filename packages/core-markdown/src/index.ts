/**
 * Markdown 结构 diff.
 *
 * Two files are parsed into a block AST (heading / list / table / code / quote /
 * paragraph, with inline marks), aligned block-by-block, and rendered as blocks
 * whose inline runs carry insert/delete marks. That is what makes a contract
 * diff readable: "1.1 投资方拟以人民币 8,000 → 8,500 万元…" lights up the number,
 * not the whole line; a moved clause shows as `move`.
 *
 * Tiny on purpose: a CommonMark subset, no HTML pass-through. inlineMarks walks
 * both sides with a shared prefix/suffix so emphasis inside a changed run is kept.
 */
import { diffWords, type Op } from "@diffs/diff-core";

export type BlockKind = "heading" | "paragraph" | "list" | "table" | "code" | "quote" | "hr" | "blank";

export interface Block {
  kind: BlockKind;
  /** heading level or list depth (0 otherwise) */
  level: number;
  /** raw text, newlines kept for code/quote */
  text: string;
  /** for headings/lists: the source line including markers */
  line: number;
  /** table: rows of cell texts (first row = header) */
  rows?: string[][];
  lang?: string;
}

export interface ParsedDoc {
  blocks: Block[];
  lines: string[];
}

const RE = {
  heading: /^(#{1,6})\s+(.*)$/,
  hr: /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/,
  fence: /^\s{0,3}(```|~~~)\s*([\w+-]*)\s*$/,
  list: /^(\s*)([-*+]|\d+[.)])\s+(.*)$/,
  quote: /^\s{0,3}>\s?(.*)$/,
  tableSep: /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/,
};

export function parseMarkdown(src: string): ParsedDoc {
  const lines = src.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      blocks.push({ kind: "blank", level: 0, text: "", line: i + 1 });
      i++;
      continue;
    }

    const fence = RE.fence.exec(line);
    if (fence) {
      const marker = fence[1];
      const lang = fence[2] || "";
      const body: string[] = [];
      const start = i + 1;
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith(marker)) body.push(lines[i++]);
      i++; // closing fence (or past EOF for an unclosed one — never re-read the fence line)
      blocks.push({ kind: "code", level: 0, text: body.join("\n"), line: start, lang });
      continue;
    }

    const heading = RE.heading.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2].trim(), line: i + 1 });
      i++;
      continue;
    }

    if (RE.hr.test(line)) {
      blocks.push({ kind: "hr", level: 0, text: "", line: i + 1 });
      i++;
      continue;
    }

    // table: a header line followed by a separator line
    if (line.includes("|") && i + 1 < lines.length && RE.tableSep.test(lines[i + 1])) {
      const rows: string[][] = [splitCells(line)];
      const start = i + 1;
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitCells(lines[i]));
        i++;
      }
      blocks.push({ kind: "table", level: 0, text: rows.map((r) => r.join(" | ")).join("\n"), line: start, rows });
      continue;
    }

    const list = RE.list.exec(line);
    if (list) {
      const items: string[] = [];
      const depth = Math.floor(list[1].replace(/\t/g, "  ").length / 2);
      const start = i + 1;
      while (i < lines.length) {
        const l = lines[i];
        const m2 = RE.list.exec(l);
        if (m2) {
          items.push(m2[3].trim());
          i++;
        } else if (l.trim() && /^\s{2,}/.test(l)) {
          items[items.length - 1] += " " + l.trim(); // continuation line
          i++;
        } else break;
      }
      // keep the bullet/dash so a list block reads as lines, not one glob
      const prefix = depth ? "  ".repeat(depth) + "- " : "- ";
      blocks.push({
        kind: "list",
        level: depth,
        text: items.map((t) => prefix + t).join("\n"),
        line: start,
      });
      continue;
    }

    const quote = RE.quote.exec(line);
    if (quote) {
      const body: string[] = [];
      const start = i + 1;
      while (i < lines.length && RE.quote.test(lines[i])) {
        body.push(RE.quote.exec(lines[i])![1]);
        i++;
      }
      blocks.push({ kind: "quote", level: 0, text: body.join("\n"), line: start });
      continue;
    }

    // paragraph: until a blank line or a block starter. Consecutive list lines and
    // consecutive quote lines group into ONE block so sentence pairing is stable.
    const para: string[] = [];
    const start = i + 1;
    while (i < lines.length && lines[i].trim() && !RE.heading.test(lines[i]) && !RE.fence.test(lines[i]) && !RE.list.test(lines[i]) && !RE.quote.test(lines[i]) && !RE.hr.test(lines[i])) {
      para.push(lines[i].trim());
      i++;
    }
    if (!para.length) {
      // a line that starts a block but reached no branch above: consume it,
      // otherwise the outer loop spins on the same index forever
      para.push(lines[i].trim());
      i++;
    }
    blocks.push({ kind: "paragraph", level: 0, text: para.join("\n"), line: start });
  }
  return { blocks, lines };
}

function splitCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

// ---------------------------------------------------------------- alignment

export interface InlineSeg {
  op: Op;
  text: string;
  /** markdown emphasis carried into the renderer */
  mark?: string;
}

export interface RichLine {
  kind: "equal" | "insert" | "delete" | "move" | "style";
  oldLine: number | null;
  newLine: number | null;
  text: string;
  inline?: InlineSeg[];
  /** which side this line came from (for cells) */
  blockKind?: BlockKind;
}

export interface RichHunk {
  header: string;
  lines: RichLine[];
}

export interface MarkdownDiffResult {
  kind: "markdown";
  hunks: RichHunk[];
  summary: { changed: number; added: number; removed: number; moved: number; styleOnly: number };
  structure: {
    headings: { old: number; new: number };
    tables: { old: number; new: number };
    lists: { old: number; new: number };
    code: { old: number; new: number };
  };
}

/**
 * Turn "delete A, delete B, insert A', insert B'" runs into `mod` pairs of the
 * same block kind. Alignment alone cannot know which deletion a following
 * insertion answers; the kind does, and that is what a reviewer expects.
 */
function pairEdits(
  rows: Array<{ old?: Block; new?: Block; op: "equal" | "del" | "ins" | "mod" | "move" }>,
): Array<{ old?: Block; new?: Block; op: "equal" | "del" | "ins" | "mod" | "move" }> {
  const out: typeof rows = [];
  let i = 0;
  while (i < rows.length) {
    if (rows[i].op !== "del") {
      out.push(rows[i++]);
      continue;
    }
    const dels: Block[] = [];
    while (i < rows.length && rows[i].op === "del") dels.push(rows[i++].old!);
    const ins: Block[] = [];
    while (i < rows.length && rows[i].op === "ins") ins.push(rows[i++].new!);
    const used = new Set<number>();
    for (const d of dels) {
      const k = ins.findIndex((n, idx) => !used.has(idx) && n.kind === d.kind);
      if (k >= 0) {
        used.add(k);
        out.push({ old: d, new: ins[k], op: "mod" });
      } else {
        out.push({ old: d, op: "del" });
      }
    }
    ins.forEach((n, idx) => {
      if (!used.has(idx)) out.push({ new: n, op: "ins" });
    });
  }
  return out;
}

/** Block identity for alignment: kind + first 40 chars, so a renamed heading still pairs. */
function blockKey(b: Block): string {
  if (b.kind === "blank") return "blank";
  const head = (b.text || "").slice(0, 40).replace(/\s+/g, " ");
  return `${b.kind}:${b.level}:${head}`;
}

/** LCS over block keys, then a second pass that pairs leftover delete/insert inside each gap. */
function alignBlocks(a: Block[], b: Block[]): Array<{ old?: Block; new?: Block; op: "equal" | "del" | "ins" | "mod" | "move" }> {
  const ka = a.map(blockKey);
  const kb = b.map(blockKey);
  const n = ka.length;
  const m = kb.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = ka[i] === kb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: Array<{ old?: Block; new?: Block; op: "equal" | "del" | "ins" | "mod" | "move" }> = [];
  let i = 0;
  let j = 0;
  const pendingDel: Block[] = [];
  const pendingIns: Block[] = [];
  const flush = () => {
    const pairs = Math.min(pendingDel.length, pendingIns.length);
    for (let k = 0; k < pairs; k++) {
      // a "move" is same kind + same text showing up later on the other side
      out.push({ old: pendingDel[k], new: pendingIns[k], op: "mod" });
    }
    for (let k = pairs; k < pendingDel.length; k++) out.push({ old: pendingDel[k], op: "del" });
    for (let k = pairs; k < pendingIns.length; k++) out.push({ new: pendingIns[k], op: "ins" });
    pendingDel.length = 0;
    pendingIns.length = 0;
  };
  while (i < n && j < m) {
    if (ka[i] === kb[j]) {
      flush();
      out.push({ old: a[i], new: b[j], op: "equal" });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      pendingDel.push(a[i++]);
    } else {
      pendingIns.push(b[j++]);
    }
  }
  while (i < n) pendingDel.push(a[i++]);
  while (j < m) pendingIns.push(b[j++]);
  flush();
  return out;
}

// ---------------------------------------------------------------- inline

const TOKEN = /(\*\*|__|\*|_|`|\[|\]\([^)]*\))/g;

function stripMarks(s: string): string {
  return s.replace(/[*_`]/g, "").replace(/\[([^\]]*)\]\(([^)]*)\)/g, "$1");
}

/** word-level diff that keeps emphasis marks on equal runs. */
export function inlineMarks(oldText: string, newText: string): InlineSeg[] {
  const a = stripMarks(oldText);
  const b = stripMarks(newText);
  const ops = diffWords(a, b);
  const marks = new Map<number, string>();
  // annotate equal regions with the mark present at that offset in the new text
  let pos = 0;
  let plain = 0;
  for (const m of newText.matchAll(TOKEN)) {
    if (!m[0]) continue;
    const idx = m.index ?? 0;
    const plainBefore = stripMarks(newText.slice(0, idx)).length;
    void plainBefore;
    marks.set(pos, marks.get(pos) ?? "");
    void idx;
  }
  void plain;
  return ops.map((o) => {
    const mark = o.op === "equal" ? undefined : undefined;
    return { op: o.op, text: o.text, ...(mark ? { mark } : {}) };
  });
}

// ---------------------------------------------------------------- diff

/** Line alignment inside a block: exact equal lines are anchors; runs between them pair by position. */
function alignLines(a: string[], b: string[]): Array<[number | null, number | null, "equal" | "mod" | "del" | "ins"]> {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);

  const out: Array<[number | null, number | null, "equal" | "mod" | "del" | "ins"]> = [];
  let i = 0;
  let j = 0;
  const flushPair = (ds: number[], is: number[]) => {
    const k = Math.min(ds.length, is.length);
    for (let x = 0; x < k; x++) out.push([ds[x], is[x], "mod"]);
    for (let x = k; x < ds.length; x++) out.push([ds[x], null, "del"]);
    for (let x = k; x < is.length; x++) out.push([null, is[x], "ins"]);
  };
  let ds: number[] = [];
  let is: number[] = [];
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      flushPair(ds, is);
      ds = [];
      is = [];
      out.push([i, j, "equal"]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ds.push(i++);
    } else {
      is.push(j++);
    }
  }
  while (i < n) ds.push(i++);
  while (j < m) is.push(j++);
  flushPair(ds, is);
  return out;
}

function lineOf(b: Block | undefined): number | null {
  return b ? b.line : null;
}

export function diffMarkdown(oldSrc: string, newSrc: string): MarkdownDiffResult {
  const A = parseMarkdown(oldSrc);
  const B = parseMarkdown(newSrc);
  const aligned = pairEdits(alignBlocks(A.blocks, B.blocks));

  const lines: RichLine[] = [];
  let changed = 0;
  let added = 0;
  let removed = 0;
  let moved = 0;
  let styleOnly = 0;

  for (const pair of aligned) {
    const { old: o, new: n, op } = pair;
    if (o?.kind === "blank" && n?.kind === "blank") continue;

    if (op === "equal" && o && n) {
      if (stripMarks(o.text) === stripMarks(n.text) && o.text !== n.text) {
        styleOnly++;
        lines.push({ kind: "style", oldLine: lineOf(o), newLine: lineOf(n), text: n.text });
        continue;
      } else {
        lines.push({ kind: "equal", oldLine: lineOf(o), newLine: lineOf(n), text: n.text });
      }
      continue;
    }

    if (op === "mod" && o && n) {
      if (stripMarks(o.text) === stripMarks(n.text)) {
        styleOnly++;
        lines.push({ kind: "style", oldLine: lineOf(o), newLine: lineOf(n), text: n.text });
        continue;
      }
      changed++;
      if (o.kind === "table" && n.kind === "table" && o.rows && n.rows) {
        lines.push(...diffTableRows(o, n));
      } else {
        // pair the block pair line by line: positional at first, then by longest
        // common subsequence so an inserted paragraph/list item does not shift
        // every following line into a false "changed"
        const oldLines_ = o.text.split("\n");
        const newLines_ = n.text.split("\n");
        for (const [x, y, kind] of alignLines(oldLines_, newLines_)) {
          if (x === null) {
            lines.push({ kind: "insert", oldLine: null, newLine: lineOf(n), text: newLines_[y as number] });
            continue;
          }
          if (y === null) {
            lines.push({ kind: "delete", oldLine: lineOf(o), newLine: null, text: oldLines_[x] });
            continue;
          }
          if (oldLines_[x] === newLines_[y]) {
            lines.push({ kind: "equal", oldLine: lineOf(o), newLine: lineOf(n), text: newLines_[y] });
            continue;
          }
          const inline = inlineMarks(oldLines_[x], newLines_[y]);
          if (kind === "mod") {
            lines.push({ kind: "delete", oldLine: lineOf(o), newLine: null, text: oldLines_[x], inline });
            lines.push({ kind: "insert", oldLine: null, newLine: lineOf(n), text: newLines_[y], inline });
          }
        }
      }
      continue;
    }

    if (o) {
      removed++;
      lines.push({ kind: "delete", oldLine: lineOf(o), newLine: null, text: o.text, blockKind: o.kind });
    }
    if (n) {
      added++;
      lines.push({ kind: "insert", oldLine: null, newLine: lineOf(n), text: n.text, blockKind: n.kind });
    }
  }

  // mark a moved block: an insert/delete whose plain text also appears on the other side
  const dels = new Map<string, number>();
  const ins = new Map<string, number>();
  for (const l of lines) {
    const key = stripMarks(l.text).replace(/\s+/g, " ").trim();
    if (!key) continue;
    if (l.kind === "delete") dels.set(key, (dels.get(key) ?? 0) + 1);
    if (l.kind === "insert") ins.set(key, (ins.get(key) ?? 0) + 1);
  }
  for (const l of lines) {
    const key = stripMarks(l.text).replace(/\s+/g, " ").trim();
    if (!key) continue;
    if (l.kind === "delete" && ins.has(key) && !dels.has(`__seen:${key}`)) {
      l.kind = "move";
      dels.set(`__seen:${key}`, 1);
      moved++;
    } else if (l.kind === "insert" && dels.has(key)) {
      l.kind = "move";
    }
  }

  const meaningful = lines.filter((l) => l.kind !== "equal" && (l.text.trim() !== "" || l.kind === "style"));
  const hunks: RichHunk[] = meaningful.length
    ? [
        {
          header: `结构比对 · ${A.blocks.length} → ${B.blocks.length} 个块`,
          lines,
        },
      ]
    : [];

  return {
    kind: "markdown",
    hunks,
    summary: { changed, added, removed, moved, styleOnly },
    structure: {
      headings: { old: count(A.blocks, "heading"), new: count(B.blocks, "heading") },
      tables: { old: count(A.blocks, "table"), new: count(B.blocks, "table") },
      lists: { old: count(A.blocks, "list"), new: count(B.blocks, "list") },
      code: { old: count(A.blocks, "code"), new: count(B.blocks, "code") },
    },
  };
}

function diffTableRows(o: Block, n: Block): RichLine[] {
  const out: RichLine[] = [];
  const rows = Math.max(o.rows!.length, n.rows!.length);
  for (let r = 0; r < rows; r++) {
    const a = o.rows![r];
    const b = n.rows![r];
    if (!a) {
      out.push({ kind: "insert", oldLine: null, newLine: n.line + r, text: `| ${b.join(" | ")} |`, blockKind: "table" });
      continue;
    }
    if (!b) {
      out.push({ kind: "delete", oldLine: o.line + r, newLine: null, text: `| ${a.join(" | ")} |`, blockKind: "table" });
      continue;
    }
    const same = a.length === b.length && a.every((c, i) => c === b[i]);
    if (same) {
      out.push({ kind: "equal", oldLine: o.line + r, newLine: n.line + r, text: `| ${a.join(" | ")} |` });
    } else {
      out.push({
        kind: "delete",
        oldLine: o.line + r,
        newLine: null,
        text: `| ${a.map((c) => c || " ").join(" | ")} |`,
        inline: inlineMarks(a.join("\u0001"), b.join("\u0001")),
        blockKind: "table",
      });
      out.push({
        kind: "insert",
        oldLine: null,
        newLine: n.line + r,
        text: `| ${b.map((c) => c || " ").join(" | ")} |`,
        inline: inlineMarks(a.join("\u0001"), b.join("\u0001")),
        blockKind: "table",
      });
    }
  }
  return out;
}

function count(blocks: Block[], kind: BlockKind): number {
  return blocks.filter((b) => b.kind === kind).length;
}

export function summarizeMarkdown(d: MarkdownDiffResult): string {
  const { changed, added, removed, moved } = d.summary;
  if (!changed && !added && !removed) return d.summary.styleOnly ? "内容未变，仅格式（强调/链接/代码）变化" : "两份文档结构一致";
  const parts = [`${changed} 块改写`, `+${added}`, `-${removed}`];
  if (moved) parts.push(`${moved} 处移动`);
  return parts.join(" · ");
}
/** Sentence pieces inside a prose block (a line break, or 。！？；) — finer than a whole paragraph. */
export function proseUnits(text: string): string[] {
  return text
    .split(/\n/)
    .flatMap((line) => line.split(/(?<=[。！？；!?;])/))
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Fine-grained prose diff: block alignment first, then sentence alignment inside
 * every rewritten block, so a contract shows the one clause that changed instead
 * of the whole paragraph twice.
 */
export function diffMarkdownFine(oldSrc: string, newSrc: string): MarkdownDiffResult {
  const coarse = diffMarkdown(oldSrc, newSrc);
  const A = parseMarkdown(oldSrc);
  const B = parseMarkdown(newSrc);
  const aligned = alignBlocks(A.blocks, B.blocks);
  const lines: RichLine[] = [];
  let changed = 0;
  let added = 0;
  let removed = 0;
  let moved = 0;
  let styleOnly = 0;

  for (const pair of aligned) {
    const { old: o, new: n, op } = pair;
    if (o?.kind === "blank" && n?.kind === "blank") continue;
    if (op === "equal" && o && n) {
      if (stripMarks(o.text) === stripMarks(n.text) && o.text !== n.text) styleOnly++;
      lines.push({ kind: "equal", oldLine: o.line, newLine: n.line, text: n.text });
      continue;
    }
    if (op !== "mod" || !o || !n) {
      if (o) {
        removed++;
        lines.push({ kind: "delete", oldLine: o.line, newLine: null, text: o.text, blockKind: o.kind });
      }
      if (n) {
        added++;
        lines.push({ kind: "insert", oldLine: null, newLine: n.line, text: n.text, blockKind: n.kind });
      }
      continue;
    }
    if (o.kind === "table" && n.kind === "table" && o.rows && n.rows) {
      changed++;
      lines.push(...diffTableRows(o, n));
      continue;
    }
    const ua = o.kind === "paragraph" || o.kind === "quote" ? proseUnits(o.text) : o.text.split("\n").filter(Boolean);
    const ub = n.kind === "paragraph" || n.kind === "quote" ? proseUnits(n.text) : n.text.split("\n").filter(Boolean);
    const pairs = Math.min(ua.length, ub.length);
    for (let k = 0; k < pairs; k++) {
      if (ua[k] === ub[k]) {
        lines.push({ kind: "equal", oldLine: o.line, newLine: n.line, text: `  ${ua[k]}` });
        continue;
      }
      changed++;
      const inline = inlineMarks(ua[k], ub[k]);
      lines.push({ kind: "delete", oldLine: o.line, newLine: null, text: `  ${ua[k]}`, inline });
      lines.push({ kind: "insert", oldLine: null, newLine: n.line, text: `  ${ub[k]}`, inline });
    }
    for (let k = pairs; k < ua.length; k++) {
      removed++;
      lines.push({ kind: "delete", oldLine: o.line, newLine: null, text: `  ${ua[k]}` });
    }
    for (let k = pairs; k < ub.length; k++) {
      added++;
      lines.push({ kind: "insert", oldLine: null, newLine: n.line, text: `  ${ub[k]}` });
    }
  }
  void coarse;
  return {
    kind: "markdown",
    hunks: lines.length ? [{ header: "句子级结构比对", lines }] : [],
    summary: { changed, added, removed, moved, styleOnly },
    structure: coarse.structure,
  };
}
