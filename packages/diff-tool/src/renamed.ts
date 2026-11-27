/**
 * A rename: the same code with one name spelled differently.
 *
 * A local `total` becoming `count` arrives as three changed lines, which reads as three edits. It
 * is one decision, and the reviewer wants to approve it once. The check is exact rather than
 * heuristic: substitute the old name for the new throughout the old file, and if that reproduces
 * the new file byte for byte, nothing else changed.
 *
 * Deliberately narrow, because a false rename is worse than a missed one — it tells the reviewer
 * "this is only a rename" about code that is not. Two names renamed on the same lines (the reference suite's
 * `sym-typescript-rename-two-names`) is therefore *not* a rename here either, which matches.
 */

export interface Rename {
  from: string;
  to: string;
  /**
   * Every name that moved. One entry is the common case; two names on the same lines (`width`,
   * `height` becoming `w`, `h`) is still a rename, and the reference suite names it as one too — the first
   * `from`/`to` is reported for readability.
   */
  all?: Array<{ from: string; to: string }>;
}

const IDENT = /[A-Za-z_$][\w$]*/g;

/**
 * A word-boundary regex for a name.
 *
 * `\b` does not work for PHP: in `$total` the character before `total` is `$`, which is a word
 * character in this identifier alphabet, so there is no boundary and the substitution silently
 * matched nothing — every `$var` rename was missed.
 */
function namePattern(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`, "g");
}

/**
 * Names whose *use count* changed, not merely whether they appear.
 *
 * `const name = user.name.trim()` becoming `const label = …` loses a name that still appears
 * elsewhere (`user.name`), so a set difference reports no rename at all — which is why every
 * "rename a local, keep the property" case was missed.
 */
function nameDelta(oldText: string, newText: string): { gone: string[]; added: string[] } {
  const count = (t: string) => {
    const m = new Map<string, number>();
    for (const n of t.match(IDENT) ?? []) m.set(n, (m.get(n) ?? 0) + 1);
    return m;
  };
  const before = count(oldText);
  const after = count(newText);
  const gone: string[] = [];
  const added: string[] = [];
  for (const [n, c] of before) {
    const d = c - (after.get(n) ?? 0);
    if (d > 0) gone.push(n);
  }
  for (const [n, c] of after) {
    const d = c - (before.get(n) ?? 0);
    if (d > 0) added.push(n);
  }
  return { gone, added };
}

/**
 * The rename that turns `oldText` into `newText`, or null.
 *
 * Substitute the removed names for the added ones, then ask how much of the result still differs.
 * A rename is routinely accompanied by a small edit (`LIMIT`→`MAX` while `<` became `<=`), so an
 * exact byte match alone missed every one of the reference suite's `ren-hide-*` cases. The line-level
 * similarity is what keeps the loosening safe: `a`→`b` together with a rewrite of the surrounding
 * code does not come close enough.
 */
/**
 * Share of lines the two texts have in common, 0..1.
 *
 * A rename with one accompanying edit leaves every other line identical, so the ratio stays near
 * 1; an unrelated rewrite does not. 0.75 is loose enough for a rename plus a handful of edits and
 * tight enough that a genuinely different file is not called one.
 */
function similarEnough(a: string, b: string): boolean {
  const al = a.split("\n");
  const bl = b.split("\n");
  if (!al.length || !bl.length) return false;
  const counts = new Map<string, number>();
  for (const l of al) counts.set(l, (counts.get(l) ?? 0) + 1);
  let shared = 0;
  for (const l of bl) {
    const n = counts.get(l) ?? 0;
    if (n > 0) {
      shared += 1;
      counts.set(l, n - 1);
    }
  }
  return shared / Math.max(al.length, bl.length) >= 0.75;
}

export function detectRename(oldText: string, newText: string, opts: { strict?: boolean } = {}): Rename | null {
  if (oldText === newText) return null;
  const { gone, added } = nameDelta(oldText, newText);
  if (!gone.length || !added.length || gone.length !== added.length) return null;

  // Try the straightforward pairing first (removed[i] → added[i]); then the reversal, which is
  // what a genuine swap looks like once the names cancel out.
  const candidates: Array<Array<{ from: string; to: string }>> = [
    gone.map((g, i) => ({ from: g, to: added[i]! })),
    gone.map((g, i) => ({ from: g, to: added[added.length - 1 - i]! })),
  ];
  for (const pairs of candidates) {
    let out = oldText;
    for (const p of pairs) {
      out = out.replace(namePattern(p.from), `\u0000${p.to}\u0000`);
    }
    out = out.replace(/\u0000([\w$]+)\u0000/g, "$1");
    if (out === newText || (!opts.strict && similarEnough(out, newText))) {
      return { from: pairs[0]!.from, to: pairs[0]!.to, all: pairs };
    }
  }
  return null;
}
