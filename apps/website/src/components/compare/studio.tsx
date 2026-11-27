import * as React from "react";
import { DiffPane, runComparison, type CodeFromRust, type OpcFromRust, AstDiffView, DocxFlowView, HunkView, OpcRevisionList, PdfDiffView, PptxDeckView, RichHunkView, SemanticDiffView, UnsupportedPanel, XlsxDiffView, rustToHunks, type AstDiffResult, type RichHunk, type SemDiffResult, type SemMove } from "@diffs/diff-ui";

import {
  ArrowLeftRight,
  CheckCircle2,
  FileCode2,
  FileText,
  FileType2,
  ChevronRight,
  GitCompareArrows,
  Loader2,
  Lock,
  Network,
  Presentation,
  Sheet,
  Upload,
  X,
  Image,
  Table2,
} from "lucide-react";
import { formatBytes, pairIdFromHash } from "@/lib/router";
import { decodeText, isBinary, looksGarbled } from "@/lib/decode";
import { cn } from "@/lib/utils";
import { familyOf, formatMeta, NEEDS_ENGINE, type Family, type FormatMeta } from "@/lib/formats";
import { SAMPLES, loadSample, loadSampleFiles, type Sample } from "@/lib/samples";
import { compareXlsx, type WorkbookDiff } from "@diffs/core-xlsx";
import { diffMarkdown, summarizeMarkdown, type MarkdownDiffResult } from "@diffs/core-markdown";
import { diffSource, type CodeDiffResult as AstCodeDiffResult } from "@diffs/core-code-ast";
import { diffPdf, type PdfDiff } from "@diffs/core-pdf";
import { Badge, Button, Card } from "@/components/ui/primitives";
import { type TextDiffResult } from "@diffs/core-text";
import { diffText as legacyDiffText } from "@diffs/core-text";
import { downloadText } from "@diffs/dom-utils/download";
import { useI18n } from "@diffs/i18n";
import { loadRustEngine, toBase64, type SymbolGraph, type TypeSection, type SymbolRow } from "@diffs/engine-bundle";

const FICON: Record<Family, typeof FileText> = {
  "legacy-office": FileText,
  docx: FileText,
  xlsx: Sheet,
  pptx: Presentation,
  pdf: FileType2,
  markdown: FileText,
  text: FileText,
  code: FileCode2,
  svg: Image,
  csv: Table2,
};

type Side = "old" | "new";

/** Payloads from the Rust kernels (apps/engine-core). */
/** What the Rust sheet kernel returns; adapted to WorkbookDiff for the viewer. */
interface RustSheetDiff {
  engine: string;
  summary: string;
  totals: { added: number; removed: number; modified: number; styleChanged: number; sheets: number };
  sheets: Array<{
    name: string;
    oldName: string | null;
    colWidths?: Array<{ c: number; w: number }>;
    diff: {
      added: number;
      removed: number;
      modified: number;
      styleChanged: number;
      formulaChanged: number;
      changes: Array<{
        ref: string;
        op: "add" | "del" | "mod" | "formula" | "style";
        old?: string;
        new?: string;
        oldFormula?: string;
        newFormula?: string;
        oldStyle?: string;
        newStyle?: string;
        segments?: Array<{ op: "same" | "ins" | "del"; text: string }>;
      }>;
      cfAdded: string[];
      cfRemoved: string[];
    };
    chartsAdded: string[];
    chartsRemoved: string[];
  }>;
}

/** Map the kernel's cell list onto the viewer's WorkbookDiff. */
export function rustSheetToWorkbook(r: RustSheetDiff): WorkbookDiff {
  const sheets = r.sheets.map((s) => {
    const changes = (s.diff.changes || []).map((c) => ({
      ref: c.ref,
      // keep `style` separate: a restyled cell is not a content change, and merging the two
      // buried the real edits under thousands of font/format differences
      op: (c.op === "formula" ? "formula" : c.op) as never,
      old: c.old !== undefined || c.oldFormula || c.oldStyle ? { text: c.old ?? c.oldFormula ?? "", formula: c.oldFormula, } : undefined,
      new: c.new !== undefined || c.newFormula || c.newStyle ? { text: c.new ?? c.newFormula ?? "", formula: c.newFormula } : undefined,
      ...(c.op === "style" && c.oldStyle
        ? { inline: [{ op: "delete" as const, text: c.oldStyle }, { op: "insert" as const, text: `→ ${c.newStyle ?? ""}` }] }
        : {}),
      // the kernel's word-level split of a changed value, so the cell can tint only the
      // characters that moved instead of printing two long clauses
      ...(c.segments?.length
        ? {
            inline: c.segments.map((x) => ({
              op: (x.op === "ins" ? "insert" : x.op === "del" ? "delete" : "equal") as "insert" | "delete" | "equal",
              text: x.text,
            })),
          }
        : {}),
    }));
    return {
      name: s.name,
      oldName: s.oldName && s.oldName !== s.name ? s.oldName : undefined,
      status: s.diff.added + s.diff.removed + s.diff.modified > 0 ? "changed" : "same",
      added: s.diff.added,
      removed: s.diff.removed,
      modified: s.diff.modified,
      styleChanged: s.diff.styleChanged || 0,
      colWidths: Object.fromEntries((s.colWidths ?? []).map((x) => [x.c, x.w])),
      formulaOnly: s.diff.formulaChanged || 0,
      changes: changes as never,
      maxRow: 0,
      maxCol: 0,
      warnings: [],
    };
  });
  return {
    kind: "xlsx",
    sheets,
    totals: {
      added: r.totals.added,
      removed: r.totals.removed,
      modified: r.totals.modified,
      formulaOnly: 0,
      sheets: r.totals.sheets,
    },
    addedSheets: [],
    removedSheets: [],
    warnings: [],
  } as unknown as WorkbookDiff;
}

