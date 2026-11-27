/**
 * Compare a Word or PowerPoint package in plain TypeScript.
 *
 * The kernel does this too, in Rust → wasm. But a tool that runs inside an agent host cannot
 * assume it can instantiate a 600 KB wasm module: the DeepSeek Harness plugin got `null` back from
 * the kernel and reported "NOT COMPARED" for every .docx while the same call from the CLI worked.
 *
 * A .docx is a zip of XML. Pulling the paragraph text out and comparing it needs no wasm, no
 * native module and no child process — so this runs wherever the CLI runs, and the plugin stops
 * being the one surface that cannot diff a document.
 */
import { readZip, readText } from "@diffs/core-xlsx/zip";

export interface Revision {
  /** which part of the package, e.g. `word/document.xml` or `ppt/slides/slide3.xml` */
  part: string;
  /** removed paragraph text, when this revision deletes one */
  old?: string;
  /** inserted paragraph text */
  new?: string;
  /** true when the two sides were paired as one edit rather than an insert plus a delete */
  paired?: boolean;
  segments?: Array<{ op: "same" | "ins" | "del"; text: string }> | null;
}

export interface OoxmlDiff {
  kind: "docx" | "pptx";
  added: number;
  removed: number;
  summary: string;
  /** revisions in document order */
  revisions: Revision[];
  /** the paragraph text of each side, in order — the viewers lay these out */
  paragraphs: string[];
  oldParagraphs: string[];
}

/** The XML entity set that actually appears in OOXML text runs. */
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * The visible text of each paragraph, in order.
 *
 * Word keeps a paragraph's characters in `<w:t>` runs, and a single paragraph can be split across
 * any number of them; joining the runs of one `<w:p>` is what makes a sentence comparable.
 */
export function docxParagraphs(xml: string): string[] {
  const out: string[] = [];
  for (const p of xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)) {
    const body = p[1] ?? "";
    if (/<w:pPr>[\s\S]*?<w:del\b/.test(body)) continue; // a tracked deletion, not current text
    const text = [...body.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => decodeEntities(m[1])).join("");
    out.push(text);
  }
  return out;
}

/** The visible text of each slide, one entry per slide in slide order. */
export function pptxSlides(files: Record<string, Uint8Array>): Array<{ part: string; paragraphs: string[] }> {
  const names = Object.keys(files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(/(\d+)/.exec(a)?.[1] ?? 0) - Number(/(\d+)/.exec(b)?.[1] ?? 0));
  return names.map((part) => {
    const xml = readText(files as never, part) ?? "";
    const paragraphs = [...xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)]
      .map((p) => [...(p[1] ?? "").matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)].map((t) => decodeEntities(t[1])).join(""))
      .filter((t) => t.length > 0);
    return { part, paragraphs };
  });
}

/** Longest-common-subsequence over two paragraph lists, as index pairs. */
function lcs<T>(a: T[], b: T[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i += 1;
    else j += 1;
  }
  return pairs;
}

/** Word-level segments for a pair of paragraphs that are similar enough to be one edit. */
function segmentsOf(oldText: string, newText: string): Array<{ op: "same" | "ins" | "del"; text: string }> {
  const a = oldText.match(/\S+\s*/g) ?? [];
  const b = newText.match(/\S+\s*/g) ?? [];
  const keep = new Set(lcs(a, b).map(([i]) => i));
  const out: Array<{ op: "same" | "ins" | "del"; text: string }> = [];
  const bKeep = new Set(lcs(a, b).map(([, j]) => j));
  let ai = 0;
  let bi = 0;
  while (ai < a.length || bi < b.length) {
    if (ai < a.length && !keep.has(ai)) {
      out.push({ op: "del", text: a[ai++] });
    } else if (bi < b.length && !bKeep.has(bi)) {
      out.push({ op: "ins", text: b[bi++] });
    } else {
      out.push({ op: "same", text: a[ai++] });
      bi += 1;
    }
  }
  return out.filter((s) => s.text.length > 0);
}

