#!/usr/bin/env node
/**
 * F27 — ملمس الورق (subtle paper grain) asset generator.
 *
 * Why (tech): the grain is a *static* 128×128 PNG, tiled by CSS at 3% opacity. A live SVG
 * (`feTurbulence`) or a CSS `filter` would be re-computed on every frame of every page turn on a
 * phone — the one thing the spec forbids — so the texture is baked here, once, and shipped.
 *
 * Determinism matters as much as the look: the base64 lives in `src/paper-grain.ts` (which the
 * engine bundles) while the same bytes must exist as a real mobile asset, and a test asserts they
 * are identical. Any change to the seed or maths must regenerate BOTH files in one run.
 *
 * Node built-ins only — no image library, no network, no canvas.
 *
 *   node scripts/generate-paper-grain.mjs
 *
 * Outputs:
 *   apps/mobile/assets/images/paper-grain-128.png
 *   packages/reader-engine/src/paper-grain.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SIZE = 128;
/** Fixed seed: the texture is a project asset, not a random each-run decoration. */
const SEED = 0x9e3779b9;
/** Warm near-black ink. The grain is alpha only, so the RGB stays constant and deflate-friendly. */
const INK = { r: 38, g: 32, b: 25 };

// ---------------------------------------------------------------------------
// Deterministic hashing / value noise
// ---------------------------------------------------------------------------

/** 32-bit integer hash of two coordinates plus a salt. Stable across runs, no Math.random. */
function hash2(x, y, salt) {
  let h = (x | 0) * 0x27d4eb2d ^ (y | 0) * 0x165667b1 ^ (salt | 0) * 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 0xffffffff; // 0..1
}

const smoothstep = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Tileable value noise on a `grid × grid` lattice.
 *
 * The lattice indices wrap with `% grid`, so the value at x=127 and x=0 interpolate between the
 * same pair of corners: the tile joins seamlessly when CSS repeats it. Plain per-pixel randomness
 * would also join, but it looks like TV static, not paper.
 */
function valueNoise(x, y, grid, salt) {
  const gx = x / SIZE * grid;
  const gy = y / SIZE * grid;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const tx = smoothstep(gx - x0);
  const ty = smoothstep(gy - y0);
  const xa = ((x0 % grid) + grid) % grid;
  const ya = ((y0 % grid) + grid) % grid;
  const xb = (xa + 1) % grid;
  const yb = (ya + 1) % grid;
  const v00 = hash2(xa, ya, salt);
  const v10 = hash2(xb, ya, salt);
  const v01 = hash2(xa, yb, salt);
  const v11 = hash2(xb, yb, salt);
  return lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), ty);
}

/**
 * One RGBA pixel of the grain.
 *
 * Three octaves give the blotchy fibre structure (large soft clouds, mid clumps, fine tooth); the
 * last term is independent speckle — the flecks that make paper feel fibrous rather than noisy.
 * Alpha is what varies; the ink colour is constant.
 */
function grainAlpha(x, y) {
  const coarse = valueNoise(x, y, 8, SEED ^ 0x1);
  const medium = valueNoise(x, y, 24, SEED ^ 0x2);
  const fine = valueNoise(x, y, 56, SEED ^ 0x3);
  const body = coarse * 0.5 + medium * 0.33 + fine * 0.17;

  const fleck = hash2(x, y, SEED ^ 0x4);
  let speckle = 0;
  if (fleck < 0.045) {
    // Sparse dark flecks, the "fibre" a reader can just feel at 3%.
    speckle = 0.55 + hash2(y, x, SEED ^ 0x5) * 0.45;
  } else if (fleck < 0.11) {
    speckle = 0.12 + hash2(x, y, SEED ^ 0x6) * 0.22;
  }

  // Keep the tile low-ink: a low mean alpha plus a sparse tail of full-strength flecks reads as
  // fibre at 3%, whereas a uniformly opaque tile just dims the page. The floor drops the faintest
  // noise entirely (near-empty pixels stay empty) so the tile also compresses well.
  const alpha = body * 0.42 + speckle;
  const value = Math.round(alpha * 255);
  if (value < 14) return 0;
  return Math.min(255, value);
}

// ---------------------------------------------------------------------------
// Minimal, spec-correct PNG writer (RGBA8, filter type 0 per scanline)
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function buildPng() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour + alpha (RGBA)
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const stride = SIZE * 4 + 1;
  const raw = Buffer.alloc(stride * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter: None — keeps the bytes trivially inspectable and the test simple
    for (let x = 0; x < SIZE; x += 1) {
      const offset = rowStart + 1 + x * 4;
      raw[offset] = INK.r;
      raw[offset + 1] = INK.g;
      raw[offset + 2] = INK.b;
      raw[offset + 3] = grainAlpha(x, y);
    }
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Emit the asset + the generated TS module
// ---------------------------------------------------------------------------

/** Wrap the base64 into readable chunks, joined at runtime so the value stays one string. */
function base64ArrayLiteral(base64, width = 120) {
  const lines = [];
  for (let i = 0; i < base64.length; i += width) {
    lines.push(`  '${base64.slice(i, i + width)}',`);
  }
  return `[\n${lines.join('\n')}\n].join('')`;
}

const png = buildPng();
const base64 = png.toString('base64');

const repoRoot = path.resolve(import.meta.dirname, '..');
const pngTarget = path.join(repoRoot, 'apps/mobile/assets/images/paper-grain-128.png');
const tsTarget = path.join(repoRoot, 'packages/reader-engine/src/paper-grain.ts');

fs.mkdirSync(path.dirname(pngTarget), { recursive: true });
fs.writeFileSync(pngTarget, png);

const tsSource = `/**
 * F27 — ملمس الورق (subtle paper grain).
 *
 * GENERATED by \`scripts/generate-paper-grain.mjs\` — do not edit by hand. The bytes here are the
 * same PNG written to \`apps/mobile/assets/images/paper-grain-128.png\`; a test asserts that, so the
 * engine and the shipped asset can never drift apart.
 *
 * The grain is a static 128×128 tile painted at ${0.03 * 100}% opacity behind the text on the two paper themes. It is
 * deliberately NOT a live filter: no \`filter\`, no \`backdrop-filter\`, no \`feTurbulence\`.
 */
export const PAPER_GRAIN_SIZE = ${SIZE};
export const PAPER_GRAIN_OPACITY = 0.03;
export const PAPER_GRAIN_THEMES = ['warraq', 'sepia'] as const;

export type PaperGrainTheme = (typeof PAPER_GRAIN_THEMES)[number];

export const PAPER_GRAIN_PNG_BASE64 = ${base64ArrayLiteral(base64)};

export const PAPER_GRAIN_DATA_URI = \`data:image/png;base64,\${PAPER_GRAIN_PNG_BASE64}\`;

/**
 * Whether the grain belongs on the page for a theme.
 *
 * Custom colours win over everything (the reader chose the exact paper), and only the two warm
 * paper presets get grain — a dark page with a light fleck texture looks like dirt on the glass.
 */
export function isPaperGrainTheme(themeId: string, customColorsActive = false): boolean {
  if (customColorsActive) return false;
  return (PAPER_GRAIN_THEMES as readonly string[]).includes(themeId);
}
`;

fs.writeFileSync(tsTarget, tsSource);

console.log(
  `paper grain ${SIZE}x${SIZE}: ${png.length} bytes png, ${base64.length} base64 chars\n` +
    `  -> ${path.relative(repoRoot, pngTarget)}\n` +
    `  -> ${path.relative(repoRoot, tsTarget)}`,
);
