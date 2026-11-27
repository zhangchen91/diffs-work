/**
 * Word-level comparison for one replaced line.
 *
 * The point is to mark the words that changed rather than the whole line: in
 * `交付：乙方应于签约后 45 日内交付。` → `…30 日内交付。` the only thing worth
 * looking at is `45` → `30`, and a line-wide highlight hides exactly that.
 *
 * This is the same idea the Rust kernel implements for the site; it is written
 * again here because a content script cannot load the wasm bundle when the page
 * it is injected into is a third-party one and must stay small.
 */

/** One piece of a line: its text, and whether this piece differs. */
export interface WordSegment {
  text: string;
  changed: boolean;
}

/**
 * Split a line into words and separators, keeping every character.
 *
 * CJK text has no spaces, so a "word" here is either a run of word characters
 * or a single non-space character — otherwise a whole Chinese sentence would be
 * one token and every edit inside it would mark the entire line.
 * @param line - the text to split.
 * @returns the tokens, in order.
 */
export function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let buffer = "";
  const flush = (): void => {
    if (buffer !== "") tokens.push(buffer);
    buffer = "";
  };
  for (const char of line) {
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(char)) {
      flush();
      tokens.push(char);
      continue;
    }
    if (/\s/.test(char)) {
      flush();
      tokens.push(char);
      continue;
    }
    if (/[\p{L}\p{N}_]/u.test(char)) {
      buffer += char;
      continue;
    }
    flush();
    tokens.push(char);
  }
  flush();
  return tokens;
}

/**
 * Longest common subsequence over two token arrays.
 * @param a - the old line's tokens.
 * @param b - the new line's tokens.
 * @returns indices into `a` that survive, as a boolean array.
 */
function commonMask(a: string[], b: string[]): { inA: boolean[]; inB: boolean[] } {
  const n = a.length;
  const m = b.length;
  // A 1 000-token line is already absurd for a diff row; the cap keeps the table small on a page
  // holding hundreds of rows.
  if (n * m > 250_000) {
    return { inA: a.map(() => false), inB: b.map(() => false) };
  }
  const table: Uint32Array = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * (m + 1) + j] = a[i] === b[j]
        ? table[(i + 1) * (m + 1) + j + 1] + 1
        : Math.max(table[(i + 1) * (m + 1) + j], table[i * (m + 1) + j + 1]);
    }
  }
  const inA = a.map(() => false);
  const inB = b.map(() => false);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      inA[i] = true;
      inB[j] = true;
      i += 1;
      j += 1;
    } else if (table[(i + 1) * (m + 1) + j] >= table[i * (m + 1) + j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return { inA, inB };
}

/**
 * Merge a token list and its mask into segments.
 * @param tokens - the line's tokens.
 * @param mask - which tokens survive.
 * @returns the segments, with adjacent same-state tokens merged.
 */
function segmentsOf(tokens: string[], mask: boolean[]): WordSegment[] {
  const out: WordSegment[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const changed = !mask[i];
    const last = out[out.length - 1];
    if (last !== undefined && last.changed === changed) last.text += tokens[i];
    else out.push({ text: tokens[i], changed });
  }
  return out;
}

/**
 * Compare two lines word by word.
 * @param oldLine - the line as it was.
 * @param newLine - the line as it is now.
 * @returns the old and new sides as segments, each keeping every character.
 */
export function diffWords(oldLine: string, newLine: string): [WordSegment[], WordSegment[]] {
  const a = tokenize(oldLine);
  const b = tokenize(newLine);
  const { inA, inB } = commonMask(a, b);
  return [segmentsOf(a, inA), segmentsOf(b, inB)];
}