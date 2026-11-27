import { markLoaded } from "./registry";

/**
 * pdf.js adapter — loaded lazily and only for .pdf.
 * The worker keeps parsing off the main thread; the diff overlay is produced by
 * the closed-source overlay wasm (page raster → text boxes → compare).
 */
export interface PdfEngineHandles {
  pdfjsLib: PdfJsModule;
  workerSrc: string;
}

interface PdfJsModule { [k: string]: unknown }

declare global {
  interface Window {
    __BRV_PDFJS_BASE__?: string;
  }
}

let pending: Promise<PdfEngineHandles> | null = null;

export function pdfjsBase(): string {
  const origin = typeof location !== "undefined" ? location.origin : "";
  return window.__BRV_PDFJS_BASE__ ?? `${origin}/engine/pdfjs/`;
}

export function loadPdfjs(): Promise<PdfEngineHandles> {
  if (typeof window === "undefined") return Promise.reject(new Error("pdfjs: browser only"));
  if (pending) return pending;
  const base = pdfjsBase();
  window.__BRV_PDFJS_BASE__ = base;
  pending = (async () => {
    const pdfjsLib = await import(/* webpackIgnore: true */ `${base}pdf.mjs` as string);
    const workerSrc = `${base}pdf.worker.min.mjs`;
    try {
      (pdfjsLib as unknown as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc = workerSrc;
    } catch {
      /* older builds set it themselves */
    }
    markLoaded("pdfjs");
    return { pdfjsLib: pdfjsLib as PdfJsModule, workerSrc };
  })();
  return pending;
}