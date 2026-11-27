import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  PAPER_GRAIN_DATA_URI,
  PAPER_GRAIN_OPACITY,
  PAPER_GRAIN_PNG_BASE64,
  PAPER_GRAIN_SIZE,
  PAPER_GRAIN_THEMES,
  isPaperGrainTheme,
} from '../src/paper-grain.js';

/**
 * F27 — ملمس الورق: the texture itself.
 *
 * The CSS/Playwright spec proves the page paints the grain on the right themes; this file pins the
 * *asset*: a real, self-generated 128×128 PNG that Chromium can decode first time, that is not a
 * flat fill, and that is byte-identical to the file shipped for the app. A generated texture that
 * silently drifts from the committed one is the classic way a "paper feel" ships as nothing.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_PNG = path.resolve(__dirname, '../../../apps/mobile/assets/images/paper-grain-128.png');

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

type PngChunk = { type: string; data: Buffer; crcOk: boolean };

/** Walk the chunk stream, verifying every length prefix and CRC the way a decoder does. */
function readChunks(png: Buffer): PngChunk[] {
  const chunks: PngChunk[] = [];
  let offset = PNG_SIGNATURE.length;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('latin1');
    const data = png.subarray(offset + 8, offset + 8 + length);
    const recorded = png.readUInt32BE(offset + 8 + length);
    const body = png.subarray(offset + 4, offset + 8 + length);
    chunks.push({ type, data: Buffer.from(data), crcOk: crc32(body) === recorded });
    offset += 12 + length;
  }
  return chunks;
}

const PNG = Buffer.from(PAPER_GRAIN_PNG_BASE64, 'base64');

/** Inflate the raster and undo PNG scanline filters, so a pixel can be read for its grey value. */
function decodeRgba(png: Buffer): { width: number; height: number; pixels: number[] } | null {
  const chunks = readChunks(png);
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  if (!ihdr) return null;
  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const bitDepth = ihdr.data[8]!;
  const colourType = ihdr.data[9]!;
  if (bitDepth !== 8 || colourType !== 6) return null; // RGBA8 only, as the generator writes
  const raw = zlib.inflateSync(Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const bpp = 4;
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos]!;
    pos += 1;
    const rowStart = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const rawByte = raw[pos + x]!;
      const left = x >= bpp ? out[rowStart + x - bpp]! : 0;
      const up = y > 0 ? out[rowStart - stride + x]! : 0;
      const upLeft = y > 0 && x >= bpp ? out[rowStart - stride + x - bpp]! : 0;
      let value: number;
      switch (filter) {
        case 0:
          value = rawByte;
          break;
        case 1:
          value = rawByte + left;
          break;
        case 2:
          value = rawByte + up;
          break;
        case 3:
          value = rawByte + Math.floor((left + up) / 2);
          break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          value = rawByte + predictor;
          break;
        }
        default:
          return null;
      }
      out[rowStart + x] = value & 0xff;
    }
    pos += stride;
  }
  const pixels: number[] = [];
  for (let i = 0; i < out.length; i += bpp) {
    pixels.push(out[i]!, out[i + 1]!, out[i + 2]!, out[i + 3]!);
  }
  return { width, height, pixels };
}

describe('F27 paper grain asset', () => {
  it('exports the contract constants', () => {
    expect(PAPER_GRAIN_SIZE).toBe(128);
    expect(PAPER_GRAIN_OPACITY).toBe(0.03);
    expect([...PAPER_GRAIN_THEMES]).toEqual(['warraq', 'sepia']);
    expect(PAPER_GRAIN_DATA_URI.startsWith('data:image/png;base64,')).toBe(true);
    expect(PAPER_GRAIN_DATA_URI).toBe(`data:image/png;base64,${PAPER_GRAIN_PNG_BASE64}`);
  });

  it('is a real PNG: signature, IHDR 128x128 RGBA8, valid CRCs, IDAT and IEND', () => {
    expect([...PNG.subarray(0, 8)]).toEqual(PNG_SIGNATURE);

    const chunks = readChunks(PNG);
    expect(chunks.every((c) => c.crcOk)).toBe(true);

    const ihdr = chunks.find((c) => c.type === 'IHDR');
    expect(ihdr).toBeDefined();
    expect(ihdr!.data.readUInt32BE(0)).toBe(128);
    expect(ihdr!.data.readUInt32BE(4)).toBe(128);
    expect(ihdr!.data[8]).toBe(8); // bit depth
    expect(ihdr!.data[9]).toBe(6); // RGBA

    expect(chunks.some((c) => c.type === 'IDAT')).toBe(true);
    expect(chunks.at(-1)?.type).toBe('IEND');
    expect(chunks.at(-1)?.data.length).toBe(0);
  });

  it('is organic noise, not a blank or flat fill', () => {
    const decoded = decodeRgba(PNG);
    expect(decoded).not.toBeNull();
    expect(decoded!.width).toBe(128);
    expect(decoded!.height).toBe(128);

    // Count distinct complete pixels. A flat fill (or a two-value stencil) is not a paper texture.
    const distinct = new Set<number>();
    for (let i = 0; i < decoded!.pixels.length; i += 4) {
      distinct.add(
        (decoded!.pixels[i]! << 24) |
          (decoded!.pixels[i + 1]! << 16) |
          (decoded!.pixels[i + 2]! << 8) |
          decoded!.pixels[i + 3]!,
      );
    }
    expect(distinct.size).toBeGreaterThan(100);

    // The grain is a mixture: some pixels are near-transparent, some carry real speckle.
    const alphas = [];
    for (let i = 3; i < decoded!.pixels.length; i += 4) alphas.push(decoded!.pixels[i]!);
    const minAlpha = Math.min(...alphas);
    const maxAlpha = Math.max(...alphas);
    expect(maxAlpha - minAlpha).toBeGreaterThan(80);
    expect(alphas.some((a) => a === 0)).toBe(true);
  });

  it('is shipped byte-for-byte as the mobile asset the generator writes', () => {
    expect(fs.existsSync(MOBILE_PNG)).toBe(true);
    const onDisk = fs.readFileSync(MOBILE_PNG);
    expect(onDisk.equals(PNG)).toBe(true);
  });

  it('only enables the grain for the two paper themes, and never over custom colours', () => {
    expect(isPaperGrainTheme('warraq')).toBe(true);
    expect(isPaperGrainTheme('sepia')).toBe(true);
    expect(isPaperGrainTheme('warraq', true)).toBe(false);
    expect(isPaperGrainTheme('sepia', true)).toBe(false);
    expect(isPaperGrainTheme('burnt-paper')).toBe(false);
    expect(isPaperGrainTheme('oled-crimson')).toBe(false);
    expect(isPaperGrainTheme('night-ink')).toBe(false);
    expect(isPaperGrainTheme('custom')).toBe(false);
    expect(isPaperGrainTheme('nonsense')).toBe(false);
  });
});
