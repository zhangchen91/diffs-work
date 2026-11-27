/**
 * The binary families, compared in-process with the Rust kernel.
 *
 * Excel/Word/PDF were previously handed back to the user ("open them in the viewer"), which
 * is useless to an agent: it asked a question and got a redirect. The kernel behind those
 * viewers is just WebAssembly, so it runs here too — the same `sheet_diff` / `opc_diff` the
 * browser calls, on the same bytes, with no upload.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

interface Exports {
  memory: WebAssembly.Memory;
  diffs_alloc(n: number): number;
  diffs_handle(ptr: number, len: number): number;
  diffs_box_len(ptr: number): number;
  diffs_free(ptr: number, len: number): void;
}

let kernel: Exports | null | undefined;

/** Locate the kernel: the plugin ships a copy, the monorepo has it under the website. */
function kernelPath(): string | null {
  const here = path.dirname(new URL(import.meta.url).pathname);
  const candidates = [
    path.resolve(here, "../engine/diffs-engine.wasm"),
    path.resolve(here, "../../../apps/dsh-plugin/engine/diffs-engine.wasm"),
    path.resolve(here, "../../../apps/website/public/engine/rules-core/diffs-engine.wasm"),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

function loadKernel(): Exports | null {
  if (kernel !== undefined) return kernel;
  const file = kernelPath();
  if (!file) {
    kernel = null;
    return null;
  }
  try {
    kernel = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(file)), {}).exports as unknown as Exports;
  } catch {
    kernel = null;
  }
  return kernel;
}

function call<T>(req: Record<string, unknown>): T | null {
  const ex = loadKernel();
  if (!ex) return null;
  const input = new TextEncoder().encode(JSON.stringify(req));
  const ptr = ex.diffs_alloc(input.length);
  new Uint8Array(ex.memory.buffer, ptr, input.length).set(input);
  const out = ex.diffs_handle(ptr, input.length);
  const len = ex.diffs_box_len(out);
  const text = new TextDecoder().decode(new Uint8Array(ex.memory.buffer, out + 4, len));
  ex.diffs_free(out, len + 4);
  ex.diffs_free(ptr, input.length);
  const parsed = JSON.parse(text) as T & { error?: string };
  return parsed.error ? null : parsed;
}

export interface SheetChange {
  ref: string;
  op: string;
  old?: string;
  new?: string;
}

export interface SheetSummary {
  kind: "sheet";
  sheets: Array<{ name: string; oldName: string | null; added: number; removed: number; modified: number; styleChanged: number; changes: SheetChange[] }>;
  totals: { added: number; removed: number; modified: number; styleChanged: number; sheets: number };
}

export interface OpcSummary {
  kind: "opc";
  added: number;
  removed: number;
  summary: string;
  revisions: Array<{ part: string; kind: string; old: string; new: string }>;
}

/** The kernel's own response shape for `sheet_diff`. */
interface RustSheet {
  engine?: string;
  totals?: { added: number; removed: number; modified: number; styleChanged: number; sheets: number };
  sheets?: Array<{
    name: string;
    oldName?: string;
    diff?: {
      added: number;
      removed: number;
      modified: number;
      styleChanged: number;
      changes?: Array<{ ref: string; op: string; old?: string; new?: string }>;
    };
  }>;
}

/** Compare two xlsx files. Returns null when the kernel is unavailable. */
export function sheetDiff(oldBytes: Uint8Array, newBytes: Uint8Array): SheetSummary | null {
  const r = call<RustSheet>({
    cmd: "sheet_diff",
    a: Buffer.from(oldBytes).toString("base64"),
    b: Buffer.from(newBytes).toString("base64"),
  });
  if (!r?.sheets) return null;
  return {
    kind: "sheet",
    totals: r.totals ?? { added: 0, removed: 0, modified: 0, styleChanged: 0, sheets: r.sheets.length },
    sheets: r.sheets.map((s) => ({
      name: s.name,
      oldName: s.oldName && s.oldName !== s.name ? s.oldName : null,
      added: s.diff?.added ?? 0,
      removed: s.diff?.removed ?? 0,
      modified: s.diff?.modified ?? 0,
      styleChanged: s.diff?.styleChanged ?? 0,
      changes: (s.diff?.changes ?? []).map((c) => ({ ref: c.ref, op: c.op, old: c.old, new: c.new })),
    })),
  };
}

interface RustOpc {
  summary?: string;
  added?: number;
  removed?: number;
  revisions?: Array<{ part: string; path?: string; kind: string; old?: string; new?: string }>;
}

/** Compare two OPC packages (docx/pptx) part by part. */
export function opcDiff(oldBytes: Uint8Array, newBytes: Uint8Array, kind: "docx" | "pptx"): OpcSummary | null {
  const r = call<RustOpc>({
    cmd: "opc_diff",
    kind,
    a: Buffer.from(oldBytes).toString("base64"),
    b: Buffer.from(newBytes).toString("base64"),
  });
  if (!r?.revisions) return null;
  return {
    kind: "opc",
    added: r.added ?? 0,
    removed: r.removed ?? 0,
    summary: r.summary ?? "",
    revisions: r.revisions.map((x) => ({ part: x.part, kind: x.kind, old: x.old ?? "", new: x.new ?? "" })),
  };
}
