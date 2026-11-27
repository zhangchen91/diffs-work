/**
 * Per-family engine registry.
 *
 * Hard rule (see docs/architecture.md):
 *   - Exactly ONE engine chunk is fetched per file family, and only on demand.
 *   - Nothing heavy is loaded until the user actually opens that family.
 *   - The engine sources (wasm) are closed-source binaries; this TS SDK only wires them.
 */

export type EngineId =
  | "text-core"   // line/word diff               (wasm, ~40 KB)
  | "code-core"   // AST/symbol/LSP-scope diff    (wasm, ~120 KB)
  | "docxodus"    // OOXML rev view               (wasm, ~30 MB split)
  | "pdfjs"       // PDF render + overlay         (wasm-safe worker, ~1.8 MB)
  | "exceljs"     // grid cell diff               (js, ~0.9 MB)
  | "office-x2t" // pptx/legacy doc conversion   (wasm, ~9 MB)
  | "rules-core"; // Rust kernels: code LSP, xlsx styles, opc text (wasm, ~250 KB)

export interface EngineChunk {
  id: EngineId;
  /** public path prefix (root-relative) — swapped for a CDN origin in prod */
  base: string;
  /** human readable size hint shown in the UI */
  size: string;
  /** families that trigger this engine */
  families: string[];
  /** preconnect/dns-prefetch target before first use (perf, not a download) */
  preconnect?: string[];
}

export const ENGINE_REGISTRY: Record<EngineId, EngineChunk> = {
  "text-core": { id: "text-core", base: "/engine/text-core/", size: "engine.size.text", families: ["text", "markdown", "code"] },
  "code-core": { id: "code-core", base: "/engine/code-core/", size: "engine.size.code", families: ["code"] },
  docxodus: { id: "docxodus", base: "/engine/docxodus/", size: "engine.size.docxodus", families: ["docx"] },
  pdfjs: { id: "pdfjs", base: "/engine/pdfjs/", size: "engine.size.pdf", families: ["pdf"] },
  exceljs: { id: "exceljs", base: "/engine/exceljs/", size: "engine.size.xlsx", families: ["xlsx"] },
  "office-x2t": { id: "office-x2t", base: "/engine/office-x2t/", size: "engine.size.pptx", families: ["pptx"] },
  "rules-core": {
    id: "rules-core",
    base: "/engine/rules-core/",
    size: "engine.size.rules",
    families: ["code", "xlsx", "docx", "pptx"],
  },
};

const loaded = new Set<EngineId>();

export function isLoaded(id: EngineId): boolean {
  return loaded.has(id);
}

export function markLoaded(id: EngineId): void {
  loaded.add(id);
}

export function engineForFamily(family: string): EngineId[] {
  const out: EngineId[] = [];
  for (const e of Object.values(ENGINE_REGISTRY)) {
    if (e.families.includes(family)) out.push(e.id);
  }
  return out;
}

/** Preconnect only — never download. Call when the user hovers a family. */
export function preconnect(id: EngineId): void {
  if (typeof document === "undefined") return;
  const chunk = ENGINE_REGISTRY[id];
  const targets = chunk.preconnect ?? [chunk.base];
  for (const href of targets) {
    if (document.querySelector(`link[rel="preconnect"][href="${href}"]`)) continue;
    const link = document.createElement("link");
    link.rel = "preconnect";
    link.href = href;
    link.crossOrigin = "anonymous";
    document.head.appendChild(link);
  }
}