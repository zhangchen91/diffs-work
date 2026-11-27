/**
 * Host-side access to the Rust kernels (`apps/engine-core` → rules-core.wasm).
 *
 * The browser loads the same binary; the DSH plugin needs it on the host so the
 * `diff_compare` tool can return semantic (改/移) and AST (column-level) results
 * instead of only a line diff. Loaded once, lazily, and every failure degrades to
 * "no semantic section" rather than failing the comparison.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface KernelExports {
  memory: WebAssembly.Memory;
  diffs_alloc(len: number): number;
  diffs_handle(ptr: number, len: number): number;
  diffs_box_len(ptr: number): number;
  diffs_free(ptr: number, total: number): void;
}

let cached: KernelExports | null | undefined;

/** Locate the published wasm: the package ships it under `engine/`, dev builds read the repo copy. */
function wasmCandidates(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return [
    path.resolve(here, "../engine/diffs-engine.wasm"),
    path.resolve(here, "../../../apps/website/public/engine/rules-core/diffs-engine.wasm"),
    path.resolve(here, "../../../apps/local/public/engine/rules-core/diffs-engine.wasm"),
  ];
}

function kernel(): KernelExports | null {
  if (cached !== undefined) return cached;
  try {
    for (const file of wasmCandidates()) {
      try {
        const bytes = readFileSync(file);
        const mod = new WebAssembly.Module(bytes);
        const inst = new WebAssembly.Instance(mod, {});
        cached = inst.exports as unknown as KernelExports;
        return cached;
      } catch {
        /* try the next location */
      }
    }
  } catch {
    /* no kernel: the line diff still stands */
  }
  cached = null;
  return cached;
}

function call<T>(ex: KernelExports, req: Record<string, unknown>): T {
  const input = new TextEncoder().encode(JSON.stringify(req));
  const ptr = ex.diffs_alloc(input.length || 1);
  new Uint8Array(ex.memory.buffer, ptr, input.length).set(input);
  const out = ex.diffs_handle(ptr, input.length);
  if (!out) throw new Error("rules-core: no result");
  const len = ex.diffs_box_len(out);
  const text = new TextDecoder().decode(new Uint8Array(ex.memory.buffer, out + 4, len));
  ex.diffs_free(out, len + 4);
  ex.diffs_free(ptr, input.length || 1);
  return JSON.parse(text) as T;
}

export interface SemanticSection {
  summary: string;
  added: number;
  removed: number;
  updates: number;
  moves: number;
  inserts: number;
  deletes: number;
  hunks: Array<{
    operation: string;
    lines: Array<{ kind: string; oldNo: number | null; newNo: number | null; text: string; segments: unknown }>;
  }>;
  moveBlocks: Array<{ fromStart: number; fromEnd: number; toStart: number; toEnd: number; text: string }>;
}

export interface AstSection {
  summary: string;
  language: string;
  updates: number;
  moves: number;
  inserts: number;
  deletes: number;
  before: { hunks: unknown[] };
  after: { hunks: unknown[] };
}

/** Semantic (update / move aware) diff, or null when the kernel is unavailable. */
export function semanticDiff(a: string, b: string, filename: string, context = 3): SemanticSection | null {
  const ex = kernel();
  if (!ex) return null;
  try {
    const r = call<SemanticSection & { error?: string }>(ex, { cmd: "sem_diff", a, b, filename, context });
    return r?.error ? null : r;
  } catch {
    return null;
  }
}

/** AST (line + column range) diff, or null when the kernel is unavailable. */
export function astDiff(a: string, b: string, filename: string): AstSection | null {
  const ex = kernel();
  if (!ex) return null;
  try {
    const r = call<AstSection & { error?: string }>(ex, { cmd: "ast_diff", a, b, filename });
    return r?.error ? null : r;
  } catch {
    return null;
  }
}

export interface TypeInfo {
  kind: "annotation" | "literal" | "constructor" | "declared";
  type: string;
}

export interface SymbolRow {
  name: string;
  file: string;
  line: number;
  column: number;
  kind: string;
  type: TypeInfo | null;
  params: string | null;
  returns: string | null;
  signature: string;
}

export interface TypeSection {
  summary: string;
  definitions: SymbolRow[];
}

/** Type hints + definition sites for a set of files (no compiler front end, no guesses). */
export function symbolTypes(files: Array<{ path: string; text: string }>): TypeSection | null {
  const ex = kernel();
  if (!ex) return null;
  try {
    const r = call<TypeSection & { error?: string }>(ex, { cmd: "symbols", files });
    return r?.error ? null : r;
  } catch {
    return null;
  }
}

/** Hover / go-to-definition at one position. */
export function gotoAt(
  files: Array<{ path: string; text: string }>,
  file: string,
  line: number,
  column: number,
): unknown | null {
  const ex = kernel();
  if (!ex) return null;
  try {
    return call(ex, { cmd: "goto", files, file, line, column });
  } catch {
    return null;
  }
}

/** Cross-file symbol graph for a small set of files (used by `/diff-graph` later). */
export function symbolGraph(files: Array<{ path: string; text: string }>): unknown | null {
  const ex = kernel();
  if (!ex) return null;
  try {
    return call(ex, { cmd: "ls_graph", files });
  } catch {
    return null;
  }
}

export function kernelAvailable(): boolean {
  return !!kernel();
}
