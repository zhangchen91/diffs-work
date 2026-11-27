/**
 * Run a comparison: which engines to call, in what order, and what each result is.
 *
 * `laneFor` decides *which* lane a pair goes to; this executes it. Both apps used to write this
 * chain out themselves — the website's copy had six code-lane kernels (semantic, AST, types, two
 * symbol graphs, line diff) and the local viewer's had two, so the same pair looked different
 * depending on which app opened it. That is the reported bug, and re-sharing it is the fix.
 *
 * The shape is promise-based and callback-free where it can be: a lane returns the results it has.
 * Code is the exception — the line diff is cheap and the kernel results arrive later, and a surface
 * that wants to paint immediately calls `onUpdate` as each result lands.
 */

import type { CodeFromRust, OpcFromRust } from "../views/rust-types";
import type { AstDiffResult } from "../views/ast-view";
import type { SemDiffResult } from "../views/semantic-view";
import { laneFor, type CompareLane, type CompareTarget } from "./lanes";

/** The kernel surface this module uses; `loadRustEngine()` in the app provides one. */
export interface Kernel {
  call<T>(req: Record<string, unknown>): T | null;
}

export interface ComparisonSlots {
  old: CompareTarget;
  new: CompareTarget;
  family: string;
  name: string;
}

export interface ComparisonResult {
  lane: CompareLane | null;
  /** the line-level diff, when the lane has one; painted immediately */
  text?: unknown;
  code?: CodeFromRust | null;
  sem?: SemDiffResult | null;
  ast?: AstDiffResult | null;
  /** declaration kinds and their definition sites, for the symbol panel */
  types?: unknown;
  /** cross-file references among the symbols that changed */
  graph?: unknown;
  opc?: { kind: "docx" | "pptx"; result: OpcFromRust } | null;
  /** true when the kernel could not be loaded, so the surface can say so instead of showing less */
  kernelMissing?: boolean;
}

const GRAPH_LIMIT = 200_000;

/**
 * Execute the lane. `onUpdate` is called once per result as the kernel produces it, so a view can
 * paint the cheap result first; `signal` cancels the remaining calls when the pair changes.
 */
export async function runComparison(
  slots: ComparisonSlots,
  engine: Kernel | null,
  opts: {
    onUpdate?: (patch: Partial<ComparisonResult>) => void;
    signal?: AbortSignal;
    /** the cheap line diff, injected so this module does not depend on core-text */
    lineDiff?: (a: string, b: string, name: string) => unknown;
  } = {},
): Promise<ComparisonResult> {
  const lane = laneFor(slots.family, slots.old, slots.new);
  const out: ComparisonResult = { lane };
  const emit = (patch: Partial<ComparisonResult>) => {
    Object.assign(out, patch);
    opts.onUpdate?.(patch);
  };
  const live = () => !opts.signal?.aborted;
  if (!lane) return out;

  if (lane === "text") {
    if (opts.lineDiff && slots.old.text != null && slots.new.text != null) {
      emit({ text: opts.lineDiff(slots.old.text, slots.new.text, slots.name) });
    }
    return out;
  }

  if (!engine) {
    // The kernel is fetched on demand and cannot arrive offline. Say so rather than silently
    // showing a weaker view.
    emit({ kernelMissing: true });
    return out;
  }

  if (lane === "opc") {
    try {
      const r = engine.call<OpcFromRust>({
        cmd: "opc_diff",
        a: b64(slots.old.bytes!),
        b: b64(slots.new.bytes!),
        kind: slots.name.toLowerCase().endsWith(".pptx") ? "pptx" : "docx",
      });
      if (live() && r?.revisions) {
        emit({ opc: { kind: slots.name.toLowerCase().endsWith(".pptx") ? "pptx" : "docx", result: r } });
      }
    } catch {
      /* nothing else to show for this pair */
    }
    return out;
  }

  if (lane === "code") {
    const a = slots.old.text ?? "";
    const b = slots.new.text ?? "";
    if (opts.lineDiff) emit({ text: opts.lineDiff(a, b, slots.name) });

    const safe = <T,>(fn: () => T | null): T | null => {
      try {
        return live() ? fn() : null;
      } catch {
        return null;
      }
    };

    // Types and the graph feed the symbol panel. The graph is quadratic in references, so its input
    // is bounded; a surface that never opens the panel pays only the call, not the cost of a huge
    // file stalling the card.
    const types = safe(() =>
      engine.call({
        cmd: "symbols",
        files: [
          { path: slots.name, text: b },
          { path: `~${slots.name}`, text: a },
        ],
      }),
    );
    if (types && (types as { definitions?: unknown }).definitions) emit({ types });

    const graph = safe(() =>
      engine.call({
        cmd: "ls_graph",
        files: [
          { path: slots.name, text: b.slice(0, GRAPH_LIMIT) },
          { path: `~${slots.name}`, text: a.slice(0, GRAPH_LIMIT) },
        ],
      }),
    );
    if (graph && (graph as { symbols?: unknown }).symbols) emit({ graph });

    const sem = safe(() => engine.call<SemDiffResult>({ cmd: "sem_diff", a, b, filename: slots.name }));
    if (sem?.hunks) emit({ sem });

    const ast = safe(() => engine.call<AstDiffResult>({ cmd: "ast_diff", a, b, filename: slots.name }));
    if (ast && (ast.after?.hunks?.length ?? 0) + (ast.before?.hunks?.length ?? 0) > 0) emit({ ast });

    const line = safe(() => engine.call<CodeFromRust>({ cmd: "ls_diff", a, b, filename: slots.name }));
    if (line?.engine) emit({ code: line });
    return out;
  }

  return out;
}

function b64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < view.length; i += 0x8000) {
    binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
