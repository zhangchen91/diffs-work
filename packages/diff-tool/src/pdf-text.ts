/**
 * PDF comparison outside a browser.
 *
 * The viewer compares PDFs with pdf.js because it already loads it for rendering. A CLI or a
 * plugin has no browser, which is why this family used to answer "open the local viewer" — an
 * answer an agent calling a diff tool cannot use.
 *
 * pdf.js itself runs headless: it needs a worker script and nothing else. Its own warnings about
 * `DOMMatrix` and `@napi-rs/canvas` concern *rendering*, which this module never does — it reads
 * the text layer, which is geometry plus strings.
 *
 * What it compares: every page's text items, grouped into lines by their baseline, and the lines
 * aligned page by page. A page with no text layer (a scan) is reported as such rather than being
 * called empty.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** One line of text with where it sits on the page. */
export interface PdfTextLine {
  page: number;
  text: string;
}

/** The extracted text of a whole document. */
export interface PdfTextDoc {
  pages: number;
  lines: PdfTextLine[];
  /** Pages that carried no extractable text, 1-based. */
  emptyPages: number[];
}

/** One row of the comparison. */
export interface PdfTextRow {
  op: "same" | "add" | "del" | "mod" | "move";
  page: number;
  oldText?: string;
  newText?: string;
  oldIndex?: number;
  newIndex?: number;
  /** True when the line only moved because another line was inserted or removed above it. */
  shifted?: boolean;
}

/** The comparison of two documents. */
export interface PdfTextDiff {
  oldPages: number;
  newPages: number;
  oldEmpty: number[];
  newEmpty: number[];
  added: number;
  removed: number;
  modified: number;
  moved: number;
  rows: PdfTextRow[];
}

/** Minimal shape of the pdf.js entry this module uses. */
interface PdfJsModule {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(options: Record<string, unknown>): { promise: Promise<PdfDocument> };
}

interface PdfDocument {
  numPages: number;
  getPage(page: number): Promise<PdfPage>;
}

interface PdfPage {
  getTextContent(): Promise<{ items: Array<{ str?: string; transform?: number[] }> }>;
}

/** Cached module, so a comparison of several pairs loads pdf.js once. */
let pdfjs: Promise<PdfJsModule | null> | null = null;

/**
 * Locate the pdf.js build the site ships.
 *
 * Two locations, because this package is used from the repository and from an installed CLI:
 * the site's public directory holds the vendored copy, and `engine.lock.json` records that the
 * same file is what the viewer loads.
 * @returns the directory holding `pdf.mjs`, or null when the build is absent.
 */
async function pdfjsDir(): Promise<string | null> {
  // `import.meta.dirname` is the SOURCE directory when this module runs from TypeScript and the
  // BUNDLE's directory when it runs from `apps/cli/lib/bin.js`, so every plausible depth is tried
  // rather than assuming one. The first version assumed the source layout and silently fell back to
  // "NOT COMPARED" in the CLI, which is exactly the bug this family was supposed to lose.
  const here = import.meta.dirname;
  const candidates = [
    // packages/diff-tool/src → repository root
    path.resolve(here, "../../../apps/website/public/engine/pdfjs"),
    // apps/cli/lib (the bundled CLI) → repository root
    path.resolve(here, "../../website/public/engine/pdfjs"),
    // an installed layout: the engine shipped beside the package
    path.resolve(here, "../engine/pdfjs"),
  ];
  const { existsSync } = await import("node:fs");
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "pdf.mjs"))) return candidate;
  }
  return null;
}

/**
 * Load pdf.js, pointed at the worker it ships with.
 * @returns the module, or null when the build is not on this machine.
 */
async function loadPdfjs(): Promise<PdfJsModule | null> {
  if (pdfjs !== null) return pdfjs;
  pdfjs = (async () => {
    const dir = await pdfjsDir();
    if (dir === null) return null;
    const module = await importQuietly(pathToFileURL(path.join(dir, "pdf.mjs")).href) as unknown as PdfJsModule;
    // Without a worker pdf.js refuses to start a document at all ("Setting up fake worker failed").
    // The shipped build is the minified worker; `pdf.js` defaults to the non-minified name. This
    // check used a `require()` shim, which does not exist in the bundled ESM CLI — it answered
    // "missing" for a file that was right there, and every PDF then failed to open.
    const { existsSync } = await import("node:fs");
    const worker = existsSync(path.join(dir, "pdf.worker.min.mjs")) ? "pdf.worker.min.mjs" : "pdf.worker.mjs";
    module.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(dir, worker)).href;
    return module;
  })();
  return pdfjs;
}

