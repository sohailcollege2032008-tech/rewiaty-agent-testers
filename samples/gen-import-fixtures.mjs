#!/usr/bin/env node
/**
 * Build the `.epub` used by the Maestro `import-epub` journey on the emulator.
 *
 * Why a script: the fixture must be free of any third-party text, so its chapters are written
 * here by hand. The generated file is committed next to `sample-ar.md` because the CI runner
 * pushes it straight to `/sdcard/Download/` before the journey starts.
 *
 *   node samples/gen-import-fixtures.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';

const here = path.dirname(fileURLToPath(import.meta.url));

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==',
  'base64',
);

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
    <p>هَذَا فَصْلٌ فِيهِ صُورَةٌ صَغِيرَةٌ، لِلتَّأَكُّدِ مِنْ أَنَّ الْحِكَايَةَ تَظَلُّ مَقْرُوءَةً بَعْدَ اسْتِيرَادِ الْأَصْلِ وَصُوَرِهِ.</p>
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

const files = {
  mimetype: [strToU8('application/epub+zip'), { level: 0 }],
  'META-INF/container.xml': strToU8(container),
  'OEBPS/content.opf': strToU8(opf),
  'OEBPS/nav.xhtml': strToU8(nav),
  'OEBPS/ch1.xhtml': strToU8(ch1),
  'OEBPS/ch2.xhtml': strToU8(ch2),
  'OEBPS/ch3.xhtml': strToU8(ch3),
  'OEBPS/images/fig.png': new Uint8Array(PNG),
  'OEBPS/style.css': strToU8('body{font-family:serif}'),
};

const target = path.join(here, 'import-f20.epub');
fs.writeFileSync(target, Buffer.from(zipSync(files)));
console.log(`wrote ${path.relative(process.cwd(), target)} (${fs.statSync(target).size} bytes)`);
