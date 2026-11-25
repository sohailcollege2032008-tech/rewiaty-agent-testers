import { strFromU8, strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import {
  ARCHIVE_TOO_LARGE_MESSAGE,
  ARCHIVE_TOO_MANY_FILES_MESSAGE,
  ArchiveError,
  EPUB_DRM_MESSAGE,
  EPUB_INVALID_MESSAGE,
  UNREADABLE_ARCHIVE_MESSAGE,
  UNSAFE_ARCHIVE_PATH_MESSAGE,
  isSafeImageSrc,
  parseBook,
  readBookArchive,
  readZipEntries,
} from '../src/index.js';

/** 1x1 transparent PNG, written by hand so no third-party image is involved. */
const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

function zipOf(files: Record<string, string | Uint8Array>): Uint8Array {
  const payload: Record<string, Uint8Array> = {};
  for (const [name, value] of Object.entries(files)) {
    payload[name] = typeof value === 'string' ? strToU8(value) : value;
  }
  return zipSync(payload);
}

const CONTAINER_XML = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const CHAPTER_1 = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>باب البداية</title><style>.x{color:red}</style>
    <script>window.alert('يجب ألا يظهر ده');</script>
  </head>
  <body>
    <h1>الْفَصْلُ الأَوَّلُ</h1>
    <p>جُمْلَةٌ <em>مَائِلَةٌ</em> وَجُمْلَةٌ <strong>عَرِيضَةٌ</strong>.</p>
    <p>حَاشِيَةٌ هُنَا<a epub:type="noteref" href="#note1">1</a>.</p>
    <p><img src="images/figure.png" alt="رسم توضيحي"/></p>
    <aside epub:type="footnote" id="note1"><p>نَصُّ الحَاشِيَةِ.</p></aside>
  </body>
</html>`;

const CHAPTER_2 = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>باب النهاية</title></head>
  <body>
    <h1>الْفَصْلُ الثَّانِي</h1>
    <p>سَطْرٌ أَخِيرٌ فِي الكِتَابِ.</p>
  </body>
</html>`;

function opf(spineIdrefs: string[], extra = ''): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">free-fixture</dc:identifier>
    <dc:title>رِوَايَةٌ تَجْرِيبِيَّةٌ</dc:title>
    <dc:creator>كَاتِبٌ تَجْرِيبِيٌّ</dc:creator>
    <dc:language>ar</dc:language>
  </metadata>
  <manifest>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="fig" href="images/figure.png" media-type="image/png"/>
    <item id="css" href="style.css" media-type="text/css"/>
    ${extra}
  </manifest>
  <spine>
    ${spineIdrefs.map((id) => `<itemref idref="${id}"/>`).join('\n    ')}
  </spine>
</package>`;
}

function epub2Fixture(): Uint8Array {
  return zipOf({
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': CONTAINER_XML,
    'OEBPS/content.opf': opf(['ch1', 'ch2'], '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>').replace(
      'version="3.0"',
      'version="2.0"',
    ),
    'OEBPS/ch1.xhtml': CHAPTER_1,
    'OEBPS/ch2.xhtml': CHAPTER_2,
    'OEBPS/images/figure.png': TINY_PNG,
    'OEBPS/style.css': 'body{color:red}',
    'OEBPS/toc.ncx': '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap/></ncx>',
  });
}

function epub3Fixture(): Uint8Array {
  return zipOf({
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': CONTAINER_XML,
    'OEBPS/content.opf': opf(['ch2', 'ch1'], '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'),
    'OEBPS/ch1.xhtml': CHAPTER_1,
    'OEBPS/ch2.xhtml': CHAPTER_2,
    'OEBPS/images/figure.png': TINY_PNG,
    'OEBPS/nav.xhtml':
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="ch2.xhtml">٢</a></li><li><a href="ch1.xhtml">١</a></li></ol></nav></body></html>',
  });
}

describe('zip book import', () => {
  it('sorts chapter files by name, turns the image into a safe asset, and parses as chapters', () => {
    const archive = zipOf({
      'chapters/10-epilogue.md': 'نِهَايَةُ الحِكَايَةِ.',
      'chapters/02-start.md': 'بِدَايَةُ الحِكَايَةِ.\n\n![لوحة](images/cover-art.png)',
      'images/cover-art.png': TINY_PNG,
      'README.txt': 'not a chapter, but a text file so it becomes one',
    });

    const imported = readBookArchive(archive, 'رواية تجريبية.zip');

    expect(imported.source).toBe('zip');
    expect(imported.assets).toHaveLength(1);
    expect(imported.assets[0]?.path).toBe('assets/cover-art.png');
    expect(isSafeImageSrc(imported.assets[0]!.path)).toBe(true);

    // Natural order: 02 before 10 before README is wrong here on purpose — README sorts after digits.
    const headings = imported.markdown
      .split('\n')
      .filter((line) => line.startsWith('# '))
      .map((line) => line.slice(2));
    expect(headings).toEqual(['02 start', '10 epilogue', 'README']);

    expect(imported.markdown).toContain('![لوحة](assets/cover-art.png)');
    expect(imported.markdown).toContain('title: "رواية تجريبية"');

    const parsed = parseBook(imported.markdown, 'book.md');
    expect(parsed.chapters).toHaveLength(3);
    const imageBlock = parsed.chapters[0]!.blocks.find((block) => block.kind === 'image');
    expect(imageBlock?.html).toBe('<img src="assets/cover-art.png" alt="لوحة">');
    expect(parsed.meta.title).toBe('رواية تجريبية');
  });

  it('uses a single markdown file with frontmatter as the whole book', () => {
    const archive = zipOf({
      'book.md': ['---', 'title: "كِتَابٌ وَاحِدٌ"', 'author: "مُؤَلِّفٌ"', '---', '', '# الفصل الوحيد', '', 'نَصٌّ.', '', '![صورة](images/a.png)'].join('\n'),
      'images/a.png': TINY_PNG,
    });

    const imported = readBookArchive(archive, 'anything.zip');
    expect(imported.title).toBe('كِتَابٌ وَاحِدٌ');
    expect(imported.markdown.startsWith('---')).toBe(true);
    expect(imported.markdown).toContain('assets/a.png');

    const parsed = parseBook(imported.markdown, 'book.md');
    expect(parsed.meta.title).toBe('كِتَابٌ وَاحِدٌ');
    expect(parsed.meta.author).toBe('مُؤَلِّفٌ');
  });

  it('escapes Markdown syntax inside plain .txt chapters', () => {
    const archive = zipOf({ 'ch1.txt': 'سَطْرٌ فِيهِ *نُجُوم* وَ[brackets]\n\nفَقْرَةٌ ثَانِيَةٌ.' });
    const imported = readBookArchive(archive, 'txt.zip');
    expect(imported.markdown).toContain('\\*نُجُوم\\*');
    expect(imported.markdown).toContain('\\[brackets\\]');
  });

  it('rejects zip-slip entries before extracting anything', () => {
    const archive = zipOf({
      'ch1.md': '# فصل\n\nنَصٌّ.',
      '../../etc/passwd': 'root:x:0:0',
    });
    expect(() => readBookArchive(archive, 'evil.zip')).toThrow(UNSAFE_ARCHIVE_PATH_MESSAGE);
  });

  it('rejects absolute and backslash entry paths too', () => {
    for (const badName of ['/etc/passwd', 'windows\\system32\\evil.md', 'C:/evil.md']) {
      const archive = zipOf({ 'ch1.md': '# فصل', [badName]: 'x' });
      expect(() => readBookArchive(archive, 'evil.zip')).toThrow(UNSAFE_ARCHIVE_PATH_MESSAGE);
    }
  });

  it('refuses a zip bomb through the declared uncompressed size', () => {
    const bomb = zipOf({ 'bomb.txt': new Uint8Array(1024 * 1024) });
    expect(() =>
      readBookArchive(bomb, 'bomb.zip', { limits: { maxUncompressedBytes: 64 * 1024 } }),
    ).toThrow(ARCHIVE_TOO_LARGE_MESSAGE);
  });

  it('refuses an archive with too many files', () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 12; i += 1) files[`ch${i}.md`] = `# فصل ${i}`;
    const archive = zipOf(files);
    expect(() => readBookArchive(archive, 'many.zip', { limits: { maxEntries: 5 } })).toThrow(
      ARCHIVE_TOO_MANY_FILES_MESSAGE,
    );
  });

  it('reports a non-zip file as unreadable instead of leaking an English error', () => {
    expect(() => readZipEntries(strToU8('this is not a zip'))).toThrow(UNREADABLE_ARCHIVE_MESSAGE);
  });

  it('rejects an archive without any chapter text', () => {
    const archive = zipOf({ 'images/a.png': TINY_PNG });
    expect(() => readBookArchive(archive, 'empty.zip')).toThrow(ArchiveError);
  });
});

