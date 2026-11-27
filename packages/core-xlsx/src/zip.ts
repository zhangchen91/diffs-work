/**
 * Minimal zip reader over fflate: lists entries and reads one entry as bytes.
 * Enough for OOXML (xlsx / docx / pptx), which only needs stored/deflated entries.
 */
import { unzipSync, strFromU8, type Unzipped } from "fflate";

export type { Unzipped };

export interface ZipEntry {
  path: string;
  size: number;
}

export function listEntries(bytes: Uint8Array): ZipEntry[] {
  const files = unzipSync(bytes);
  return Object.keys(files).map((path) => ({ path, size: files[path].byteLength }));
}

export function readZip(bytes: Uint8Array): Unzipped {
  return unzipSync(bytes);
}

export function readText(files: Unzipped, path: string): string | null {
  const f = files[path];
  return f ? strFromU8(f) : null;
}

export function has(files: Unzipped, path: string): boolean {
  return Object.prototype.hasOwnProperty.call(files, path);
}

/** Resolve a relationship-relative path (`/xl/worksheets/sheet1.xml`, `worksheets/sheet2.xml`) against a base directory. */
export function resolvePath(baseDir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = `${baseDir}/${target}`.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}