/**
 * Import pdf.js without letting its warnings reach stdout.
 *
 * Loaded under Node, pdf.js logs `Warning: Cannot load "@napi-rs/canvas"` and two more lines about
 * `DOMMatrix`/`ImageData` to **stdout**. Those concern rendering, which this module never does, but
 * on a process whose stdout is the answer — `diffs diff --json`, the MCP server, a plugin's tool
 * result — three warning lines turn valid JSON into a parse error.
 * @param href - the module URL.
 * @returns the module.
 */
async function importQuietly(href: string): Promise<unknown> {
  const original = process.stdout.write.bind(process.stdout);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the signature has several overloads
  (process.stdout as any).write = (chunk: unknown, ...rest: unknown[]): boolean => {
    const text = typeof chunk === "string" ? chunk : Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    if (text.startsWith("Warning:")) {
      // Keep the warning, but on stderr, where a diagnostic belongs.
      process.stderr.write(text);
      const callback = rest.find((value) => typeof value === "function") as (() => void) | undefined;
      callback?.();
      return true;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- forwarding the original overloads
    return (original as any)(chunk, ...rest);
  };
  try {
    return await import(href);
  } finally {
    process.stdout.write = original;
  }
}

/**
 * Read a PDF's text layer.
 * @param file - path to the PDF.
 * @returns its lines and page facts.
 * @throws when pdf.js is not available or the file cannot be parsed.
 */
export async function readPdfText(file: string): Promise<PdfTextDoc> {
  const module = await loadPdfjs();
  if (module === null) throw new Error("pdf.js is not on this machine; run `pnpm sync:engine` to place it");
  const data = new Uint8Array(await readFile(file));
  const doc = await module.getDocument({ data, isEvalSupported: false, disableFontFace: true }).promise;
  const lines: PdfTextLine[] = [];
  const emptyPages: number[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const byBaseline = new Map<number, string[]>();
    for (const item of content.items) {
      const str = item.str ?? "";
      if (str.trim() === "") continue;
      // A baseline key keeps two columns on one visual line from being merged into one sentence.
      const baseline = Math.round((item.transform?.[5] ?? 0) * 2) / 2;
      const bucket = byBaseline.get(baseline) ?? [];
      bucket.push(str);
      byBaseline.set(baseline, bucket);
    }
    if (byBaseline.size === 0) {
      emptyPages.push(pageNumber);
      continue;
    }
    // pdf.js emits items in reading order; a Map preserves that, so the baselines are not re-sorted.
    for (const [, parts] of byBaseline) lines.push({ page: pageNumber, text: parts.join(" ").trim() });
  }
  return { pages: doc.numPages, lines, emptyPages };
}

/**
 * Compare two documents line by line, page by page.
 *
 * Lines are aligned per page with a longest-common-subsequence pass, so a paragraph inserted in
 * the middle shifts nothing and a changed sentence is one `mod` row rather than a delete plus an
 * insert.
 * @param oldFile - the earlier PDF.
 * @param newFile - the later PDF.
 * @returns the comparison.
 */
export async function diffPdfText(oldFile: string, newFile: string): Promise<PdfTextDiff> {
  const [before, after] = await Promise.all([readPdfText(oldFile), readPdfText(newFile)]);
  const rows: PdfTextRow[] = [];
  let added = 0;
  let removed = 0;
  let modified = 0;
  let moved = 0;
  const pages = Math.max(before.pages, after.pages);
  for (let page = 1; page <= pages; page += 1) {
    const oldLines = before.lines.filter((line) => line.page === page).map((line) => line.text);
    const newLines = after.lines.filter((line) => line.page === page).map((line) => line.text);
    const pairs = alignLines(oldLines, newLines);
    for (const pair of pairs) {
      if (pair.op === "same") continue;
      if (pair.op === "mod") modified += 1;
      else if (pair.op === "add") added += 1;
      else if (pair.op === "move") moved += 1;
      else removed += 1;
      rows.push({ ...pair, page });
    }
  }
  return {
    oldPages: before.pages,
    newPages: after.pages,
    oldEmpty: before.emptyPages,
    newEmpty: after.emptyPages,
    added,
    removed,
    modified,
    moved,
    rows,
  };
}

/**
 * Align two pages' lines, keeping the four operations a reader distinguishes.
 *
 * A symmetric LCS pass alone reports a reordered paragraph as a delete plus an insert, and a
 * reworded one as two unrelated lines. The reference for this fixture is one add, one delete, one
 * modification and one move, so:
 *
 *  - a line that survived at a different position is a `move`, not a delete/insert pair;
 *  - an adjacent delete/insert pair whose text shares most of its characters is a `mod`;
 *  - everything else stays an add or a delete.
 * @param oldLines - the earlier page's lines.
 * @param newLines - the later page's lines.
 * @returns the rows for this page, in order.
 */
function alignLines(oldLines: string[], newLines: string[]): PdfTextRow[] {
  const usedOld = new Set<number>();
  const usedNew = new Set<number>();
  const rows: PdfTextRow[] = [];

  // Pass 1 — identical text. Most of these are merely shifted by another line being inserted or
  // removed, which is not a move: a move is a line that crossed at least one line that stayed put.
  // Reporting the shift as a move inflated this fixture from one move to three.
  const survivors: Array<{ oldIndex: number; newIndex: number }> = [];
  for (let i = 0; i < oldLines.length; i += 1) {
    for (let j = 0; j < newLines.length; j += 1) {
      if (usedNew.has(j)) continue;
      if (oldLines[i] !== newLines[j]) continue;
      usedOld.add(i);
      usedNew.add(j);
      survivors.push({ oldIndex: i, newIndex: j });
      break;
    }
  }
  // A move is the line that had to cross the others: of a crossed pair, exactly one is reported,
  // the one whose old position was pushed furthest. Reporting both described one reordering twice.
  const crossedBy = new Map<number, number[]>();
  for (let a = 0; a < survivors.length; a += 1) {
    for (let b = a + 1; b < survivors.length; b += 1) {
      const left = survivors[a];
      const right = survivors[b];
      const orderKept = (left.oldIndex < right.oldIndex) === (left.newIndex < right.newIndex);
      if (orderKept) continue;
      const pushed = Math.abs(left.oldIndex - left.newIndex) >= Math.abs(right.oldIndex - right.newIndex) ? a : b;
      const list = crossedBy.get(pushed) ?? [];
      list.push(pushed === a ? b : a);
      crossedBy.set(pushed, list);
    }
  }
  for (const [index, survivor] of survivors.entries()) {
    const displaced = (crossedBy.get(index) ?? []).length > 0;
    const shiftedOnly = survivor.oldIndex !== survivor.newIndex;
    rows.push({
      op: displaced ? "move" : "same",
      page: 0,
      oldText: oldLines[survivor.oldIndex],
      newText: newLines[survivor.newIndex],
      oldIndex: survivor.oldIndex,
      newIndex: survivor.newIndex,
      ...(shiftedOnly && !displaced ? { shifted: true } : {}),
    });
  }

  // Pass 2 — a removed line and an added line in similar positions with a similar text is a
  // modification. Anything left over is a real insertion or deletion.
  const freeOld = oldLines.map((_, index) => index).filter((index) => !usedOld.has(index));
  const freeNew = newLines.map((_, index) => index).filter((index) => !usedNew.has(index));
  const pairedNew = new Set<number>();
  for (const i of freeOld) {
    let best = -1;
    let bestScore = 0;
    for (const j of freeNew) {
      if (pairedNew.has(j)) continue;
      const score = similarity(oldLines[i], newLines[j]);
      if (score > bestScore) {
        bestScore = score;
        best = j;
      }
    }
    // Below this the two lines are unrelated: calling them a modification would hide a real insert.
    if (best >= 0 && bestScore >= 0.6) {
      usedOld.add(i);
      pairedNew.add(best);
      rows.push({ op: "mod", page: 0, oldText: oldLines[i], newText: newLines[best], oldIndex: i, newIndex: best });
    }
  }
  for (const i of freeOld) {
    if (!usedOld.has(i)) rows.push({ op: "del", page: 0, oldText: oldLines[i], oldIndex: i });
  }
  for (const j of freeNew) {
    if (!pairedNew.has(j)) rows.push({ op: "add", page: 0, newText: newLines[j], newIndex: j });
  }
  // Report in the new file's order, with deletions attached to where they used to sit.
  return rows.sort((left, right) => {
    const leftKey = left.op === "del" ? (left.oldIndex ?? 0) : (left.newIndex ?? 0);
    const rightKey = right.op === "del" ? (right.oldIndex ?? 0) : (right.newIndex ?? 0);
    return leftKey - rightKey;
  });
}

/**
 * How much two lines have in common, by character overlap.
 * @param left - one line.
 * @param right - the other.
 * @returns a ratio between 0 and 1.
 */
function similarity(left: string, right: string): number {
  const a = [...left];
  const b = [...right];
  if (a.length === 0 && b.length === 0) return 1;
  const counts = new Map<string, number>();
  for (const char of a) counts.set(char, (counts.get(char) ?? 0) + 1);
  let shared = 0;
  for (const char of b) {
    const left_count = counts.get(char) ?? 0;
    if (left_count > 0) {
      shared += 1;
      counts.set(char, left_count - 1);
    }
  }
  return (2 * shared) / (a.length + b.length);
}
