/**
 * diffs.work on a GitHub commit page.
 *
 * Why this asks for nothing: a diff plugin that waits for a right-click is not a
 * plugin, it is a bookmarklet. The page already IS a diff — GitHub renders the
 * two sides as rows — so the only missing thing is the comparison the rest of
 * this project shows: a changed line's words highlighted where they differ, not
 * the whole line painted green.
 *
 * So this module reads what GitHub drew (it does not fetch anything, does not
 * leave the page, and does not open a tab), pairs each run of removed lines with
 * the run of added lines that replaced it, and marks the word-level differences
 * inside those rows. GitHub's own `+`/`-` background stays; what is added is the
 * precise span, which is what makes a one-word change in a long line readable.
 *
 * The selectors are the ones the live page actually uses (measured 2026-11-27):
 * `tr.diff-line-row`, `td.diff-line-number`, `td.diff-text-cell`, and the side is
 * spelled `left-side-diff-cell` / `right-side-diff-cell` on the text cell.
 */
import { diffWords } from "./word-diff";

/** Rows GitHub drew, in page order. */
interface GithubRow {
  readonly element: HTMLTableRowElement;
  readonly side: "old" | "new" | "context" | "hunk";
  readonly text: string;
}

const TEXT_CELL = "td.diff-text-cell";
const LEFT = "left-side-diff-cell";
const RIGHT = "right-side-diff-cell";

/**
 * Read one row's side and text.
 * @param row - the `tr` GitHub drew.
 * @returns the row, or null when it is not a line of the diff.
 */
function readRow(row: HTMLTableRowElement): GithubRow | null {
  const cell = row.querySelector<HTMLElement>(TEXT_CELL);
  if (cell === null) return null;
  const cls = cell.className;
  const raw = cell.textContent ?? "";
  // GitHub marks the SIDE with a class and the CHANGE with the line's first character. Measured on
  // a live commit page: an unchanged row and an added row carry the same classes
  // (`right-side-diff-cell left-side`); only the text distinguishes them, with `+` and `-` prefixes
  // that GitHub also draws as its own gutter. Classifying by class alone made every context row
  // look added and paired nothing correctly.
  const text = raw.startsWith("+") || raw.startsWith("-") ? raw.slice(1) : raw;
  if (!cls.includes(LEFT) && !cls.includes(RIGHT)) return { element: row, side: "hunk", text: raw.trim() };
  if (cls.includes(LEFT) && !cls.includes(RIGHT)) return { element: row, side: "old", text };
  if (raw.startsWith("+")) return { element: row, side: "new", text };
  if (raw.startsWith("-")) return { element: row, side: "old", text };
  return { element: row, side: "context", text };
}

/**
 * Every diff row on the page, in order.
 * @param doc - the document to read.
 * @returns the rows that are lines of the diff.
 */
function readRows(doc: Document): GithubRow[] {
  const out: GithubRow[] = [];
  for (const row of doc.querySelectorAll<HTMLTableRowElement>("tr.diff-line-row")) {
    const read = readRow(row);
    if (read !== null) out.push(read);
  }
  return out;
}

/** One run of removed lines and the added lines that replaced it. */
interface Pair {
  readonly removed: GithubRow[];
  readonly added: GithubRow[];
}

/**
 * Group the runs of a diff into before/after pairs.
 *
 * GitHub draws deletions and then insertions for one change, so a pair is a run
 * of `old` followed by a run of `new`. Pairing them by index is what lets a
 * one-line replacement be compared as a word edit instead of as two unrelated
 * lines.
 * @param rows - the diff rows, in page order.
 * @returns the paired runs; unpaired rows are dropped (there is nothing to compare).
 */
function pairRuns(rows: GithubRow[]): Pair[] {
  const pairs: Pair[] = [];
  let removed: GithubRow[] = [];
  let added: GithubRow[] = [];
  const flush = (): void => {
    if (removed.length > 0 && added.length > 0) {
      const width = Math.min(removed.length, added.length);
      for (let i = 0; i < width; i += 1) pairs.push({ removed: [removed[i]], added: [added[i]] });
    }
    removed = [];
    added = [];
  };
  for (const row of rows) {
    if (row.side === "old") {
      if (added.length > 0) flush();
      removed.push(row);
      continue;
    }
    if (row.side === "new") {
      added.push(row);
      continue;
    }
    flush();
  }
  flush();
  return pairs;
}

/** Marker attribute, so a second pass over the same page changes nothing. */
const MARK = "data-diffs-work-spans";

/**
 * Replace a cell's text with spans that mark the differences.
 * @param cell - the text cell to rewrite.
 * @param segments - word segments from the comparison.
 */
function paint(cell: HTMLElement, segments: Array<{ text: string; changed: boolean }>): void {
  const fragment = document.createDocumentFragment();
  for (const segment of segments) {
    if (segment.text === "") continue;
    if (!segment.changed) {
      fragment.appendChild(document.createTextNode(segment.text));
      continue;
    }
    const mark = document.createElement("span");
    mark.className = "diffs-work-word";
    mark.textContent = segment.text;
    fragment.appendChild(mark);
  }
  cell.textContent = "";
  cell.appendChild(fragment);
  cell.setAttribute(MARK, "1");
}

/**
 * Annotate every changed pair on the page.
 *
 * Safe to call repeatedly: a cell that already carries the marker is left alone,
 * so a re-render by GitHub's own React tree does not stack spans.
 * @param doc - the document to annotate.
 * @returns how many line pairs were annotated.
 */
export function annotateGithubDiff(doc: Document): number {
  let annotated = 0;
  for (const pair of pairRuns(readRows(doc))) {
    const before = pair.removed[0]?.element.querySelector<HTMLElement>(TEXT_CELL);
    const after = pair.added[0]?.element.querySelector<HTMLElement>(TEXT_CELL);
    if (!before || !after) continue;
    if (before.hasAttribute(MARK) && after.hasAttribute(MARK)) continue;
    const [oldSegments, newSegments] = diffWords(
      pair.removed[0].text,
      pair.added[0].text,
    );
    paint(before, oldSegments);
    paint(after, newSegments);
    annotated += 1;
  }
  return annotated;
}

/** Stylesheet for the marks; kept here so the page needs nothing loaded. */
export const GITHUB_STYLES = `
.diffs-work-word{background:rgba(255,129,130,.35);border-radius:2px;outline:1px solid rgba(255,129,130,.5)}
.diff-line-row .diffs-work-word{position:relative}
`;

/**
 * Is this a page whose diff should be annotated?
 * @param url - the page URL.
 * @returns true for a GitHub commit / compare / pull-request files page.
 */
export function isGithubDiffPage(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "github.com") return false;
    return /\/(commit|compare|pull)\//.test(parsed.pathname)
      || /\/(files|changes)$/.test(parsed.pathname);
  } catch {
    return false;
  }
}