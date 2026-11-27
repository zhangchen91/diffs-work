/**
 * Client for the Rust kernels (`apps/engine-core` → `diffs-engine.wasm`).
 *
 * The binary is loaded once, on the first call that needs it — never on the
 * first screen. Every kernel takes and returns JSON, the same shapes the TS
 * engines already produce, so the viewer does not branch on the engine.
 */
export type RustCommand = "version" | "ls_diff" | "ls_graph" | "sheet_diff" | "opc_diff";

export interface GraphFile {
  path: string;
  text: string;
}

export interface GraphSymbol {
  name: string;
  kind: string;
  file: string;
  line: number;
  bodyEnd: number;
  signature: string;
  type: string | null;
  referenceCount: number;
  referencedIn: number;
  references: Array<{ file: string; line: number; inSymbol: string }>;
}

export interface GraphEdge {
  from: string;
  to: string;
  specifier: string;
  names: string[];
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
  engine: string;
  summary: string;
  definitions: SymbolRow[];
}

export interface SymbolGraph {
  engine: string;
  summary: string;
  files: number;
  symbols: GraphSymbol[];
  edges: GraphEdge[];
  unresolvedImports: Array<{ from: string; specifier: string; names: string[] }>;
  definitions: Array<{ name: string; file: string; line: number; kind: string; type: string | null }>;
}

export interface RustEngine {
  call<T = unknown>(req: Record<string, unknown>): T;
  version: string;
}

const ENGINE_URL = "/engine/rules-core/diffs-engine.wasm";

interface Exports {
  memory: WebAssembly.Memory;
  diffs_alloc(len: number): number;
  diffs_handle(ptr: number, len: number): number;
  diffs_box_len(ptr: number): number;
  diffs_free(ptr: number, total: number): void;
}

let pending: Promise<RustEngine | null> | null = null;

/**
 * Load the kernel. Resolves to `null` when the runtime cannot instantiate it
 * (no wasm, blocked fetch) so callers fall back to the TypeScript engines
 * instead of showing an error nobody can act on.
 */
export function loadRustEngine(): Promise<RustEngine | null> {
  if (pending) return pending;
  pending = (async () => {
    try {
      if (typeof WebAssembly === "undefined") return null;
      // `force-cache` served a stale kernel even after the file changed: the page kept
      // reporting the old numbers while the file on disk already had the new ones. The
      // engine is versioned by content, and _headers already sets caching for production,
      // so revalidate instead of trusting whatever is in the cache.
      const res = await fetch(ENGINE_URL, { cache: "no-cache" });
      if (!res.ok) return null;
      // A dev server answers a missing file with the SPA fallback (HTML, status 200).
      // Instantiating that would report a bogus "engine ready", so the bytes have to be
      // a real wasm module before anything else is attempted.
      const type = res.headers.get("content-type") ?? "";
      if (type.includes("text/html")) return null;
      const bytes = await res.arrayBuffer();
      if (new Uint8Array(bytes)[0] !== 0x00 || new Uint8Array(bytes)[1] !== 0x61) return null;
      const module = await WebAssembly.instantiate(bytes, {});
      const ex = (module.instance.exports ?? module.instance) as unknown as Exports;
      if (typeof ex.diffs_handle !== "function") return null;
      const enc = new TextEncoder();
      const dec = new TextDecoder();

      const call = <T,>(req: Record<string, unknown>): T => {
        const input = enc.encode(JSON.stringify(req));
        const inPtr = ex.diffs_alloc(input.length || 1);
        new Uint8Array(ex.memory.buffer, inPtr, input.length).set(input);
        const out = ex.diffs_handle(inPtr, input.length);
        if (!out) throw new Error("rules-core: kernel returned no result");
        const len = ex.diffs_box_len(out);
        const text = dec.decode(new Uint8Array(ex.memory.buffer, out + 4, len));
        ex.diffs_free(out, len + 4);
        ex.diffs_free(inPtr, input.length || 1);
        return JSON.parse(text) as T;
      };

      const version = (call<{ version?: string }>({ cmd: "version" }) ?? {}).version ?? "unknown";
      return { call, version };
    } catch {
      return null;
    }
  })();
  return pending;
}

export function toBase64(bytes: ArrayBuffer): string {
  const u8 = new Uint8Array(bytes);
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    s += String.fromCharCode(...u8.subarray(i, i + chunk));
  }
  return btoa(s);
}