/**
 * Render a comparison as OpenUI Lang, so every surface draws the same thing.
 *
 * The same diff is shown by the website, the local viewer, the DSH card, and — eventually — a
 * Feishu card or anything else with an adapter. Each of those wrote its own renderer, and they
 * drifted: the local viewer lost syntax highlighting, the plugin showed "两版内容一致" for a pair
 * that plainly differed. A platform-neutral description removes the chance to drift: the content
 * is the contract, and each platform translates the same tree.
 *
 * OpenUI Lang v0.1 has no diff component, so a comparison is composed from Card / Text / Table /
 * Badge — which every adapter already knows how to draw.
 *
 *   root = Card({ title: "a.ts → b.ts", subtitle: "+3 / -1", tone: "info" }, [...])
 */
import type { CompareResult } from "./index.ts";

/** Quote and escape a string for OpenUI Lang. */
function q(s: string): string {
  return JSON.stringify(s);
}

/** Keep a cell readable: collapse newlines, clip, and mark the clip. */
function cell(s: string, max = 120): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}

export interface OpenUIOptions {
  /** how many rows to describe before summarising the rest */
  maxRows?: number;
}

/**
 * One comparison as OpenUI Lang source.
 *
 * The first child is always a sentence a person can act on, because that is what a chat surface
 * shows when it can only show one thing.
 */
export function toOpenUI(r: CompareResult, opts: OpenUIOptions = {}): string {
  const maxRows = opts.maxRows ?? 40;
  const lines: string[] = [];

  const title = `${r.oldLabel.split("/").pop() ?? r.oldLabel} → ${r.newLabel.split("/").pop() ?? r.newLabel}`;
  const tone = r.added + r.removed === 0 && r.hunks.length === 0 ? "success" : "info";
  lines.push(`summary = Text(${q(r.summary)})`);

  // Say what the change *is* before describing its rows, when we know. A rename or an extraction
  // is one decision, and listing its lines first buries that under three or four "修改" rows.
  const headline = r.extracted
    ? `抽取函数：从 ${r.extracted.caller} 中拆出 ${r.extracted.helper}`
    : r.rename
      ? `重命名：${r.rename.from} → ${r.rename.to}`
      : null;
  // `summary` already says "抽取函数：…" when there is one, so a second note with the same
  // sentence would only duplicate it.
  const head: string[] = ["summary"];
  if (headline && !r.summary.includes(r.rename?.from ?? r.extracted?.helper ?? "@@")) {
    lines.push(`what = Note({ tone: "info" }, ${q(headline)})`);
    head.push("what");
  }

  // Rows: one per changed line, in file order. `ctx` rows are dropped — the reader wants the
  // changes, and context is what the viewer is for.
  const rows: Array<[string, string, string]> = [];
  for (const h of r.hunks) {
    for (const l of h.lines) {
      if (l.kind === "equal") continue;
      const where = l.oldLine != null && l.newLine != null ? `${l.oldLine}/${l.newLine}` : l.oldLine != null ? String(l.oldLine) : String(l.newLine ?? "");
      // `hunks` here is the line-level section; per-row kinds are all it carries. The
      // reformat/rename names live on `semantic.hunks`, which the payload exposes separately.
      const kind = l.kind === "insert" ? "新增" : l.kind === "delete" ? "删除" : l.kind === "move" ? "移动" : "修改";
      rows.push([where, kind, cell(l.text)]);
    }
  }

  let body: string;
  if (!rows.length) {
    body = `empty = Note({ tone: "success" }, ${q("两版内容一致")})`;
    lines.push(body);
    lines.push(`root = Card({ title: ${q(title)}, subtitle: ${q(r.summary)}, tone: ${q(tone)} }, [${[...head, "empty"].join(", ")}])`);
    return lines.join("\n") + "\n";
  }

  const shown = rows.slice(0, maxRows);
  lines.push(
    `rows = Table({ columns: ["行号", "类型", "内容"] }, [\n` +
      shown.map((r) => `  [${q(r[0])}, ${q(r[1])}, ${q(r[2])}]`).join(",\n") +
      `\n])`,
  );
  const tail: string[] = [...head, "rows"];
  if (rows.length > maxRows) {
    lines.push(`more = Text(${q(`… 还有 ${rows.length - maxRows} 处，完整结果在查看器里`)});`.replace(";", ""));
    tail.push("more");
  }
  if (r.note && r.note !== r.summary) {
    lines.push(`note = Note({ tone: "info" }, ${q(cell(r.note, 200))})`);
    tail.push("note");
  }
  lines.push(`root = Card({ title: ${q(title)}, subtitle: ${q(r.summary)}, tone: ${q(tone)} }, [${tail.join(", ")}])`);
  return lines.join("\n") + "\n";
}
