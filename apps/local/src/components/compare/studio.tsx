import { DiffPane, laneFor, runComparison, rustSheetToWorkbook, type RustSheetDiff, type CodeFromRust, type OpcFromRust, type SemDiffResult } from "@diffs/diff-ui";
import { diffPdf, type PdfDiff } from "@diffs/core-pdf";
import * as React from "react";
import {
  ArrowLeftRight,
  CheckCircle2,
  FileCode2,
  FileText,
  FileType2,
  GitCompareArrows,
  Loader2,
  Lock,
  Presentation,
  Sheet,
  Upload,
  X,
  Image,
  Table2,
} from "lucide-react";
import { formatBytes } from "@/lib/router";
import { loadRustEngine, toBase64 } from "@diffs/engine-bundle";
import { compareXlsx, type WorkbookDiff } from "@diffs/core-xlsx";
import { cn } from "@/lib/utils";
import { familyOf, formatMeta, type Family } from "@/lib/formats";
import { SAMPLES, loadSample, loadSampleFiles, type Sample } from "@/lib/samples";
import { Badge, Button, Card } from "@/components/ui/primitives";
import { diffText, type TextDiffResult } from "@diffs/core-text";
import { diffCode, type CodeDiffResult } from "@diffs/core-code";
import { downloadText } from "@diffs/dom-utils/download";

const FICON: Record<Family, typeof FileText> = {
  docx: FileText,
  xlsx: Sheet,
  pptx: Presentation,
  pdf: FileType2,
  markdown: FileText,
  text: FileText,
  code: FileCode2,
  svg: Image,
  csv: Table2,
  "legacy-office": FileText,
};

type Side = "old" | "new";

interface Slot {
  file: File | null;
  text: string;
  name: string;
  bytes?: ArrayBuffer;
}

const emptySlot = (): Slot => ({ file: null, text: "", name: "" });

