import * as React from "react";
import { FileText, Presentation } from "lucide-react";
import type { RichHunk, RichLine } from "./hunk-view";
import type { CodeFromRust, OpcFromRust } from "./rust-types";
import { useI18n } from "@diffs/i18n";
import { Badge } from "../lib/primitives";

/**
 * The Rust code kernel returns a flat line list (equal / ins / del / mod / style /
 * comment). The viewer wants hunks, so this slices runs of changes with a few
 * lines of context — same shape the TypeScript engine produces.
 */
export function rustToHunks(r: CodeFromRust, context = 3): RichHunk[] {
  // The kernel reports a relocated block as its own `move` run and emits it first, so every move
  // appeared at the top of the view regardless of where it sits in the file. Read the change in
  // line order, which is how a diff is read — the move then lands where the code actually is.
  // Key on whichever side has a number, and prefer the old side only as a tiebreak. Sorting on
  // `oldLine ?? MAX` pushed every inserted line (which has no old side) to the end, so a block of
  // additions appeared after the file finished and the line numbers restarted at 1.
  const key = (l: { oldLine: number | null; newLine: number | null }) => l.oldLine ?? l.newLine ?? Number.MAX_SAFE_INTEGER;
  const ordered = [...r.lines].sort((a, b) => {
    const d = key(a) - key(b);
    if (d !== 0) return d;
    return (a.oldLine ?? 0) - (b.oldLine ?? 0);
  });
  const lines: RichLine[] = ordered.map((l) => ({
    kind:
      l.op === "ins" ? "insert" : l.op === "del" ? "delete" : l.op === "mod" ? "move" : l.op === "style" ? "style" : "equal",
    oldLine: l.oldLine,
    newLine: l.newLine,
    text: l.text,
  }));
  const changed = lines.map((l, i) => (l.kind === "equal" ? -1 : i)).filter((i) => i >= 0);
  if (!changed.length) return [];
  const groups: Array<[number, number]> = [];
  let start = Math.max(0, changed[0] - context);
  let end = Math.min(lines.length - 1, changed[0] + context);
  for (const idx of changed.slice(1)) {
    if (idx - context <= end + 1) end = Math.min(lines.length - 1, idx + context);
    else {
      groups.push([start, end]);
      start = Math.max(0, idx - context);
      end = Math.min(lines.length - 1, idx + context);
    }
  }
  groups.push([start, end]);
  return groups.map(([s, e], g) => {
    const first = lines.slice(s, e + 1).find((l) => l.oldLine != null && l.newLine != null);
    return {
      header: `@@ ${r.language} · hunk ${g + 1} @@`,
      lines: lines.slice(s, e + 1).map((l) => ({ ...l, text: l.text })),
      ...(first ? {} : {}),
    };
  });
}

/**
 * Word / PowerPoint structured text diff: which paragraph or slide changed,
 * listed beside the rendered page. This is the `PortableDiff`-shaped output the
 * Rust kernel produces; the renderer stays the source of truth for layout.
 */
/** `ppt/slides/slide3.xml` → `第 3 页`; anything else keeps its part path. */
function partLabel(part: string, kind: "docx" | "pptx"): string {
  if (kind === "pptx") {
    const m = /^ppt\/slides\/slide(\d+)\.xml$/.exec(part);
    if (m) return `第 ${m[1]} 页`;
    if (part.startsWith("ppt/notesSlides/")) {
      const n = /note(\d+)\.xml$/.exec(part);
      return n ? `第 ${n[1]} 页备注` : part;
    }
  }
  return part.replace(/^word\//, "").replace(/\.xml$/, "");
}

export function OpcRevisionList({ result }: { result: OpcFromRust }): React.ReactElement {
  const { t } = useI18n();
  const Icon = result.kind === "pptx" ? Presentation : FileText;
  if (!result.revisions.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-400">
        <div className="text-[15px] text-slate-300">{t("compare.same")}</div>
        <div className="text-[12px] text-slate-600">{result.summary}</div>
      </div>
    );
  }
  return (
    <div className="scroll-thin h-full overflow-auto">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line bg-panel/95 px-3 py-2 text-[12px] backdrop-blur">
        <Icon className="h-4 w-4 text-brand" />
        <Badge tone="brand">rules-core.wasm</Badge>
        <span className="text-slate-400">{result.summary}</span>
      </div>
      <table className="w-full table-fixed border-collapse text-[12.5px]">
        <tbody>
          {result.revisions.map((rev, i) => (
            <tr
              key={i}
              className={
                rev.kind === "insert"
                  ? "bg-emerald-500/[0.08]"
                  : rev.kind === "delete"
                    ? "bg-red-500/[0.08]"
                    : "bg-amber-500/[0.08]"
              }
            >
              <td className="w-44 border-b border-line/40 px-3 py-1.5 align-top text-[11px] text-slate-500">
                <span className="flex items-center gap-1.5">
                  {/* 增 / 删 / 改 is what a reader looks for; the raw part name is the tooltip */}
                  <span
                    className={
                      rev.kind === "insert"
                        ? "rounded bg-emerald-500/15 px-1 text-emerald-300"
                        : rev.kind === "delete"
                          ? "rounded bg-red-500/15 px-1 text-red-300"
                          : "rounded bg-amber-500/15 px-1 text-amber-300"
                    }
                  >
                    {rev.kind === "insert" ? t("xlsx.op.add") : rev.kind === "delete" ? t("xlsx.op.del") : t("xlsx.op.mod")}
                  </span>
                  <span className="truncate font-mono" title={rev.part}>
                    {partLabel(rev.part, result.kind)}
                  </span>
                </span>
              </td>
              <td className="border-b border-line/40 px-3 py-1.5 align-top">
                {rev.kind === "insert" ? (
                  <span className="text-emerald-200/90">{rev.new}</span>
                ) : rev.kind === "delete" ? (
                  <span className="text-red-300/80 line-through decoration-red-500/40">{rev.old}</span>
                ) : (
                  <span>
                    <span className="text-red-300/70 line-through decoration-red-500/40">{rev.old}</span>
                    <span className="mx-1 text-slate-600">→</span>
                    <span className="text-emerald-200/90">{rev.new}</span>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}