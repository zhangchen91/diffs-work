/**
 * Whitespace-only hunks: the change exists, but nothing about the code changed.
 *
 * A reindent, a trailing-space cleanup, a run through a formatter — every one of these arrives as
 * an `update` hunk whose two sides are equal once trimmed. Reporting them as edits makes a
 * formatter commit look like a rewrite, which is the first thing a reviewer has to unlearn.
 *
 * The rule is narrow on purpose: same number of lines on both sides, every line equal after
 * `trim()`, and at least one non-empty line (an all-blank block is a deletion, not a reformat).
 * Python is excluded by the caller, where indentation is syntax.
 */

export interface HunkLike {
  operation: string;
  beforeStart: number | null;
  beforeEnd: number | null;
  afterStart: number | null;
  afterEnd: number | null;
}

/** True when every line of the hunk differs only in leading/trailing whitespace. */
export function isReformatOnly(
  oldLines: string[],
  newLines: string[],
  oldRange: [number, number],
  newRange: [number, number],
): boolean {
  const [os, oe] = oldRange;
  const [ns, ne] = newRange;
  const oldCount = oe - os + 1;
  const newCount = ne - ns + 1;
  if (oldCount <= 0 || newCount <= 0) return false;
  // Compare the block with all whitespace removed, not line by line: a formatter also changes how
  // many lines a statement occupies (`function a() { return 1; }` becomes four lines), and a
  // line-count check rejected exactly the case a reader most wants labelled "reformatted".
  const strip = (lines: string[], from: number, count: number) =>
    lines.slice(from - 1, from - 1 + count).join("").replace(/\s+/g, "");
  const a = strip(oldLines, os, oldCount);
  const b = strip(newLines, ns, newCount);
  if (!a || a !== b) return false;
  // A block with no characters at all is a deletion of blank lines, not a reformat.
  return true;
}