export function CompareStudio({ showHeroCopy = true }: { showHeroCopy?: boolean }): React.ReactElement {
  const [oldSlot, setOldSlot] = React.useState<Slot>(emptySlot);
  const [newSlot, setNewSlot] = React.useState<Slot>(emptySlot);

  // The browser extension stores a pair under chrome.storage.local["pair:<id>"] and opens
  // /#/compare?pair=<id>. A page cannot read that API, so the extension's content script
  // answers a message instead; without this the extension's "compare" opened an empty view.
  const pairLoaded = React.useRef<string | null>(null);
  React.useEffect(() => {
    const m = /[?&]pair=([^&]+)/.exec(window.location.hash);
    const id = m?.[1];
    if (!id || pairLoaded.current === id) return;
    pairLoaded.current = id;
    let done = false;
    const onReply = (event: MessageEvent) => {
      const data = event.data as { type?: string; id?: string; pair?: { oldText?: string; newText?: string; oldName?: string; newName?: string } | null } | null;
      if (!data || data.type !== "diffs-work:pair:response" || data.id !== id) return;
      window.removeEventListener("message", onReply);
      const pair = data.pair;
      if (!pair) return;
      setOldSlot({ file: null, text: pair.oldText ?? "", name: pair.oldName ?? "old.txt" });
      setNewSlot({ file: null, text: pair.newText ?? "", name: pair.newName ?? "new.txt" });
    };
    window.addEventListener("message", onReply);
    window.postMessage({ type: "diffs-work:pair:request", id }, "*");
    // This page is served by the local server itself, so `POST /api/pair` → `#/compare?pair=<id>`
    // can be read directly. Without this the link that endpoint hands out opened an empty view.
    void (async () => {
      try {
        const res = await fetch(`/api/pair/${id}`);
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
        setOldSlot({ file: null, text: new TextDecoder().decode(decode(data.oldBase64)), name: data.oldName ?? "old.txt", bytes: asBuffer(decode(data.oldBase64)) });
        setNewSlot({ file: null, text: new TextDecoder().decode(decode(data.newBase64)), name: data.newName ?? "new.txt", bytes: asBuffer(decode(data.newBase64)) });
      } catch {
        /* not served by the local server: the extension path above is the only source */
      }
    })();
  }, []);

  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [xlsx, setXlsx] = React.useState<{ diff: WorkbookDiff; summary: string; engine?: string } | null>(null);
  const [opc, setOpc] = React.useState<{ kind: "docx" | "pptx"; result: OpcFromRust } | null>(null);
  const [pdf, setPdf] = React.useState<PdfDiff | null>(null);
  const [rust, setRust] = React.useState<CodeFromRust | null>(null);
  // The website opens on the semantic view; the local viewer rendered the raw line list, so the
  // same pair looked different in the two apps.
  const [sem, setSem] = React.useState<SemDiffResult | null>(null);
  const [result, setResult] = React.useState<TextDiffResult | null>(null);
  const [meta, setMeta] = React.useState<{ family: Family; engine: string; name: string } | null>(null);
  const [ms, setMs] = React.useState(0);
  // Bumped per comparison, so the pane remounts and the viewers reset (same as the website).
  const [runId, setRunId] = React.useState(0);
  const [wide, setWide] = React.useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 900px)").matches);
  // The one/two-column switch. Undefined means "follow the viewport", which is the sensible
  // default; a click pins it. Without this the local viewer showed both versions of a .docx side
  // by side on any wide screen and offered no way to see just the new one — the website had the
  // switch and this app did not.
  const [sideBySide, setSideBySide] = React.useState<boolean | undefined>(undefined);
  const showingTwoPane = sideBySide ?? wide;

  const run = React.useCallback((a: Slot, b: Slot) => {
    if (!a.name && !b.name) return;
    const name = b.name || a.name;
    const fam = familyOf(name);
    const fm = formatMeta(fam);
    const lane = laneFor(fam, a, b);
    setRunId((n) => n + 1);
    setError(null);
    setMeta({ family: fam, engine: fm.engine, name });

    // PDF is the one lane that does not go through the kernel, and it is not in the shared runner
    // because it returns a rendered-page model rather than a diff result.
    if (lane === "pdf") {
      const t0 = performance.now();
      setPdf(null);
      void (async () => {
        try {
          const d = await diffPdf(a.bytes!, b.bytes!);
          setPdf(d);
          setMs(Math.round((performance.now() - t0) * 10) / 10);
        } catch (e) {
          setError(`${a.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      })();
      return;
    }

    if (!lane) {
      setError(`${name}: 无法比对（缺少内容）`);
      return;
    }

    const t0 = performance.now();
    setResult(null);
    setRust(null);
    setSem(null);
    setXlsx(null);
    setOpc(null);

    void (async () => {
      const engine = await loadRustEngine();
      // The sheet lane runs *before* `runComparison`, which is what the website does too: it asks
      // the kernel for the cells and never reaches the shared runner for this family. Calling
      // `sheet_diff` after the runner had already used the same wasm instance blanked the page
      // with no error, so the order is not incidental.
      if (lane === "sheet" && a.bytes && b.bytes) {
        let shown = false;
        if (engine) {
          try {
            const r = engine.call<RustSheetDiff>({
              cmd: "sheet_diff",
              a: toBase64(a.bytes),
              b: toBase64(b.bytes),
            });
            if (r?.sheets?.length) {
              setXlsx({ diff: rustSheetToWorkbook(r), summary: r.summary ?? "", engine: r.engine });
              shown = true;
            }
          } catch {
            /* fall through to the reader */
          }
        }
        if (!shown) {
          try {
            const { diff, summary } = compareXlsx(new Uint8Array(a.bytes), new Uint8Array(b.bytes));
            setXlsx({ diff, summary, engine: "core-xlsx (TS)" });
          } catch {
            /* the counts still stand */
          }
        }
        return;
      }
      await runComparison(
        { old: a, new: b, family: fam, name },
        engine,
        {
          lineDiff: (x, y) => diffText(x, y),
          onUpdate: (patch) => {
            if (patch.text) setResult(patch.text as ReturnType<typeof diffText>);
            if (patch.sem) setSem(patch.sem);
            if (patch.code) setRust(patch.code);
            if (patch.opc) setOpc(patch.opc);
            setMs(Math.round((performance.now() - t0) * 10) / 10);
          },
        },
      );
    })();
  }, []);

  React.useEffect(() => {
    if (oldSlot.name && newSlot.name) run(oldSlot, newSlot);
    // `wide` decides the default one/two-column layout; track it instead of sampling once.
    const mq = window.matchMedia("(min-width: 900px)");
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oldSlot.text, oldSlot.name, newSlot.text, newSlot.name]);

  const loadFiles = async (side: Side, files: FileList | File[]) => {
    const list = Array.from(files);
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
    setBusy(false);
  };

  const loadSamplePair = async (s: Sample) => {
    setBusy(true);
    try {
      // Binary families must be fetched as bytes. `loadSample` reads every sample with
      // `Response.text()`, so opening the Word, Excel, PowerPoint or PDF sample put the zip
      // archive on the page as text and the document view never mounted — the whole card
      // collapsed into a wall of PK\x03\x04. The website has branched on family for a while; this
      // app never did.
      if (s.family !== "markdown" && s.family !== "code" && s.family !== "text") {
        const [fa, fb] = await loadSampleFiles(s);
        const [ra, rb] = await Promise.all([read(fa), read(fb)]);
        setOldSlot({ file: fa, text: ra.text, bytes: ra.bytes, name: fa.name });
        setNewSlot({ file: fb, text: rb.text, bytes: rb.bytes, name: fb.name });
      } else {
        const [a, b] = await loadSample(s);
        setOldSlot({ file: null, text: a, name: `${s.filename}` });
        setNewSlot({ file: null, text: b, name: `${s.filename}` });
      }
    } catch (e) {
      setError(`${s.filename}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const clearAll = () => {
    setOldSlot(emptySlot());
    setNewSlot(emptySlot());
    setResult(null);
    setMeta(null);
    setError(null);
  };

  const exportUnified = () => {
    if (!result) return;
    const lines: string[] = [`--- a/${meta?.name ?? "old"}`, `+++ b/${meta?.name ?? "new"}`];
    for (const h of result.hunks) {
      lines.push(h.header);
      for (const l of h.lines) lines.push((l.kind === "insert" ? "+" : l.kind === "delete" ? "-" : " ") + l.text);
    }
    downloadText(lines.join("\n") + "\n", `${(meta?.name ?? "diff").replace(/\.\w+$/, "")}.diff`);
  };

  return (
    <div className="grid gap-4">
      {showHeroCopy ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">浏览器内对比</h1>
            <p className="mt-1 text-[13.5px] text-slate-400">
              拖两个文件进来就行。文件内容<strong className="text-slate-200">全程不离开这个标签页</strong>，没有任何上传请求。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="brand">
              <Lock className="h-3.5 w-3.5" /> 0 上传
            </Badge>
            <Button variant="outline" size="sm" onClick={clearAll}>
              清空
            </Button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <DropZone side="old" slot={oldSlot} onFiles={loadFiles} onClear={() => setOldSlot(emptySlot())} />
        <DropZone side="new" slot={newSlot} onFiles={loadFiles} onClear={() => setNewSlot(emptySlot())} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] text-slate-500">没有文件？试试样例：</span>
        {SAMPLES.map((s) => (
          <Button key={s.id} variant="outline" size="sm" onClick={() => loadSamplePair(s)}>
            <ArrowLeftRight className="h-3.5 w-3.5" /> {s.label}
          </Button>
        ))}
      </div>

      {error ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.07] px-4 py-3 text-[13px] leading-6 text-amber-200">
          {error}
        </div>
      ) : null}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5">
          <GitCompareArrows className="h-4 w-4 text-brand" />
          <span className="text-[13px] font-medium text-slate-200">差异结果</span>
          {result ? (
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <Badge tone="default">
                <span className="text-emerald-400">+{result.added}</span>
                <span className="text-slate-600">/</span>
                <span className="text-red-400">−{result.removed}</span>
              </Badge>
              <Badge tone="muted">{result.hunks.length} 处差异</Badge>
              <Badge tone="muted">
                {meta?.engine} · {ms} ms
              </Badge>
              {meta?.family === "code" && (result as CodeDiffResult).symbols ? (
                <Badge tone="muted">
                  symbols {(result as CodeDiffResult).symbols.added.length}+ /{" "}
                  {(result as CodeDiffResult).symbols.removed.length}−
                </Badge>
              ) : null}
            </div>
          ) : (
            <span className="text-[12px] text-slate-500">等待输入</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {busy ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : null}
            {/* Any family with two panes, not only the ones that produce a `result`: a .docx
                comparison goes through `opc` and leaves `result` null, which is how Word ended up
                without a switch while code had one. */}
            {result || opc || xlsx || sem ? (
              <Button variant="outline" size="sm" onClick={() => setSideBySide(!showingTwoPane)}>
                {showingTwoPane ? "并排" : "单栏"}
              </Button>
            ) : null}
            <Button variant="outline" size="sm" disabled={!result} onClick={exportUnified}>
              导出 .diff
            </Button>
          </div>
        </div>
        <DiffPane
          runId={runId}
          mode="semantic"
          twoPane={showingTwoPane}
          needsPaneFrame={!!(opc || xlsx)}
          file={meta?.name ?? ""}
          sem={sem}
          rust={rust}
          result={result}
          xlsx={xlsx}
          opc={opc}
          pdf={pdf}
          oldBytes={oldSlot.bytes}
          newBytes={newSlot.bytes}
          isDocx={meta?.family === "docx"}
        />
      </Card>
    </div>
  );
}

async function read(f: File): Promise<{ text: string; bytes: ArrayBuffer }> {
  const bytes = await f.arrayBuffer();
  return { text: f.name.match(/\.(xlsx|xlsm|docx|pptx|pdf)$/i) ? "" : new TextDecoder("utf-8").decode(bytes), bytes };
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
            {side === "old" ? "旧版 / Old" : "新版 / New"}
          </div>
          <div className="mt-1.5 flex items-center gap-2 truncate">
            <Icon className="h-4 w-4 shrink-0 text-slate-400" />
            <span className={cn("truncate text-[13.5px]", slot.name ? "text-slate-200" : "text-slate-500")}>
              {slot.name || "拖入文件，或点右侧选择"}
            </span>
          </div>
          {slot.file ? (
            <div className="mt-1 text-[11.5px] text-slate-500">
              {formatBytes(slot.file.size)} · {fam ? formatMeta(fam).label : "unknown"} · 本地读取
            </div>
          ) : slot.name ? (
            <div className="mt-1 text-[11.5px] text-slate-500">内置样例 · {fam ? formatMeta(fam).label : "text"}</div>
          ) : (
            <div className="mt-1 text-[11.5px] text-slate-600">支持 docx / xlsx / pptx / pdf / md / csv / 代码…</div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {slot.name ? (
            <button onClick={onClear} className="rounded-md p-1.5 text-slate-500 hover:bg-white/5 hover:text-slate-200" aria-label="清除">
              <X className="h-4 w-4" />
            </button>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
            选择
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
      {slot.name ? (
        <div className="mt-2 flex items-center gap-1.5 text-[11.5px] text-emerald-400/80">
          <CheckCircle2 className="h-3.5 w-3.5" /> 已在本地解析，未发送到任何服务器
        </div>
      ) : (
        <div className="mt-2 text-[11.5px] text-slate-600">也可以一次拖两个文件（左旧右新）</div>
      )}
    </div>
  );
}