/**
 * Generates `src-tauri/icons/` — full multi-resolution RGBA PNGs + multi-entry
 * Windows `.ico` for Vesper, rendered cleanly from vector geometry with zero
 * external native image dependencies and compatible with Node 18 / 20 / 22+.
 *
 *   node scripts/make-icon.mjs
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/* --------------------------- PNG + ICO encoding --------------------------- */

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32Bytes(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32Bytes(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Pack PNG buffers (16, 32, 48, 256) into a valid Windows Vista+ PNG-in-ICO file. */
function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // ICO type
  header.writeUInt16LE(entries.length, 4);

  const dirEntries = [];
  let offset = 6 + entries.length * 16;

  for (const { size, png } of entries) {
    const dir = Buffer.alloc(16);
    dir[0] = size >= 256 ? 0 : size;
    dir[1] = size >= 256 ? 0 : size;
    dir[2] = 0;
    dir[3] = 0;
    dir.writeUInt16LE(1, 4); // color planes
    dir.writeUInt16LE(32, 6); // bits per pixel
    dir.writeUInt32LE(png.length, 8);
    dir.writeUInt32LE(offset, 12);
    dirEntries.push(dir);
    offset += png.length;
  }

  return Buffer.concat([header, ...dirEntries, ...entries.map((e) => e.png)]);
}

/* ------------------------- Vector geometry (512 space) -------------------------- */

function roundedPlate(x, y, size, radius) {
  const half = size / 2;
  const dx = Math.abs(x - half) - (half - radius);
  const dy = Math.abs(y - half) - (half - radius);
  const ax = Math.max(dx, 0);
  const ay = Math.max(dy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - radius;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const t = Math.min(1, Math.max(0, (wx * vx + wy * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

function sample512(x, y) {
  const S = 512;
  const plateDist = roundedPlate(x, y, S, 108);
  if (plateDist > 0) return null;

  const rim = plateDist > -14;
  let r = rim ? 48 : 24;
  let g = rim ? 48 : 24;
  let b = rim ? 54 : 28;

  const halfStroke = 21;
  const left = distanceToSegment(x, y, 152, 150, 256, 336) - halfStroke;
  const right = distanceToSegment(x, y, 256, 336, 360, 150) - halfStroke;
  const dot = Math.hypot(x - 256, y - 398) - 22;

  if (Math.min(left, right, dot) <= 0) {
    r = 250;
    g = 250;
    b = 249;
  }
  return [r, g, b, 255];
}

function renderSize(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const samples = size <= 64 ? 4 : 3;
  const scale = 512 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const px = (x + (sx + 0.5) / samples) * scale;
          const py = (y + (sy + 0.5) / samples) * scale;
          const colour = sample512(px, py);
          if (!colour) continue;
          r += colour[0];
          g += colour[1];
          b += colour[2];
          a += colour[3];
        }
      }
      const count = samples * samples;
      const offset = (y * size + x) * 4;
      rgba[offset] = Math.round(r / count);
      rgba[offset + 1] = Math.round(g / count);
      rgba[offset + 2] = Math.round(b / count);
      rgba[offset + 3] = Math.round(a / count);
    }
  }
  return encodePng(size, size, rgba);
}

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "../src-tauri/icons");
mkdirSync(outDir, { recursive: true });

const png16 = renderSize(16);
const png32 = renderSize(32);
const png48 = renderSize(48);
const png128 = renderSize(128);
const png256 = renderSize(256);
const png512 = renderSize(512);

writeFileSync(resolve(outDir, "32x32.png"), png32);
writeFileSync(resolve(outDir, "128x128.png"), png128);
writeFileSync(resolve(outDir, "128x128@2x.png"), png256);
writeFileSync(resolve(outDir, "icon.png"), png512);
writeFileSync(resolve(outDir, "source.png"), png512);
writeFileSync(
  resolve(outDir, "icon.ico"),
  encodeIco([
    { size: 16, png: png16 },
    { size: 32, png: png32 },
    { size: 48, png: png48 },
    { size: 256, png: png256 },
  ]),
);

console.log(`✓ generated Vesper icons (32x32, 128x128, 128x128@2x, 512x512, icon.ico) in ${outDir}`);