describe('EPUB import', () => {
  it('follows container.xml → OPF → spine order for EPUB 2', () => {
    const imported = readBookArchive(epub2Fixture(), 'novel.epub');

    expect(imported.source).toBe('epub');
    expect(imported.title).toBe('رِوَايَةٌ تَجْرِيبِيَّةٌ');
    expect(imported.author).toBe('كَاتِبٌ تَجْرِيبِيٌّ');
    expect(imported.markdown).toContain('title: "رِوَايَةٌ تَجْرِيبِيَّةٌ"');
    expect(imported.markdown).toContain('author: "كَاتِبٌ تَجْرِيبِيٌّ"');
    expect(imported.markdown).toContain('lang: "ar"');

    const parsed = parseBook(imported.markdown, 'book.md');
    expect(parsed.chapters.map((chapter) => chapter.title)).toEqual([
      'الْفَصْلُ الأَوَّلُ',
      'الْفَصْلُ الثَّانِي',
    ]);
    expect(parsed.meta.dir).toBe('rtl');
  });

  it('converts paragraphs, emphasis, images and footnotes into book-format Markdown', () => {
    const imported = readBookArchive(epub2Fixture(), 'novel.epub');

    expect(imported.markdown).toContain('جُمْلَةٌ *مَائِلَةٌ* وَجُمْلَةٌ **عَرِيضَةٌ**.');
    expect(imported.markdown).toContain('![رسم توضيحي](assets/figure.png)');
    expect(imported.markdown).toMatch(/\[\^c1-note1\]/);
    expect(imported.markdown).toContain('[^c1-note1]: نَصُّ الحَاشِيَةِ.');

    // The stylesheet and inline script must never reach the book text.
    expect(imported.markdown).not.toContain('color:red');
    expect(imported.markdown).not.toContain('window.alert');
    expect(imported.markdown).not.toContain('<script');
    expect(imported.markdown).not.toContain('<style');

    const parsed = parseBook(imported.markdown, 'book.md');
    expect(Object.keys(parsed.footnotes)).toContain('c1-note1');
    const image = parsed.chapters[0]!.blocks.find((block) => block.kind === 'image');
    expect(image?.html).toBe('<img src="assets/figure.png" alt="رسم توضيحي">');
  });

  it('honours the EPUB 3 spine order and ignores assets and the nav document', () => {
    const imported = readBookArchive(epub3Fixture(), 'novel.epub');
    const parsed = parseBook(imported.markdown, 'book.md');
    expect(parsed.chapters.map((chapter) => chapter.title)).toEqual([
      'الْفَصْلُ الثَّانِي',
      'الْفَصْلُ الأَوَّلُ',
    ]);
    expect(imported.assets.map((asset) => asset.path)).toEqual(['assets/figure.png']);
  });

  it('rejects a DRM-protected EPUB with a clear Arabic message', () => {
    const drm = zipOf({
      mimetype: 'application/epub+zip',
      'META-INF/container.xml': CONTAINER_XML,
      'META-INF/encryption.xml':
        '<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData><CipherData><CipherReference URI="OEBPS/ch1.xhtml"/></CipherData></EncryptedData></encryption>',
      'OEBPS/content.opf': opf(['ch1']),
      'OEBPS/ch1.xhtml': CHAPTER_1,
    });
    expect(() => readBookArchive(drm, 'locked.epub')).toThrow(EPUB_DRM_MESSAGE);
  });

  it('still imports an EPUB whose encryption.xml only obfuscates fonts', () => {
    const fontObfuscated = zipOf({
      mimetype: 'application/epub+zip',
      'META-INF/container.xml': CONTAINER_XML,
      'META-INF/encryption.xml':
        '<?xml version="1.0"?><encryption><EncryptedData><CipherData><CipherReference URI="OEBPS/fonts/body.otf"/></CipherData></EncryptedData></encryption>',
      'OEBPS/content.opf': opf(['ch1']),
      'OEBPS/ch1.xhtml': CHAPTER_1,
      'OEBPS/fonts/body.otf': new Uint8Array([1, 2, 3]),
    });
    expect(readBookArchive(fontObfuscated, 'fonts.epub').markdown).toContain('الْفَصْلُ الأَوَّلُ');
  });

  it('rejects a zip that only pretends to be an EPUB', () => {
    const broken = zipOf({ 'ch1.md': '# فصل' });
    expect(() => readBookArchive(broken, 'broken.epub')).toThrow(EPUB_INVALID_MESSAGE);
  });

  it('sniffs the container when the file name has no extension (Android providers)', () => {
    const imported = readBookArchive(epub2Fixture(), 'كتاب بدون امتداد');
    expect(imported.source).toBe('epub');
    expect(parseBook(imported.markdown, 'book.md').chapters).toHaveLength(2);
  });
});