/**
 * Compare two paragraph lists and describe the difference as edits.
 *
 * Paragraphs that share almost all their words become one paired revision with word segments —
 * that is the case a reader cares about ("the amount changed"), and reporting it as one delete
 * plus one insert buries it.
 */
export function diffParagraphs(
  part: string,
  oldParas: string[],
  newParas: string[],
): Revision[] {
  const pairs = lcs(oldParas, newParas);
  const out: Revision[] = [];
  let oi = 0;
  let ni = 0;
  for (const [pi, pj] of [...pairs, [oldParas.length, newParas.length] as [number, number]]) {
    const dels = oldParas.slice(oi, pi);
    const ins = newParas.slice(ni, pj);
    // pair a delete with an insert when they are recognisably the same sentence
    const used = new Set<number>();
    for (const d of dels) {
      const cand = ins.findIndex((x, k) => !used.has(k) && similarity(d, x) >= 0.5);
      if (cand >= 0) {
        used.add(cand);
        out.push({ part, old: d, new: ins[cand], paired: true, segments: segmentsOf(d, ins[cand]) });
      } else {
        out.push({ part, old: d });
      }
    }
    ins.forEach((x, k) => {
      if (!used.has(k)) out.push({ part, new: x });
    });
    oi = pi + 1;
    ni = pj + 1;
  }
  return out;
}

/** Fraction of the longer paragraph's words that both share, 0..1. */
function similarity(a: string, b: string): number {
  const aw = a.match(/\S+/g) ?? [];
  const bw = b.match(/\S+/g) ?? [];
  if (!aw.length || !bw.length) return 0;
  const shared = lcs(aw, bw).length;
  return shared / Math.max(aw.length, bw.length);
}

/** Compare two .docx packages. */
export function diffDocx(oldBytes: Uint8Array, newBytes: Uint8Array): OoxmlDiff {
  const a = readZip(oldBytes);
  const b = readZip(newBytes);
  const oldXml = readText(a, "word/document.xml") ?? "";
  const newXml = readText(b, "word/document.xml") ?? "";
  const oldParagraphs = docxParagraphs(oldXml);
  const paragraphs = docxParagraphs(newXml);
  const revisions = diffParagraphs("word/document.xml", oldParagraphs, paragraphs);
  return summarize("docx", revisions, paragraphs, oldParagraphs);
}

/** Compare two .pptx packages, slide by slide. */
export function diffPptx(oldBytes: Uint8Array, newBytes: Uint8Array): OoxmlDiff {
  const a = readZip(oldBytes) as unknown as Record<string, Uint8Array>;
  const b = readZip(newBytes) as unknown as Record<string, Uint8Array>;
  const oldSlides = pptxSlides(a);
  const newSlides = pptxSlides(b);
  const revisions: Revision[] = [];
  const max = Math.max(oldSlides.length, newSlides.length);
  for (let i = 0; i < max; i += 1) {
    const o = oldSlides[i];
    const n = newSlides[i];
    if (!o && n) {
      for (const p of n.paragraphs) revisions.push({ part: n.part, new: p });
      continue;
    }
    if (o && !n) {
      for (const p of o.paragraphs) revisions.push({ part: o.part, old: p });
      continue;
    }
    if (!o || !n) continue;
    revisions.push(...diffParagraphs(n.part, o.paragraphs, n.paragraphs));
  }
  return summarize("pptx", revisions, newSlides.flatMap((s) => s.paragraphs), oldSlides.flatMap((s) => s.paragraphs));
}

function summarize(
  kind: "docx" | "pptx",
  revisions: Revision[],
  paragraphs: string[],
  oldParagraphs: string[],
): OoxmlDiff {
  const inserted = revisions.filter((r) => r.new != null && r.old == null).length;
  const deleted = revisions.filter((r) => r.old != null && r.new == null).length;
  const edited = revisions.filter((r) => r.old != null && r.new != null).length;
  return {
    kind,
    added: inserted,
    removed: deleted,
    summary: `${inserted} insertion(s) / ${deleted} deletion(s) / ${edited} edit(s) across ${
      new Set(revisions.map((r) => r.part)).size || 1
    } part(s)`,
    revisions,
    paragraphs,
    oldParagraphs,
  };
}
