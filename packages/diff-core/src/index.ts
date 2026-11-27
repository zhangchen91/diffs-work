/**
 * Minimal unified hunk builder for the TS packages and the Rust `diff-core` wasm.
 * This file is the reference implementation the Rust engine must match
 * (see apps/engine-core — contract is tested in scripts/test-diff-core.mjs).
 */

export type Op = "equal" | "insert" | "delete";

export interface DiffOp<T = string> {
  op: Op;
  value: T;
}

export interface HunkLine {
  kind: Op;
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: HunkLine[];
}

const DEFAULT_CONTEXT = 3;

/** LCS-based line diff (quadratic, fine for < 5k lines; the wasm engine uses Myers O(ND)). */
export function diffLines(a: string[], b: string[]): DiffOp<number>[] {
  const n = a.length;
  const m = b.length;
  // skip common prefix/suffix cheaply
  let start = 0;
  while (start < n && start < m && a[start] === b[start]) start++;
  let endA = n;
  let endB = m;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const ops: DiffOp<number>[] = [];
  for (let i = 0; i < start; i++) ops.push({ op: "equal", value: i });
  const A = a.slice(start, endA);
  const B = b.slice(start, endB);
  const na = A.length;
  const nb = B.length;
  if (na && nb) {
    const dp: number[][] = Array.from({ length: na + 1 }, () => new Array<number>(nb + 1).fill(0));
    for (let i = na - 1; i >= 0; i--) {
      for (let j = nb - 1; j >= 0; j--) {
        dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < na && j < nb) {
      if (A[i] === B[j]) {
        ops.push({ op: "equal", value: start + i });
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        ops.push({ op: "delete", value: start + i });
        i++;
      } else {
        ops.push({ op: "insert", value: start + j });
        j++;
      }
    }
    while (i < na) ops.push({ op: "delete", value: start + i++ });
    while (j < nb) ops.push({ op: "insert", value: start + j++ });
  } else {
    for (let i = 0; i < na; i++) ops.push({ op: "delete", value: start + i });
    for (let j = 0; j < nb; j++) ops.push({ op: "insert", value: start + j });
  }
  for (let k = 0; k < n - endA; k++) ops.push({ op: "equal", value: endA + k });
  return ops;
}

export function buildHunks(a: string[], b: string[], context = DEFAULT_CONTEXT): Hunk[] {
  const ops = diffLines(a, b);
  const rows: HunkLine[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (const op of ops) {
    if (op.op === "equal") {
      rows.push({ kind: "equal", text: a[op.value], oldLine, newLine });
      oldLine++;
      newLine++;
    } else if (op.op === "delete") {
      rows.push({ kind: "delete", text: a[op.value], oldLine, newLine: null });
      oldLine++;
    } else {
      rows.push({ kind: "insert", text: b[op.value], oldLine: null, newLine });
      newLine++;
    }
  }

  const changed = rows.map((r, i) => (r.kind === "equal" ? -1 : i)).filter((i) => i >= 0);
  if (!changed.length) return [];

  const groups: Array<[number, number]> = [];
  let start = Math.max(0, changed[0] - context);
  let end = Math.min(rows.length - 1, changed[0] + context);
  for (const idx of changed.slice(1)) {
    if (idx - context <= end + 1) {
      end = Math.min(rows.length - 1, idx + context);
    } else {
      groups.push([start, end]);
      start = Math.max(0, idx - context);
      end = Math.min(rows.length - 1, idx + context);
    }
  }
  groups.push([start, end]);

  return groups.map(([s, e]) => {
    const lines = rows.slice(s, e + 1);
    const oldStart = lines.find((l) => l.oldLine !== null)?.oldLine ?? 0;
    const newStart = lines.find((l) => l.newLine !== null)?.newLine ?? 0;
    const oldLines = lines.filter((l) => l.oldLine !== null).length;
    const newLines = lines.filter((l) => l.newLine !== null).length;
    return {
      oldStart,
      oldLines,
      newStart,
      newLines,
      header: `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`,
      lines,
    };
  });
}

export function toUnified(a: string[], b: string[], filename = "a"): string {
  const hunks = buildHunks(a, b);
  const out = [`--- ${filename}.old`, `+++ ${filename}.new`];
  for (const h of hunks) {
    out.push(h.header);
    for (const l of h.lines) {
      const prefix = l.kind === "equal" ? " " : l.kind === "insert" ? "+" : "-";
      out.push(prefix + l.text);
    }
  }
  return out.join("\n");
}

/** Word-level diff for inline (intra-line) highlighting. */
export function diffWords(a: string, b: string): Array<{ op: Op; text: string }> {
  const tokenize = (s: string) => s.match(/[\u4e00-\u9fa5]|[A-Za-z0-9_]+|\s+|[^]/gu) ?? [];
  const ta = tokenize(a);
  const tb = tokenize(b);
  const ops = diffLines(ta, tb);
  const merged: Array<{ op: Op; text: string }> = [];
  for (const op of ops) {
    const text = op.op === "insert" ? tb[op.value] : ta[op.value];
    const last = merged[merged.length - 1];
    if (last && last.op === op.op) last.text += text;
    else merged.push({ op: op.op, text });
  }
  return merged;
}

export function stats(hunks: Hunk[]): { added: number; removed: number; hunks: number } {
  let added = 0;
  let removed = 0;
  for (const h of hunks) {
    for (const l of h.lines) {
      if (l.kind === "insert") added++;
      else if (l.kind === "delete") removed++;
    }
  }
  return { added, removed, hunks: hunks.length };
}