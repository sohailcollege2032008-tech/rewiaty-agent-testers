import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'dist');
fs.mkdirSync(distDir, { recursive: true });

// 1. Bundle engine TypeScript as a single IIFE in memory
const jsResult = await esbuild.build({
  entryPoints: [path.join(__dirname, 'src/engine.ts')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  write: false,
});

// 2. Bundle/minify CSS in memory
const cssResult = await esbuild.build({
  entryPoints: [path.join(__dirname, 'src/styles.css')],
  bundle: true,
  minify: true,
  write: false,
});

const jsCode = (jsResult.outputFiles[0]?.text ?? '').replace(/<\/script/gi, '<\\/script');
const cssCode = (cssResult.outputFiles[0]?.text ?? '').replace(/<\/style/gi, '<\\/style');

const template = fs.readFileSync(path.join(__dirname, 'src/template.html'), 'utf8');
const html = template
  .replace('<!--INLINE_STYLE-->', () => `<style>${cssCode}</style>`)
  .replace('<!--INLINE_SCRIPT-->', () => `<script>${jsCode}</script>`);

const readerHtmlPath = path.join(distDir, 'reader.html');
fs.writeFileSync(readerHtmlPath, html, 'utf8');

// 3. Bundle dev-panel.ts + built-in fixtures for dev.html browser testing
const sampleAr = fs.readFileSync(path.join(__dirname, 'test/fixtures/sample-ar.md'), 'utf8');
const sampleEn = fs.readFileSync(path.join(__dirname, 'test/fixtures/sample-en.md'), 'utf8');

await esbuild.build({
  entryPoints: [path.join(__dirname, 'src/dev-panel.ts')],
  bundle: true,
  minify: false,
  format: 'iife',
  target: ['es2020'],
  define: {
    __BUILTIN_SAMPLE_AR__: JSON.stringify(sampleAr),
    __BUILTIN_SAMPLE_EN__: JSON.stringify(sampleEn),
  },
  outfile: path.join(distDir, 'dev-panel.js'),
});

console.log(`Built ${path.relative(process.cwd(), readerHtmlPath)} (${Buffer.byteLength(html, 'utf8')} bytes)`);
