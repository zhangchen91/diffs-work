/**
 * Generates the extension icons from one SVG, without a native image library:
 * a tiny PNG encoder that draws the diffs.work mark at 16/32/48/128 px.
 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SIZES = [16, 32, 48, 128];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/** rounded-square mark: dark tile, mint divider bars */
function draw(size) {
  const buf = Buffer.alloc(size * size * 4);
  const r = size * 0.28;
  const put = (x, y, [R, G, B, A]) => {
    const i = (y * size + x) * 4;
    buf[i] = R;
    buf[i + 1] = G;
    buf[i + 2] = B;
    buf[i + 3] = A;
  };
  const inRound = (x, y) => {
    const cx = Math.min(Math.max(x, r), size - r);
    const cy = Math.min(Math.max(y, r), size - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  const bar = (x0, x1, t0, t1) => {
    for (let y = Math.floor(t0); y < Math.ceil(t1); y++) {
      for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
        if (x >= 0 && y >= 0 && x < size && y < size) put(x, y, [110, 231, 183, 255]);
      }
    }
  };
  const line = (x0, x1, y, rgb) => {
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      for (let dy = Math.floor(y); dy < Math.ceil(y + size * 0.075); dy++) {
        if (x >= 0 && dy >= 0 && x < size && dy < size) put(x, dy, [...rgb, 255]);
      }
    }
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      put(x, y, inRound(x, y) ? [11, 13, 19, 255] : [0, 0, 0, 0]);
    }
  }
  // two vertical bars (the "diff" marks)
  bar(size * 0.55, size * 0.62, size * 0.22, size * 0.78);
  bar(size * 0.7, size * 0.77, size * 0.22, size * 0.78);
  // three grey lines
  line(size * 0.22, size * 0.44, size * 0.3, [75, 85, 103]);
  line(size * 0.22, size * 0.48, size * 0.46, [75, 85, 103]);
  line(size * 0.22, size * 0.4, size * 0.63, [75, 85, 103]);
  return buf;
}

await mkdir(HERE, { recursive: true });
for (const s of SIZES) {
  await writeFile(path.join(HERE, `icon${s}.png`), png(s, s, draw(s)));
  console.log(`[icons] icon${s}.png`);
}
