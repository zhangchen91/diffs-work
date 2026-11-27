/**
 * Read a user's file as text without mangling Chinese.
 *
 * BOM wins; otherwise strict UTF-8; when the bytes are not valid UTF-8 fall back
 * to GB18030 (GBK/GB2312/.contains what Windows users still save as "ANSI").
 * `file.text()` silently replaces every Chinese byte with U+FFFD — that was the
 * mojibake bug.
 */
export function decodeText(bytes: ArrayBuffer, _name = ""): string {
  const u8 = new Uint8Array(bytes);
  if (u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(u8.subarray(3));
  }
  if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder("utf-16le").decode(u8.subarray(2));
  if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder("utf-16be").decode(u8.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(u8);
  } catch {
    return new TextDecoder("gb18030").decode(u8);
  }
}

export function isBinary(bytes: ArrayBuffer): boolean {
  const u8 = new Uint8Array(bytes, 0, Math.min(4096, bytes.byteLength));
  for (const b of u8) if (b === 0) return true;
  return false;
}

/**
 * True when a decoded string is mostly U+FFFD or stray Latin-1 box glyphs — the
 * signature of decoding bytes with the wrong charset.
 */
export function looksGarbled(text: string): boolean {
  if (!text) return false;
  let bad = 0;
  for (const ch of text) if (ch === "\uFFFD") bad++;
  return bad / text.length > 0.05;
}
