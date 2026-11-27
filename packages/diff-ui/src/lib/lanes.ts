/**
 * One entry point that decides *how* to compare a pair, for every surface.
 *
 * This is the fifth time a family worked on the website and not in the local viewer (or the other
 * way round): Word arrived in one, PDF only ever existed in the other, and each fix had to be made
 * twice. The rendering was already shared; the decision of which engine to call, and with what, was
 * not — it was a chain of `if (fm.id === …)` copied into each studio.
 *
 * Everything here returns data. It does not touch React, the DOM, or any per-app state, so both
 * apps call it and get the same answers.
 *
 * Lives in `diff-ui` rather than `diff-tool`: that package imports `node:url` for the kernel and
 * cannot be bundled for the browser, which is how a shared-lane refactor first broke the local
 * build outright.
 */

export type CompareLane = "pdf" | "code" | "sheet" | "opc" | "text";

export interface CompareTarget {
  name: string;
  text?: string;
  bytes?: ArrayBuffer;
}

/** Which engine a pair goes to, or null when the inputs cannot support it. */
export function laneFor(family: string, a: CompareTarget, b: CompareTarget): CompareLane | null {
  if (family === "pdf") return a.bytes && b.bytes ? "pdf" : null;
  if ((family === "xlsx" || family === "docx" || family === "pptx") && a.bytes && b.bytes) {
    return family === "xlsx" ? "sheet" : "opc";
  }
  if (family === "code" && a.text != null && b.text != null) return "code";
  if (family === "markdown" || family === "text") return "text";
  // Anything else that arrived as text is still text — except a binary family, which must not
  // fall back to comparing its bytes as characters. A .pdf that reached here without bytes is a
  // caller mistake, and text-diffing it would produce a card full of `PK\x03\x04` instead of an
  // error a person can act on.
  if (family === "docx" || family === "xlsx" || family === "pptx" || family === "pdf" || family === "legacy-office") return null;
  return a.text != null && b.text != null ? "text" : null;
}

/**
 * The kernel commands a lane needs, as a list.
 *
 * A list rather than a `switch` inside each app: a surface that only wants the cheap result can run
 * the first entry, and one that wants everything runs all of them, without either app deciding for
 * itself what a lane consists of.
 */
export function kernelCalls(lane: CompareLane, a: CompareTarget, b: CompareTarget, filename: string): Array<Record<string, unknown>> {
  switch (lane) {
    case "code":
      return [
        { cmd: "ls_diff", a: a.text, b: b.text, filename },
        { cmd: "sem_diff", a: a.text, b: b.text, filename },
      ];
    case "sheet":
      return [{ cmd: "sheet_diff", a: toBase64(a.bytes!), b: toBase64(b.bytes!) }];
    case "opc":
      return [{ cmd: "opc_diff", a: toBase64(a.bytes!), b: toBase64(b.bytes!), kind: filename.split(".").pop() === "pptx" ? "pptx" : "docx" }];
    default:
      return [];
  }
}

function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode(...view.subarray(i, i + chunk));
  }
  return btoa(binary);
}
