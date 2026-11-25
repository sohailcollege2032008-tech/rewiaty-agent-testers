#!/usr/bin/env node
/**
 * Build the `.epub` fixtures used by the Maestro `import-epub` journey on the emulator.
 *
 * Why a script: the fixtures must be free of any third-party text, so the chapters are written here
 * by hand. The generated files are committed next to `sample-ar.md` because the CI runner pushes
 * them straight to `/sdcard/Download/` before the journey starts.
 *
 * Two files come out of the same source, differing in exactly one thing:
 *   - `import-f20.epub`        — the figure referenced by ch2 is inside the archive, so the reader
 *                                must report a painted image (`reader-image-proof`).
 *   - `import-f20-broken.epub` — identical, except the figure's bytes are not a decodable PNG. The
 *                                entry still exists, so the Markdown keeps `![...](assets/fig.png)`
 *                                and the reader really does insert an `<img>` — it just cannot
 *                                decode, so nothing paints. The journey asserting
 *                                `reader-image-proof` must therefore fail. That negative control is
 *                                what proves the assertion is not vacuous (a *missing* entry would
 *                                be dropped at conversion time and prove much less).
 *
 *   node samples/gen-import-fixtures.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { strToU8, zipSync } from 'fflate';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Width/height of the fixture figure. The journey asserts the rendered box is non-zero. */
const PNG_WIDTH = 240;
const PNG_HEIGHT = 160;

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

/**
 * Encode a real RGB PNG by hand (no image library on the import path, and the fixture has to be a
 * genuine decodable image — a 1×1 placeholder still "paints" but proves nothing about layout).
 * Each scanline carries filter byte 0 (none) followed by R,G,B triples.
 */
function encodePng(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0;
    for (let x = 0; x < width; x += 1) {
      // A soft diagonal gradient inside a dark frame, so the screenshot visibly contains a figure.
      const border = x < 3 || y < 3 || x >= width - 3 || y >= height - 3;
      const offset = y * stride + 1 + x * 3;
      if (border) {
        raw[offset] = 0x2b;
        raw[offset + 1] = 0x2b;
        raw[offset + 2] = 0x33;
      } else {
        raw[offset] = 0xf2 - Math.round((x / width) * 0x40);
        raw[offset + 1] = 0xe6 - Math.round((y / height) * 0x50);
        raw[offset + 2] = 0xd0;
      }
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const PNG = encodePng(PNG_WIDTH, PNG_HEIGHT);

const container = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="ar">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">rewiaty-import-fixture</dc:identifier>
    <dc:title>حِكَايَةُ الْاِخْتِبَارِ</dc:title>
    <dc:creator>فريق روايتي</dc:creator>
    <dc:language>ar</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch3" href="ch3.xhtml" media-type="application/xhtml+xml"/>
    <item id="fig" href="images/fig.png" media-type="image/png"/>
    <item id="style" href="style.css" media-type="text/css"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
    <itemref idref="ch3"/>
  </spine>
</package>`;

const nav = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ar" dir="rtl">
  <head><title>الفهرس</title></head>
  <body>
    <nav epub:type="toc"><ol>
      <li><a href="ch1.xhtml">البداية</a></li>
      <li><a href="ch2.xhtml">الطريق</a></li>
      <li><a href="ch3.xhtml">النهاية</a></li>
    </ol></nav>
  </body>
</html>`;

const ch1 = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ar" dir="rtl">
  <head><title>البداية</title><link rel="stylesheet" href="style.css"/></head>
  <body>
    <h1>الْفَصْلُ الْأَوَّلُ: الْبِدَايَةُ</h1>
    <p>كَانَتْ هُنَاكَ <em>حِكَايَةٌ</em> صَغِيرَةٌ، وَكَانَ <strong>الْاِخْتِبَارُ</strong> أَنَّ التَّطْبِيقَ يَقْرَؤُهَا مِنْ مَلَفٍّ مُغْلَقٍ<a epub:type="noteref" href="#note1">1</a>.</p>
    <p>وَهَذِهِ فَقْرَةٌ ثَانِيَةٌ فِي الْفَصْلِ الْأَوَّلِ لِلتَّأَكُّدِ مِنْ أَنَّ الْفَوَاصِلَ بَيْنَ الْفَقَرَاتِ صَحِيحَةٌ.</p>
    <aside epub:type="footnote" id="note1"><p>هَذِهِ حَاشِيَةٌ تَجْرِيبِيَّةٌ مَكْتُوبَةٌ خِصِّيصًا لِهَذَا الْاِخْتِبَارِ.</p></aside>
  </body>
</html>`;

const ch2 = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ar" dir="rtl">
  <head><title>الطريق</title></head>
  <body>
    <h1>الْفَصْلُ الثَّانِي: الطَّرِيقُ</h1>
    <p>هَذَا فَصْلٌ فِيهِ صُورَةٌ، لِلتَّأَكُّدِ مِنْ أَنَّ الْحِكَايَةَ تَظَلُّ مَقْرُوءَةً بَعْدَ اسْتِيرَادِ الْأَصْلِ وَصُوَرِهِ.</p>
    <p><img src="images/fig.png" alt="شكل تجريبي"/></p>
    <blockquote><p>وَاقْتِبَاسٌ تَجْرِيبِيٌّ لَا يَرْجِعُ لِأَيِّ كِتَابٍ.</p></blockquote>
  </body>
</html>`;

const ch3 = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ar" dir="rtl">
  <head><title>النهاية</title></head>
  <body>
    <h1>الْفَصْلُ الثَّالِثُ: النِّهَايَةُ</h1>
    <p>وَفِي النِّهَايَةِ، هَذِهِ نُصُوصٌ حُرَّةٌ كَتَبَهَا فَرِيقُ رَوَايْتِي لِاخْتِبَارِ الْاِسْتِيرَادِ فَقَطْ، وَلَيْسَ لَهَا أَيُّ حُقُوقِ نَشْرٍ لِأَحَدٍ.</p>
  </body>
</html>`;

/** Bytes that are not a PNG: the entry resolves and renders, but decoding fails. */
const BROKEN_PNG = Buffer.from('rewiaty-negative-control: this is not a decodable png\n', 'utf8');

function buildEpub({ figure }) {
  const files = {
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(container),
    'OEBPS/content.opf': strToU8(opf),
    'OEBPS/nav.xhtml': strToU8(nav),
    'OEBPS/ch1.xhtml': strToU8(ch1),
    'OEBPS/ch2.xhtml': strToU8(ch2),
    'OEBPS/ch3.xhtml': strToU8(ch3),
    'OEBPS/style.css': strToU8('body{font-family:serif}'),
  };
  if (figure === 'valid') files['OEBPS/images/fig.png'] = new Uint8Array(PNG);
  else if (figure === 'corrupt') files['OEBPS/images/fig.png'] = new Uint8Array(BROKEN_PNG);
  return Buffer.from(zipSync(files));
}

for (const [name, figure] of [
  ['import-f20.epub', 'valid'],
  ['import-f20-broken.epub', 'corrupt'],
]) {
  const target = path.join(here, name);
  fs.writeFileSync(target, buildEpub({ figure }));
  console.log(`wrote ${path.relative(process.cwd(), target)} (${fs.statSync(target).size} bytes)`);
}
console.log(`figure: ${PNG_WIDTH}×${PNG_HEIGHT} PNG, ${PNG.length} bytes`);
