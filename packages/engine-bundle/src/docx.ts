import type { PortableDiff } from "./portable";
import { markLoaded } from "./registry";

/**
 * Docxodus (WASM, closed source binary) adapter.
 *
 * Loaded lazily and only for .docx. Reuses the same public global hooks the
 * legacy bundle used, so engine drops remain compatible:
 *   window.__BRV_DOCXODUS_BASE__       → /engine/docxodus/
 *   window.__BRV_DOCXODUS_WASM_BASE__  → /engine/docxodus/wasm/
 */
export interface DocxodusViewerOptions {
  base?: string;
  wasmBase?: string;
}

interface DocxodusApi {
  createViewer?: (el: HTMLElement, file: File, opts: Record<string, unknown>) => Promise<unknown>;
  compareDocuments?: (a: Uint8Array, b: Uint8Array) => Promise<Uint8Array>;
  /** must be awaited once before compareDocuments/createViewer (wasm runtime) */
  initialize?: (wasmBasePath: string) => Promise<void>;
}

declare global {
  interface Window {
    __docxodusApi?: DocxodusApi;
    __BRV_DOCXODUS_BASE__?: string;
    __BRV_DOCXODUS_WASM_BASE__?: string;
  }
}

let pending: Promise<DocxodusApi> | null = null;

export function docxodusBase(): { base: string; wasmBase: string } {
  const origin = typeof location !== "undefined" ? location.origin : "";
  return {
    base: (window.__BRV_DOCXODUS_BASE__ ?? `${origin}/engine/docxodus/`).replace(/\/$/, ""),
    wasmBase: window.__BRV_DOCXODUS_WASM_BASE__ ?? `${origin}/engine/docxodus/wasm/`,
  };
}

export function loadDocxodus(options: DocxodusViewerOptions = {}): Promise<DocxodusApi> {
  if (typeof window === "undefined") return Promise.reject(new Error("docxodus: browser only"));
  if (window.__docxodusApi?.createViewer) return Promise.resolve(window.__docxodusApi);
  if (pending) return pending;

  const { base, wasmBase } = docxodusBase();
  const b = (options.base ?? base).replace(/\/$/, "");
  const w = options.wasmBase ?? wasmBase;
  window.__BRV_DOCXODUS_BASE__ = b + "/";
  window.__BRV_DOCXODUS_WASM_BASE__ = w;

  pending = new Promise<DocxodusApi>((resolve, reject) => {
    const entry = `${b}/embed.bundle.js`;
    const timer = window.setTimeout(() => reject(new Error(`docxodus: timeout loading ${entry}`)), 120_000);
    const onReady = () => {
      const api = window.__docxodusApi;
      if (api?.createViewer) {
        window.clearTimeout(timer);
        window.removeEventListener("docxodus:ready", onReady);
        markLoaded("docxodus");
        // the wasm runtime must be initialised exactly once before compare/viewer calls
        const init = api.initialize?.(w);
        Promise.resolve(init)
          .catch(() => undefined)
          .then(() => resolve(api));
      }
    };
    window.addEventListener("docxodus:ready", onReady);
    const script = document.createElement("script");
    script.type = "module";
    script.textContent = [
      `import * as __dx from '${entry}';`,
      "window.__docxodusApi = __dx;",
      "window.dispatchEvent(new CustomEvent('docxodus:ready'));",
    ].join("\n");
    script.onerror = () => {
      window.clearTimeout(timer);
      pending = null;
      reject(new Error(`docxodus: failed to load ${entry}`));
    };
    document.head.appendChild(script);
  });
  return pending;
}

export function buildDocxDiffPlaceholder(name: string): PortableDiff {
  return {
    schema: "diffs.work/portable@1",
    kind: "docx",
    engine: "docxodus (wasm)",
    summary: { added: 0, removed: 0, changed: 0, ratio: 0 },
    warnings: [
      `${name}: docx rev view needs the docxodus chunk (${"〜30 MB"} split per module);`,
      "the engine is fetched on demand in the full viewer. This landing page only shows the load plan.",
    ],
  };
}