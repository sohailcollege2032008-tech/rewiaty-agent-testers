import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(mobileRoot, '../..');
const assetsDir = path.join(mobileRoot, 'assets');

fs.mkdirSync(assetsDir, { recursive: true });

// 1. Copy reader.html built from packages/reader-engine
const readerHtmlSrc = path.join(repoRoot, 'packages/reader-engine/dist/reader.html');
const readerHtmlDest = path.join(assetsDir, 'reader.html');

if (!fs.existsSync(readerHtmlSrc)) {
  throw new Error(
    `Missing built reader engine at ${readerHtmlSrc}. Run "npm run build" in repo root first.`,
  );
}
fs.copyFileSync(readerHtmlSrc, readerHtmlDest);

// 2. Copy sample-ar.md (prefer samples/sample-ar.md if present, fallback to reader-engine fixture)
const primarySampleSrc = path.join(repoRoot, 'samples/sample-ar.md');
const fallbackSampleSrc = path.join(
  repoRoot,
  'packages/reader-engine/test/fixtures/sample-ar.md',
);
const sampleSrc = fs.existsSync(primarySampleSrc) ? primarySampleSrc : fallbackSampleSrc;
const sampleDest = path.join(assetsDir, 'sample-ar.md');

if (!fs.existsSync(sampleSrc)) {
  throw new Error(`Missing sample Arabic novel at ${primarySampleSrc} or ${fallbackSampleSrc}.`);
}
fs.copyFileSync(sampleSrc, sampleDest);

console.log(
  `Synced assets -> ${path.relative(repoRoot, readerHtmlDest)} & ${path.relative(repoRoot, sampleDest)}`,
);