interface Slot {
  file: File | null;
  text: string;
  name: string;
  /** raw bytes for the binary families (xlsx today) */
  bytes?: ArrayBuffer;
  /** true for zip/pdf input: `text` is empty on purpose */
  binary?: boolean;
  /** loaded from the built-in samples, not from the user's disk */
  sample?: boolean;
}

const emptySlot = (): Slot => ({ file: null, text: "", name: "" });

export function CompareStudio({ showHeroCopy = true }: { showHeroCopy?: boolean }): React.ReactElement {
  const { t } = useI18n();
  const [oldSlot, setOldSlot] = React.useState<Slot>(emptySlot);
  const [newSlot, setNewSlot] = React.useState<Slot>(emptySlot);
  const [busy, setBusy] = React.useState(false);
  // The message is stored as a key, not as text. Messages load asynchronously, and `t()` returns
  // the raw key while they are in flight — a comparison that failed in the first few hundred
  // milliseconds froze `compare.rustFailed` onto the screen forever, because the string had already
  // been built by the time the messages arrived.
  const [error, setErrorState] = React.useState<{ key: string; params?: Record<string, unknown> } | null>(null);
  const setError = React.useCallback(
    (key: string | null, params?: Record<string, unknown>) => setErrorState(key ? { key, params } : null),
    [],
  );
  const [unsupported, setUnsupported] = React.useState<FormatMeta | null>(null);
  const [xlsx, setXlsx] = React.useState<{ diff: WorkbookDiff; summary: string; engine?: string } | null>(null);
  const [opc, setOpc] = React.useState<{ kind: "docx" | "pptx"; result: OpcFromRust } | null>(null);
  const [pdf, setPdf] = React.useState<PdfDiff | null>(null);
  const [graph, setGraph] = React.useState<SymbolGraph | null>(null);
  const [types, setTypes] = React.useState<TypeSection | null>(null);
  const [sem, setSem] = React.useState<SemDiffResult | null>(null);
  const [mode, setMode] = React.useState<"semantic" | "ast" | "unified">("semantic");
  // Old and new side by side in the block view. The split layout existed but nothing ever passed
  // `split`, so it was unreachable from the UI — a view the reference has and we could not open.
  // `undefined` means "let the width decide", which is what the block view did before there was a
  // toggle. The first click pins it to the opposite of what is showing, so the button always
  // changes what you see rather than sometimes matching it.
  const [sideBySide, setSideBySide] = React.useState<boolean | undefined>(undefined);
  // Measured once, on the client. It used to be read during render, so the first frame after a
  // navigation could see the pre-hydration value and open Word in one column on a wide screen.
  const [wide, setWide] = React.useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 900px)").matches);
  React.useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const showingTwoPane = sideBySide ?? wide;
  const [ast, setAst] = React.useState<AstDiffResult | null>(null);
  /** why the AST precision layer is missing: offline fetch, or a browser that cannot run it */
  const [astNotice, setAstNotice] = React.useState<"offline" | "unavailable" | null>(null);
  // bumped on every run so the result pane always reflects the latest pair
  const [runId, setRunId] = React.useState(0);
  const [rich, setRich] = React.useState<{
    kind: "markdown" | "code";
    md?: MarkdownDiffResult;
    code?: AstCodeDiffResult;
    rust?: CodeFromRust;
    summary: string;
    /** the file this result belongs to, used by the test hook to tell two code samples apart */
    name?: string;
  } | null>(null);
  const [result, setResult] = React.useState<TextDiffResult | null>(null);
  const [meta, setMeta] = React.useState<{ family: Family; engine: string; name: string } | null>(null);
  const [ms, setMs] = React.useState(0);
  // the run() callback is memoised; reading the family from `meta` there would see a stale value
  const famRef = React.useRef<Family>("text");
  const fmIsDocx = meta?.family === "docx" || famRef.current === "docx";
  // only when this run actually holds a docx pair (otherwise the badge sticks after switching)
  const oldDocxPair = fmIsDocx && !!oldSlot.bytes && !!newSlot.bytes;
  // one string that changes whenever the visible result changes: tests assert on it
  const resultKey = [
    xlsx ? `xlsx:${xlsx.engine ?? "ts"}:${xlsx.diff.totals.added}/${xlsx.diff.totals.modified}` : "",
    pdf ? `pdf:${pdf.added}/${pdf.removed}/${pdf.changed}` : "",
    opc ? `opc:${opc.result.revisions.length}` : "",
    // the language is what distinguishes the two code samples; `rust` here only said whether
    // the kernel handled it, so both samples reported "rust"
    rich ? `${rich.kind}:${(rich.name ?? "").split(".").pop() || (rich.rust ? "rust" : "ts")}` : "",
    result ? `text:${result.hunks.length}` : "",
  ]
    .filter(Boolean)
    .join("|") || "empty";

  /**
   * One comparison, one result.
   *
   * Every run clears every result slot first and carries a generation number:
   * a slower engine (Rust) that finishes after the user already switched files
   * must not paint over the newer result — that was the "old badges stay behind"
   * bug when switching samples quickly.
   */
  const gen = React.useRef(0);

  const run = React.useCallback((a: Slot, b: Slot) => {
    if (!a.name && !b.name) return;
    const names = [b.name, a.name].filter(Boolean);
    const binaryName = names.find((n) => ["docx", "xlsx", "pptx", "pdf"].includes(familyOf(n)));
    const name = binaryName ?? names[0];
    const fam = familyOf(name);
    const fm = formatMeta(fam);
    const my = ++gen.current;
    // reset once, up front: each run owns exactly one result slot
    setError(null);
    setRunId((n) => n + 1);
    famRef.current = fam;
    setMeta({ family: fam, engine: fm.engine, name });
    setResult(null);
    setXlsx(null);
    setOpc(null);
    setPdf(null);
    setGraph(null);
    setTypes(null);
    setSem(null);
    setAst(null);
    setAstNotice(null);
    setRich(null);
    setUnsupported(null);
    setMs(0);
    const fresh = () => my === gen.current;

    if (fm.id === "xlsx" && a.bytes && b.bytes) {
      const t0 = performance.now();
      (async () => {
        const engine = await loadRustEngine();
        if (!fresh()) return;
        if (engine) {
          try {
            const r = engine.call<RustSheetDiff>({
              cmd: "sheet_diff",
              a: toBase64(a.bytes!),
              b: toBase64(b.bytes!),
            });
            if (!fresh()) return;
            setXlsx({ diff: rustSheetToWorkbook(r), summary: r.summary ?? "", engine: r.engine });
            setMs(Math.round((performance.now() - t0) * 10) / 10);
            return;
          } catch (e) {
            /* fall through to the TS reader */
          }
        }
        if (!fresh()) return;
        try {
          const { diff, summary } = compareXlsx(new Uint8Array(a.bytes!), new Uint8Array(b.bytes!));
          setXlsx({ diff, summary });
        } catch (e) {
          setError("compare.xlsxError", { message: e instanceof Error ? e.message : String(e) });
        }
        setMs(Math.round((performance.now() - t0) * 10) / 10);
      })();
      return;
    }

    if (fm.id === "pdf" && a.bytes && b.bytes) {
      const t0 = performance.now();
      (async () => {
        try {
          const d = await diffPdf(a.bytes!, b.bytes!);
          if (!fresh()) return;
          setPdf(d);
          setMs(Math.round((performance.now() - t0) * 10) / 10);
        } catch (e) {
          if (!fresh()) return;
          setError("compare.pdfFailed", { error: e instanceof Error ? e.message : String(e) });
        }
      })();
      return;
    }
    if ((fm.id === "docx" || fm.id === "pptx") && a.bytes && b.bytes) {
      // docx shows the kernel's paragraph revisions; pptx shows the kernel's per-slide
      // text revisions in the same list
      const t0 = performance.now();
      (async () => {
        const engine = await loadRustEngine();
        if (!fresh()) return;
        if (!engine) {
          setError("compare.rustFailed", { error: "not loaded" });
          return;
        }
        try {
          const r = engine.call<OpcFromRust>({
            cmd: "opc_diff",
            a: toBase64(a.bytes!),
            b: toBase64(b.bytes!),
            kind: fm.id,
          });
          if (!fresh()) return;
          if (r && r.revisions) {
            setOpc({ kind: fm.id as "docx" | "pptx", result: r });
            setMs(Math.round((performance.now() - t0) * 10) / 10);
          } else {
            setError("compare.rustFailed", { error: "empty result" });
          }
        } catch (err) {
          if (!fresh()) return;
          setError("compare.rustFailed", { error: err instanceof Error ? err.message : String(err) });
        }
      })();
      return;
    }

    if ((fm.id === "code" || fm.id === "markdown") && a.text && b.text) {
      // semantic (update / move aware) diff from the Rust kernel runs for both families;
      // the TS engines below still provide the AST/row view when the kernel is unavailable
      (async () => {
        const engine = await loadRustEngine();
        if (!fresh()) return;
        if (!engine) {
          // The kernel (and with it the AST view) is fetched on demand; offline it cannot
          // arrive. Say so instead of silently showing a weaker view.
          setAstNotice(!navigator.onLine ? "offline" : "unavailable");
          return;
        }
        try {
          const r = engine.call<SemDiffResult>({ cmd: "sem_diff", a: a.text, b: b.text, filename: name });
          if (fresh() && r && r.hunks) setSem(r);
        } catch {
          /* the row view stands */
        }
        try {
          const a2 = engine.call<AstDiffResult>({ cmd: "ast_diff", a: a.text, b: b.text, filename: name });
          const nodes = (a2?.after?.hunks?.length ?? 0) + (a2?.before?.hunks?.length ?? 0);
          if (fresh() && a2 && a2.after && nodes > 0) setAst(a2);
        } catch {
          /* the AST view is an extra precision layer */
        }
      })();
    }
    if (fm.id === "code" && a.text && b.text) {
      const t0 = performance.now();
      // TS result immediately, Rust kernel when it is ready (and still current). The kernel chain
      // itself lives in `runComparison`, shared with the local viewer: when it was written out in
      // both places, the local viewer ran two kernels of six and the same pair looked different
      // depending on which app opened it.
      const cd = diffSource(a.text, b.text, name);
      setRich({ kind: "code", code: cd, summary: cd.summary });
      setMs(Math.round((performance.now() - t0) * 10) / 10);
      void (async () => {
        const engine = await loadRustEngine();
        if (!fresh()) return;
        if (!engine) {
          // The kernel (and with it the AST view) is fetched on demand; offline it cannot
          // arrive. Say so instead of silently showing a weaker view.
          setAstNotice(!navigator.onLine ? "offline" : "unavailable");
          return;
        }
        await runComparison(
          { old: a, new: b, family: fm.id, name },
          engine,
          {
            onUpdate: (patch) => {
              if (!fresh()) return;
              if (patch.types) setTypes(patch.types as TypeSection);
              if (patch.graph) setGraph(patch.graph as SymbolGraph);
              if (patch.sem) setSem(patch.sem);
              if (patch.ast) setAst(patch.ast);
              if (patch.code) {
                setRich({ kind: "code", rust: patch.code, summary: patch.code.summary, name });
                setMs(Math.round((performance.now() - t0) * 10) / 10);
              }
            },
          },
        );
      })();
      return;
    }

    if (fm.id === "markdown" && a.text && b.text) {
      const t0 = performance.now();
      const md = diffMarkdown(a.text, b.text);
      setRich({ kind: "markdown", md, summary: summarizeMarkdown(md) });
      setMs(Math.round((performance.now() - t0) * 10) / 10);
      return;
    }

    if (fm.id === "legacy-office") {
      // Before 2007 these were OLE2/BIFF binaries, not zip packages. Falling through to the
      // text diff would compare two binary blobs and report nonsense, so say it plainly.
      setError("compare.legacyFormat", { name });
      return;
    }

    if (NEEDS_ENGINE[fm.id]) {
      // PDF etc.: rendered by their own engine, handed to the local viewer
      setUnsupported(fm);
      return;
    }

    const t0 = performance.now();
    setResult(legacyDiffText(a.text, b.text));
    setMs(Math.round((performance.now() - t0) * 10) / 10);
  }, []);

  // The browser extension stores a pair under chrome.storage.local["pair:<id>"]
  // and opens /#/compare?pair=<id>; pick it up once.
  const pairLoaded = React.useRef<string | null>(null);
  React.useEffect(() => {
    const id = pairIdFromHash(window.location.hash);
    if (!id || pairLoaded.current === id) return;
    pairLoaded.current = id;
    // The page cannot touch chrome.storage (that API belongs to the extension's world);
    // the extension's content script answers this message instead. Without it the URL
    // opened the compare page empty.
    let done = false;
    const onReply = (event: MessageEvent) => {
      const data = event.data as { type?: string; id?: string; pair?: { oldText?: string; newText?: string; oldName?: string; newName?: string } | null } | null;
      if (!data || data.type !== "diffs-work:pair:response" || data.id !== id || done) return;
      done = true;
      window.removeEventListener("message", onReply);
      const pair = data.pair;
      if (!pair) return;
      setOldSlot({ file: null, text: pair.oldText ?? "", name: pair.oldName ?? "old.txt" });
      setNewSlot({ file: null, text: pair.newText ?? "", name: pair.newName ?? "new.txt" });
    };
    window.addEventListener("message", onReply);
    window.postMessage({ type: "diffs-work:pair:request", id }, "*");

    // The local server can also hold a pair (`POST /api/pair` → `#/compare?pair=<id>`), but the
    // page never asked it: the link the endpoint hands out opened an empty comparer unless the
    // browser extension happened to answer the message above. Ask the server as well, and use
    // whichever answers first.
    void (async () => {
      try {
        const res = await fetch(`http://127.0.0.1:5279/api/pair/${id}`);
        if (!res.ok || done) return;
        const data = (await res.json()) as { oldBase64?: string; newBase64?: string; oldName?: string; newName?: string };
        if (!data.oldBase64 || !data.newBase64 || done) return;
        done = true;
        window.removeEventListener("message", onReply);
        const decode = (b64: string): Uint8Array => {
          const bin = atob(b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
          return bytes;
        };
        const asBuffer = (b: Uint8Array): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
        const oldBytes = decode(data.oldBase64);
        const newBytes = decode(data.newBase64);
        const asText = (b: Uint8Array) => new TextDecoder().decode(b);
        setOldSlot({ file: null, text: asText(oldBytes), name: data.oldName ?? "old.txt", bytes: asBuffer(oldBytes) });
        setNewSlot({ file: null, text: asText(newBytes), name: data.newName ?? "new.txt", bytes: asBuffer(newBytes) });
      } catch {
        /* no local server: the extension path above is the only source */
      }
    })();
  }, []);

  React.useEffect(() => {
    // binary families carry no text, so the bytes have to be part of the trigger —
    // otherwise a dropped xlsx/docx/pdf never starts a comparison
    if (oldSlot.name && newSlot.name) run(oldSlot, newSlot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oldSlot.text, oldSlot.name, oldSlot.bytes, newSlot.text, newSlot.name, newSlot.bytes]);

  const loadFiles = async (side: Side, files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => {
      const over = oversizeOf(f.size, f.name);
      if (over) {
        setError(over === "binary" ? "compare.tooLargeBinary" : "compare.tooLargeText", { name: f.name, mb: Math.round(f.size / 1024 / 1024) });
        return false;
      }
      return true;
    });
    if (!list.length) return;
    const setter = side === "old" ? setOldSlot : setNewSlot;
    if (list.length >= 2) {
      // drag both sides at once
      const [f1, f2] = list.slice(0, 2);
      setBusy(true);
      const [r1, r2] = await Promise.all([read(f1), read(f2)]);
      setOldSlot({ file: f1, text: r1.text, bytes: r1.bytes, name: f1.name });
      setNewSlot({ file: f2, text: r2.text, bytes: r2.bytes, name: f2.name });
      setBusy(false);
      return;
    }
    const f = list[0];
    if (!f) return;
    setBusy(true);
    const r = await read(f);
    setter({ file: f, text: r.text, bytes: r.bytes, name: f.name });
    if (!r.binary && looksGarbled(r.text)) {
      setError("compare.encoding", { name: f.name });
    }
    setBusy(false);
  };

  const loadSamplePair = async (s: Sample) => {
    setBusy(true);
    try {
      if (s.family !== "markdown" && s.family !== "code" && s.family !== "text") {
        const [fa, fb] = await loadSampleFiles(s);
        const [ra, rb] = await Promise.all([read(fa), read(fb)]);
        setOldSlot({ file: fa, text: ra.text, bytes: ra.bytes, name: fa.name, sample: true });
        setNewSlot({ file: fb, text: rb.text, bytes: rb.bytes, name: fb.name, sample: true });
      } else {
        const [a, b] = await loadSample(s);
        setOldSlot({ file: null, text: a, name: `${s.filename}`, sample: true });
        setNewSlot({ file: null, text: b, name: `${s.filename}`, sample: true });
      }
    } catch (e) {
      // a sample that cannot be fetched must say so, not silently do nothing
      setError(`${s.filename}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const clearAll = () => {
    setOldSlot(emptySlot());
    setNewSlot(emptySlot());
    setResult(null);
    setXlsx(null);
    setOpc(null);
    setRich(null);
    setMeta(null);
    setError(null);
    setUnsupported(null);
  };

  // A unified patch is a statement about *text*. The Office viewers (Word revisions, sheet
  // cells, slides, PDF pages) describe their changes in their own shape, and turning those into
  // `--- a/ +++ b/` would invent line numbers that do not exist in the file.
  // Text families are the ones that carry a line diff in `result`; the Office families fill
  // `xlsx` / `opc` / `pdf` instead and have no unified patch to give.
  const canExportPatch = Boolean(
    (result && result.hunks.length > 0) || (rich?.rust != null && rich.kind === "code"),
    ) && !xlsx && !opc && !pdf;
  const exportUnified = () => {
    if (!canExportPatch) return;
    const name = meta?.name ?? "diff";
    const lines: string[] = [`--- a/${name}`, `+++ b/${name}`];
    // Two sources: the kernel's semantic hunks (code, markdown, text) and the rich path the Rust
    // engine feeds. Either way the output is a plain unified patch that `patch` can apply.
    if (rich?.rust && rich.kind === "code") {
      // The rich view's headers are for reading (`@@ rust · hunk 1 @@`); a patch needs
      // `@@ -a,b +c,d @@`, which is computed from the hunks themselves here.
      for (const h of rustToHunks(rich.rust)) {
        const olds = h.lines.filter((l) => l.kind !== "insert").length;
        const news = h.lines.filter((l) => l.kind !== "delete").length;
        const first = h.lines[0];
        const oldStart = h.lines.find((l) => l.kind !== "insert")?.oldLine ?? first?.oldLine ?? 0;
        const newStart = h.lines.find((l) => l.kind !== "delete")?.newLine ?? first?.newLine ?? 0;
        lines.push(`@@ -${oldStart},${olds} +${newStart},${news} @@`);
        for (const l of h.lines) {
          lines.push((l.kind === "insert" ? "+" : l.kind === "delete" ? "-" : " ") + l.text);
        }
      }
    } else if (result) {
      for (const h of result.hunks) {
        lines.push(h.header);
        for (const l of h.lines) lines.push((l.kind === "insert" ? "+" : l.kind === "delete" ? "-" : " ") + l.text);
      }
    }
    if (lines.length <= 2) return;
    downloadText(lines.join("\n") + "\n", `${name.replace(/\.\w+$/, "")}.diff`);
  };

  // Viewers that render a page (PDF, Word, slides) need a fixed frame to lay it out in; text
  // and code diffs should grow with their content instead of sitting in a half-empty box.
  const needsPaneFrame =
    (mode === "unified" && rich?.kind !== "code" && rich?.kind !== "markdown") ||
    (mode === "ast" && !ast) ||
    (mode === "semantic" && !sem);

  return (
    <div className="grid gap-4">
      {showHeroCopy ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t("compare.title")}</h1>
            <p className="mt-1 text-[13.5px] text-slate-400">
              {t("compare.desc.a")}<strong className="text-slate-200">{t("compare.desc.strong")}</strong>{t("compare.desc.b")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="brand">
              <Lock className="h-3.5 w-3.5" /> {t("compare.zeroUpload")}
            </Badge>
            <Button variant="outline" size="sm" onClick={clearAll}>
              {t("compare.clear")}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <DropZone side="old" slot={oldSlot} onFiles={loadFiles} onClear={() => setOldSlot(emptySlot())} />
        <DropZone side="new" slot={newSlot} onFiles={loadFiles} onClear={() => setNewSlot(emptySlot())} />
      </div>

      {/* On a phone the six sample chips stack into ~300px of vertical space, pushing the
          diff — the thing the page is for — below the fold. Once a result exists they
          collapse behind one line; on wider screens they stay visible. */}
      {/* Always open: it collapsed as soon as a comparison existed, which left no way to
          switch to another sample without clearing first. */}
      <div className="flex flex-wrap items-center gap-2" data-testid="sample-bar">
        <span className="text-[12.5px] text-slate-500">{t("compare.samples")}</span>
        {SAMPLES.map((s) => (
          <Button key={s.id} variant="outline" size="sm" onClick={() => loadSamplePair(s)} title={t(s.desc)}>
            <ArrowLeftRight className="h-3.5 w-3.5" /> {t(s.label)}

          </Button>
        ))}
      </div>

      {unsupported ? (
        <UnsupportedPanel meta={unsupported} oldFile={oldSlot.file} newFile={newSlot.file} />
      ) : null}
      {error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/[0.07] px-4 py-3 text-[13px] leading-6 text-red-200">
          {/* formatted at render, so a message that arrives late still appears */}
          {error ? t(error.key, error.params as never) : null}
        </div>
      ) : null}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5">
          <GitCompareArrows className="h-4 w-4 text-brand" />
          <span className="text-[13px] font-medium text-slate-200">{t("compare.result")}</span>
          <span className="sr-only" data-testid="result-key">{resultKey}</span>
          {rich ? (
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <Badge tone="muted">{rich.summary}</Badge>
              {rich.rust ? <Badge tone="brand">rules-core.wasm</Badge> : null}
              {rich.rust ? (
                rich.rust.symbolsAdded.length || rich.rust.symbolsChanged.length ? (
                  <Badge tone="muted">
                    {rich.rust.symbolsAdded.length}+ / {rich.rust.symbolsChanged.length}~ sym
                  </Badge>
                ) : null
              ) : null}
              <Badge tone="muted">
                {rich.rust ? "Rust" : t(meta?.engine ?? "")} · {t("compare.min", { ms })}
              </Badge>
            </div>
          ) : null}
          {astNotice ? (
            <span
              className="rounded bg-warn/15 px-2 py-0.5 text-[11.5px] text-warn"
              data-testid="ast-notice"
              title={astNotice === "offline" ? t("compare.astOffline") : t("compare.astUnavailable")}
            >
              {astNotice === "offline" ? t("compare.astOfflineShort") : t("compare.astUnavailableShort")}
            </span>
          ) : null}
          {/* One switch, same place, for every family that has two views. It used to sit inside
              the code tab bar, so Word, slides and PDF — which have no tabs — never got one. */}
          {(mode === "semantic" && sem) || opc || pdf ? (
            <div className="flex items-center gap-2 text-[11.5px]">
              <button
                onClick={() => setSideBySide(!showingTwoPane)}
                title={t("sem.sideBySide.title")}
                className={cn(
                  "rounded border px-2 py-0.5 transition-colors",
                  showingTwoPane
                    ? "border-line bg-white/[0.08] text-slate-200"
                    : "border-transparent text-slate-500 hover:text-slate-300",
                )}
              >
                {t("sem.sideBySide")}
              </button>
            </div>
          ) : null}
          {xlsx ? (
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <Badge tone="muted">{xlsx.summary}</Badge>
              <Badge tone="muted">
                {xlsx.engine ? `rules-core.wasm · ${t("compare.min", { ms })}` : `${meta?.engine} · ${t("compare.min", { ms })}`}
              </Badge>
            </div>
          ) : null}
          {sem || ast ? (
            <div className="flex items-center gap-1 rounded-lg border border-line p-0.5 text-[11.5px]">
              {([
                ...(sem ? (["semantic"] as const) : []),
                ...(ast ? (["ast"] as const) : []),
                ...(["unified"] as const),
              ]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={cn(
                    "rounded px-2 py-0.5 transition-colors",
                    mode === m ? "bg-white/[0.08] text-slate-200" : "text-slate-500 hover:text-slate-300",
                  )}
                >
                  {t(m === "semantic" ? "sem.tab.semantic" : m === "ast" ? "sem.tab.ast" : "sem.tab.unified")}
                </button>
              ))}
              {/* The shortcuts are invisible otherwise: nobody discovers `n` / `p` by guessing. */}
              <span className="ml-1 hidden text-[11px] text-slate-600 sm:inline">
                {t("sem.keys", { next: "n", prev: "p" })}
              </span>
            </div>
          ) : null}
          {/* The symbol-graph badge used to read "symbols across 2 file(s) · 0 import edges",
              which nobody could act on: "edges" is an internal count of the import graph and is
              usually zero for a diff anyway. Removed rather than reworded. */}
          {pdf ? (
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <Badge tone="muted">{pdf.summary}</Badge>
              <Badge tone="brand">pdf.js</Badge>
              <Badge tone="muted">{t("compare.min", { ms })}</Badge>
            </div>
          ) : null}
          {result ? (
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <Badge tone="default">
                <span className="text-emerald-400">+{result.added}</span>
                <span className="text-slate-600">/</span>
                <span className="text-red-400">−{result.removed}</span>
              </Badge>
              <Badge tone="muted">{t("compare.hunks", { count: result.hunks.length })}</Badge>
              <Badge tone="muted">
                {meta?.engine} · {t("compare.min", { ms })}
              </Badge>
            </div>
          ) : fmIsDocx && oldDocxPair ? (
            <Badge tone="brand">{t("word.engineBadge")}</Badge>
          ) : pdf || xlsx || opc || rich ? null : (
            <span className="text-[12px] text-slate-500">{t("compare.waiting")}</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {busy ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : null}
            <Button
              variant="outline"
              size="sm"
              disabled={!canExportPatch}
              title={canExportPatch ? undefined : t("compare.export.whyNot")}
              onClick={exportUnified}
            >
              {t("compare.export")}
            </Button>
          </div>
        </div>
        {/* A diff of a few dozen rows should not sit inside a fixed 520px box with half of it
            empty. Text families grow with their content up to a comfortable ceiling and scroll
            past it; the viewers that need a fixed frame (PDF pages, Word pages, slides) keep
            their own. */}
        <DiffPane
          runId={runId}
          mode={mode}
          twoPane={showingTwoPane}
          needsPaneFrame={needsPaneFrame}
          file={newSlot.name || oldSlot.name}
          sem={sem}
          ast={ast}
          rust={rich?.rust ?? null}
          result={result}
          rich={rich}
          xlsx={xlsx}
          pdf={pdf}
          opc={opc}
          isDocx={fmIsDocx}
          oldBytes={oldSlot.bytes}
          newBytes={newSlot.bytes}
          beforeText={oldSlot.text}
          afterText={newSlot.text}
        />
      </Card>
    </div>
  );
}

/** after-side line → the move block that placed it there */
export function moveIndex(moves: SemMove[]): Map<number, SemMove> {
  const m = new Map<number, SemMove>();
  for (const blk of moves) {
    for (let line = blk.toStart; line <= blk.toEnd; line++) m.set(line, blk);
  }
  return m;
}

/** A text pair beyond this is refused: the tab would freeze before it finished. */
export const MAX_TEXT_BYTES = 40 * 1024 * 1024;
/** Office/PDF files are parsed by their own engine, which needs far more headroom. */
export const MAX_BINARY_BYTES = 200 * 1024 * 1024;

/** Why a file is too large to open, or null when it is fine. */
export function oversizeOf(size: number, name: string): "text" | "binary" | null {
  const fam = familyOf(name);
  const binary = fam === "docx" || fam === "xlsx" || fam === "pptx" || fam === "pdf";
  if (binary && size > MAX_BINARY_BYTES) return "binary";
  if (!binary && size > MAX_TEXT_BYTES) return "text";
  return null;
}

async function read(f: File): Promise<{ text: string; bytes: ArrayBuffer; binary: boolean }> {
  const bytes = await f.arrayBuffer();
  const fam = familyOf(f.name);
  if (fam === "docx" || fam === "xlsx" || fam === "pptx" || fam === "pdf" || isBinary(bytes)) {
    return { text: "", bytes, binary: true };
  }
  const text = decodeText(bytes, f.name);
  return { text, bytes, binary: false };
}

function DropZone({
  side,
  slot,
  onFiles,
  onClear,
}: {
  side: Side;
  slot: Slot;
  onFiles: (side: Side, files: FileList | File[]) => void;
  onClear: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const [over, setOver] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const fam = slot.name ? familyOf(slot.name) : null;
  const Icon = fam ? FICON[fam] : Upload;

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (e.dataTransfer?.files?.length) onFiles(side, e.dataTransfer.files);
      }}
      className={cn(
        "relative flex min-h-[132px] flex-col justify-between rounded-2xl border border-dashed p-4 transition-colors",
        over ? "border-brand bg-brand/[0.06]" : "border-line bg-panel/50",
        slot.name && "border-solid",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
            {side === "old" ? t("compare.old") : t("compare.new")}
          </div>
          <div className="mt-1.5 flex items-center gap-2 truncate">
            <Icon className="h-4 w-4 shrink-0 text-slate-400" />
            <span className={cn("truncate text-[13.5px]", slot.name ? "text-slate-200" : "text-slate-500")}>
              {slot.name || t("compare.dropHint")}
            </span>
          </div>
          {slot.file && !slot.sample ? (
            <div className="mt-1 text-[11.5px] text-slate-500">
              {formatBytes(slot.file.size)} · {fam ? t(formatMeta(fam).label) : "unknown"} · {t("compare.localRead")}
            </div>
          ) : slot.name ? (
            <div className="mt-1 text-[11.5px] text-slate-500">{t("compare.builtinSample", { family: fam ? t(formatMeta(fam).label) : "text" })}</div>
          ) : (
            <div className="mt-1 text-[11.5px] text-slate-600">{t("compare.supported")}</div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {slot.name ? (
            <button onClick={onClear} className="rounded-md p-1.5 text-slate-500 hover:bg-white/5 hover:text-slate-200" aria-label={t("compare.clearSlot")}>
              <X className="h-4 w-4" />
            </button>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
            {t("compare.choose")}
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) onFiles(side, e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </div>
      {slot.name && !slot.sample ? (
        <div className="mt-2 flex items-center gap-1.5 text-[11.5px] text-emerald-400/80">
          <CheckCircle2 className="h-3.5 w-3.5" /> {t("compare.parsedLocally")}
        </div>
      ) : slot.sample ? (
        <div className="mt-2 text-[11.5px] text-slate-600">{t("compare.sampleNoUpload")}</div>
      ) : (
        <div className="mt-2 text-[11.5px] text-slate-600">{t("compare.dragBoth")}</div>
      )}
    </div>
  );
}