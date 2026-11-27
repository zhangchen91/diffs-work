/**
 * Character-level diff of two short strings.
 *
 * The cell view can say "this cell changed", but a clause that differs in one number needs
 * to show *which* characters changed — otherwise the reader compares two long paragraphs by
 * eye. This is a plain LCS over characters with a word-boundary bias so that `16.07` → `16.80`
 * marks the digits, not half of every word.
 *
 * Bounded on purpose: past `MAX_CHARS` it falls back to one delete plus one insert, because
 * an O(n·m) table over a 4000-character cell would cost more than it explains.
 */
export type CharSeg = { op: "same" | "del" | "ins"; text: string };

const MAX_CHARS = 1200;

export function charDiff(before: string, after: string): CharSeg[] {
  if (before === after) return before ? [{ op: "same", text: before }] : [];
  if (before.length > MAX_CHARS || after.length > MAX_CHARS) {
    const out: CharSeg[] = [];
    if (before) out.push({ op: "del", text: before });
    if (after) out.push({ op: "ins", text: after });
    return out;
  }

  const a = [...before];
  const b = [...after];
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[i..] and b[j..]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const segs: CharSeg[] = [];
  const push = (op: CharSeg["op"], text: string) => {
    if (!text) return;
    const last = segs[segs.length - 1];
    if (last && last.op === op) last.text += text;
    else segs.push({ op, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push("del", a[i]);
      i++;
    } else {
      push("ins", b[j]);
      j++;
    }
  }
  while (i < n) push("del", a[i++]);
  while (j < m) push("ins", b[j++]);
  return segs;
}
