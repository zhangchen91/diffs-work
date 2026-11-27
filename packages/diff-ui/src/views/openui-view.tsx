/**
 * Render an OpenUI Lang v0.1 card inside the diff UI.
 *
 * A comparison is described once (`toOpenUI`) and drawn by whatever adapter the surface has. This
 * is the DSH one. It covers the subset a comparison produces — Card, Text, Table, Note, Badge,
 * Divider, Heading — rather than the whole vocabulary: a renderer that claims every component and
 * draws some of them badly is worse than one that is honest about its subset and falls back to
 * text for the rest.
 */
import * as React from "react";
import { cn } from "../lib/cn";
import { parseOpenUI, type OpenUINode } from "./openui-parse";

export { parseOpenUI, type OpenUINode };

const TONE: Record<string, string> = {
  info: "border-sky-500/40 bg-sky-500/[0.08] text-sky-200",
  warn: "border-amber-500/40 bg-amber-500/[0.08] text-amber-200",
  error: "border-red-500/40 bg-red-500/[0.08] text-red-200",
  success: "border-emerald-500/40 bg-emerald-500/[0.08] text-emerald-200",
};

function Node({ node }: { node: OpenUINode }): React.ReactElement | null {
  switch (node.type) {
    case "Card":
      return (
        <div className="rounded-lg border border-line bg-panel-2/60 p-3">
          {node.props.title ? <div className="mb-1 text-[13px] font-medium text-slate-100">{String(node.props.title)}</div> : null}
          {node.props.subtitle ? <div className="mb-2 text-[11.5px] text-slate-400">{String(node.props.subtitle)}</div> : null}
          {node.children.map((c, i) => (
            <Node key={i} node={c} />
          ))}
        </div>
      );
    case "Text":
      return <p className="mb-1 whitespace-pre-wrap text-[12.5px] leading-6 text-slate-300">{String(node.value ?? "")}</p>;
    case "Heading":
      return <div className="mb-1 mt-2 text-[13px] font-medium text-slate-100">{String(node.value ?? "")}</div>;
    case "Note":
      return (
        <div className={cn("mb-1 rounded border px-2 py-1 text-[12px]", TONE[String(node.props.tone ?? "info")] ?? TONE.info)}>
          {String(node.value ?? "")}
        </div>
      );
    case "Badge":
      return <span className="mr-1 rounded bg-white/10 px-1.5 text-[11px] text-slate-300">{String(node.value ?? "")}</span>;
    case "Divider":
      return <hr className="my-2 border-line" />;
    case "Table": {
      const cols = Array.isArray(node.props.columns) ? (node.props.columns as string[]) : [];
      const rows = Array.isArray(node.items) ? (node.items as unknown[][]) : [];
      return (
        <table className="w-full border-collapse text-[12px]">
          {cols.length ? (
            <thead>
              <tr>
                {cols.map((c, i) => (
                  <th key={i} className="border-b border-line px-2 py-1 text-left font-normal text-slate-500">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {(Array.isArray(r) ? r : [r]).map((cell, j) => (
                  <td
                    key={j}
                    className={cn(
                      "border-b border-line/50 px-2 py-1 align-top",
                      String(cell) === "新增" ? "text-emerald-400" : String(cell) === "删除" ? "text-red-400" : "text-slate-300",
                    )}
                  >
                    {String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    default:
      return <div className="text-[12px] text-slate-500">[{node.type}]</div>;
  }
}

/** An OpenUI card. Falls back to the source text when the source does not parse. */
export function OpenUICard({ source }: { source: string }): React.ReactElement {
  try {
    return <Node node={parseOpenUI(source)} />;
  } catch {
    return <pre className="whitespace-pre-wrap text-[11.5px] text-slate-400">{source}</pre>;
  }
}
