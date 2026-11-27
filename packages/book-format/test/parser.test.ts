import { describe, expect, it } from 'vitest';
import { parseBook, parseTxt } from '../src/index.js';

describe('parseBook', () => {
  it('parses YAML frontmatter, chapters, subheadings, scene breaks, quotes, images, inline styles, and footnotes', () => {
    const md = [
      '---',
      'title: "لَيْلَةٌ فِي الْقَاهِرَةِ"',
      'author: "كاتب تجريبي"',
      'lang: ar',
      'dir: rtl',
      'coverColor: "#4A2E1B"',
      '---',
      '',
      '# الْفَصْلُ الْأَوَّلُ: الْبِدَايَةُ',
      '',
      'كَانَتِ السَّمَاءُ *صَافِيَةً* وَالْقَمَرُ **مُكْتَمِلًا** فِي لَيْلَةٍ هَادِئَةٍ[^1].',
      '',
      'فَقْرَةٌ ثَانِيَةٌ بَعْدَ الْفَقْرَةِ الْأُولَى.',
      '',
      '## مَشْهَدٌ عَابِرٌ',
      '',
      'فَقْرَةٌ بَعْدَ عُنْوَانٍ فَرْعِيٍّ.',
      '',
      '***',
      '',
      'فَقْرَةٌ بَعْدَ فَاصِلِ النُّجُومِ.',
      '',
      '---',
      '',
      'فَقْرَةٌ بَعْدَ فَاصِلِ الشُّرَطِ.',
      '',
      '> رِسَالَةٌ قَدِيمَةٌ *مَحْفُوظَةٌ*',
      '> سَطْرٌ ثَانٍ فِي الرِّسَالَةِ',
      '',
      '![رسم توضيحي](assets/scene1.png)',
      '',
      '# الْفَصْلُ الثَّانِي: الرَّحِيلُ',
      '',
      'بِدَايَةُ الْفَصْلِ الثَّانِي[^note].',
      '',
      '[^1]: حَاشِيَةٌ أُولَى بِ**تَنْسِيقٍ** وَ*إِمَالَةٍ*.',
      '[^note]: حَاشِيَةٌ مُسَمَّاةٌ',
      '    وَلَهَا تَكْمِلَةٌ فِي سَطْرٍ مُزَاحٍ.',
    ].join('\n');

    const book = parseBook(md, 'cairo-night.md');

    expect(book.meta).toEqual({
      title: 'لَيْلَةٌ فِي الْقَاهِرَةِ',
      author: 'كاتب تجريبي',
      lang: 'ar',
      dir: 'rtl',
      coverColor: '#4A2E1B',
    });

    expect(book.chapters).toHaveLength(2);
    const ch1 = book.chapters[0]!;
    const ch2 = book.chapters[1]!;

    expect(ch1.id).toBe('ch01');
    expect(ch1.title).toBe('الْفَصْلُ الْأَوَّلُ: الْبِدَايَةُ');
    expect(ch2.id).toBe('ch02');
    expect(ch2.title).toBe('الْفَصْلُ الثَّانِي: الرَّحِيلُ');

    expect(ch1.blocks.map((b) => [b.id, b.kind, b.noIndent ?? false])).toEqual([
      ['ch01_p0001', 'p', true],
      ['ch01_p0002', 'p', false],
      ['ch01_p0003', 'h2', false],
      ['ch01_p0004', 'p', true],
      ['ch01_p0005', 'break', false],
      ['ch01_p0006', 'p', true],
      ['ch01_p0007', 'break', false],
      ['ch01_p0008', 'p', true],
      ['ch01_p0009', 'quote', false],
      ['ch01_p0010', 'image', false],
    ]);

    expect(ch1.blocks[0]!.html).toBe(
      'كَانَتِ السَّمَاءُ <em>صَافِيَةً</em> وَالْقَمَرُ <strong>مُكْتَمِلًا</strong> فِي لَيْلَةٍ هَادِئَةٍ<sup class="fn-ref"><a href="#fn-1" data-fn="1" role="button">1</a></sup>.',
    );
    expect(ch1.blocks[4]!.html).toBe('✦ ✦ ✦');
    expect(ch1.blocks[6]!.html).toBe('✦ ✦ ✦');
    expect(ch1.blocks[8]!.html).toBe('رِسَالَةٌ قَدِيمَةٌ <em>مَحْفُوظَةٌ</em> سَطْرٌ ثَانٍ فِي الرِّسَالَةِ');
    expect(ch1.blocks[9]!.html).toBe('<img src="assets/scene1.png" alt="رسم توضيحي">');

    expect(ch2.blocks[0]!.id).toBe('ch02_p0001');
    expect(ch2.blocks[0]!.noIndent).toBe(true);

    expect(book.footnotes['1']?.[0]?.html).toBe(
      'حَاشِيَةٌ أُولَى بِ<strong>تَنْسِيقٍ</strong> وَ<em>إِمَالَةٍ</em>.',
    );
    expect(book.footnotes['note']?.[0]?.html).toBe(
      'حَاشِيَةٌ مُسَمَّاةٌ وَلَهَا تَكْمِلَةٌ فِي سَطْرٍ مُزَاحٍ.',
    );

    expect(ch1.wordCount).toBeGreaterThan(20);
    expect(ch2.wordCount).toBe(3);
    expect(book.wordCount).toBe(ch1.wordCount + ch2.wordCount);
    expect(ch1.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(ch2.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(ch1.hash).not.toBe(ch2.hash);
  });

  it('preserves Arabic Tashkeel character-for-character without stripping or normalizing', () => {
    const tashkeelLine =
      'مُحَمَّدٌ يَقْرَأُ كِتَابًا مُشَكَّلًا بِالْفَتْحَةِ وَالضَّمَّةِ وَالْكَسْرَةِ وَالتَّنْوِينِ وَالشَّدَّةِ وَالسُّكُونِ: إِنَّ اللَّهَ غَفُورٌ رَحِيمٌ.';
    const md = `# الْفَصْلُ\n\n${tashkeelLine}\n`;
    const book = parseBook(md, 'tashkeel.md');
    const rendered = book.chapters[0]?.blocks[0]?.html;

    expect(rendered).toBe(tashkeelLine);
    expect([...rendered!].map((c) => c.codePointAt(0))).toEqual(
      [...tashkeelLine].map((c) => c.codePointAt(0)),
    );
  });

  it('escapes all raw HTML and blocks unsafe image URIs', () => {
    const md = [
      '# Chapter 1',
      '',
      'Hello <script>alert("xss")</script> & <b>bold</b> *italic* and **strong**.',
      '',
      '> Quote with <img src=x onerror=alert(1)> inside.',
      '',
      '![bad](javascript:alert(1))',
      '',
      '![alt "quoted"](images/pic&1.png)',
    ].join('\n');

    const book = parseBook(md, 'xss.md');
    const blocks = book.chapters[0]!.blocks;

    expect(blocks[0]!.html).toBe(
      'Hello &lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &lt;b&gt;bold&lt;/b&gt; <em>italic</em> and <strong>strong</strong>.',
    );
    expect(blocks[0]!.html).not.toContain('<script>');
    expect(blocks[1]!.html).toBe(
      'Quote with &lt;img src=x onerror=alert(1)&gt; inside.',
    );
    expect(blocks[2]!.kind).toBe('p');
    expect(blocks[2]!.html).toBe('![bad](javascript:alert(1))');
    expect(blocks[3]!.kind).toBe('image');
    expect(blocks[3]!.html).toBe('<img src="images/pic&amp;1.png" alt="alt &quot;quoted&quot;">');
  });

  it('does not confuse body --- scene breaks with YAML frontmatter when no frontmatter exists', () => {
    const md = [
      '---',
      '',
      'First paragraph after opening divider.',
      '',
      '---',
      '',
      'Second paragraph after second divider.',
    ].join('\n');

    const book = parseBook(md, 'no-frontmatter.md');
    expect(book.meta.title).toBe('no-frontmatter');
    expect(book.meta.dir).toBe('ltr');
    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0]!.blocks.map((b) => b.kind)).toEqual(['break', 'p', 'break', 'p']);
    expect(book.chapters[0]!.blocks[1]!.noIndent).toBe(true);
    expect(book.chapters[0]!.blocks[3]!.noIndent).toBe(true);
  });

  it('keeps snake_case underscores intact while supporting boundary _em_ and deterministic hashes', () => {
    const md = '# One\n\nKeep foo_bar_baz untouched, italicize _this phrase_ and ***both***.';
    const a = parseBook(md, 'en.md');
    const b = parseBook(md, 'en.md');
    const c = parseBook(`${md} Extra`, 'en.md');

    expect(a.chapters[0]!.blocks[0]!.html).toBe(
      'Keep foo_bar_baz untouched, italicize <em>this phrase</em> and <strong><em>both</em></strong>.',
    );
    expect(a.chapters[0]!.hash).toBe(b.chapters[0]!.hash);
    expect(a.chapters[0]!.hash).not.toBe(c.chapters[0]!.hash);
  });

  describe('chapter splitting parity (F21 delta re-parse splitter)', () => {
    it('titles the preamble chapter with the frontmatter title, not the file name', () => {
      const md = [
        '---',
        'title: "كِتَابُ الرِّمَالِ"',
        'lang: ar',
        'dir: rtl',
        '---',
        '',
        'مُقَدِّمَةٌ تَأْتِي قَبْلَ أَوَّلِ فَصْلٍ.',
        '',
        '# الْفَصْلُ الْأَوَّلُ',
        '',
        'نَصُّ الْفَصْلِ الْأَوَّلِ.',
      ].join('\n');

      const book = parseBook(md, 'file-name-forced.md');

      expect(book.meta.title).toBe('كِتَابُ الرِّمَالِ');
      expect(book.chapters).toHaveLength(2);
      expect(book.chapters[0]!.title).toBe('كِتَابُ الرِّمَالِ');
      expect(book.chapters[0]!.blocks[0]!.html).toContain('مُقَدِّمَةٌ');
      expect(book.chapters[1]!.id).toBe('ch02');
    });

    it('titles a heading whose text is empty after stripping with the resolved title', () => {
      const md = [
        '---',
        'title: "عُنْوَانٌ مُسْتَعَارٌ"',
        'lang: ar',
        'dir: rtl',
        '---',
        '',
        '# [^n1]',
        '',
        'نَصُّ الْفَصْلِ الْأَوَّلِ.',
      ].join('\n');

      const book = parseBook(md, 'ignored-name.md');

      expect(book.chapters).toHaveLength(1);
      expect(book.chapters[0]!.title).toBe('عُنْوَانٌ مُسْتَعَارٌ');
      expect(book.chapters[0]!.blocks[0]!.html).toContain('نَصُّ الْفَصْلِ');
    });

    it('does not create a ghost chapter for a lone empty quote line before the first heading', () => {
      const md = ['>', '', '# الْفَصْلُ الْأَوَّلُ', '', 'نَصُّ الْفَصْلِ الْأَوَّلِ.'].join('\n');

      const book = parseBook(md, 'ghost.md');

      expect(book.chapters).toHaveLength(1);
      // The chapter ids must not shift: the first real chapter is ch01, never ch02.
      expect(book.chapters[0]!.id).toBe('ch01');
      expect(book.chapters[0]!.title).toBe('الْفَصْلُ الْأَوَّلُ');
      expect(book.chapters[0]!.blocks).toHaveLength(1);
    });

    it('keeps an explicit empty ">" preamble chapter when it is followed by real content', () => {
      const md = ['>', '', 'مُقَدِّمَةٌ بَعْدَ اقْتِبَاسٍ فَارِغٍ.', '', '# الْفَصْلُ الْأَوَّلُ', '', 'نَصٌّ.'].join(
        '\n',
      );

      const book = parseBook(md, 'preamble.md');

      expect(book.chapters).toHaveLength(2);
      expect(book.chapters[0]!.blocks).toHaveLength(1);
      expect(book.chapters[0]!.blocks[0]!.html).toContain('مُقَدِّمَةٌ');
      expect(book.chapters[1]!.id).toBe('ch02');
    });

    it('preserves an explicit empty "#" chapter even though it has no blocks', () => {
      const md = ['# الْفَصْلُ الْأَوَّلُ', '', '# الْفَصْلُ الثَّانِي', '', 'نَصُّ الثَّانِي.'].join('\n');

      const book = parseBook(md, 'empty-chapter.md');

      expect(book.chapters.map((chapter) => chapter.id)).toEqual(['ch01', 'ch02']);
      expect(book.chapters[0]!.blocks).toEqual([]);
      expect(book.chapters[1]!.blocks[0]!.html).toContain('نَصُّ الثَّانِي');
    });
  });
});

describe('parseTxt', () => {
  it('parses plain text into a single chapter with escaped HTML and preserved Tashkeel', () => {
    const txt = [
      'السَّطْرُ الْأَوَّلُ بِهِ <tag> وَحَرَكَاتٌ.',
      '',
      'السَّطْرُ الثَّانِي مَعَ *نَجْمَةٍ* لَا تَتَحَوَّلُ لِتَنْسِيقٍ.',
    ].join('\n');

    const book = parseTxt(txt, '/tmp/story-sample.txt');

    expect(book.meta.title).toBe('story-sample');
    expect(book.meta.lang).toBe('ar');
    expect(book.meta.dir).toBe('rtl');
    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0]!.id).toBe('ch01');
    expect(book.chapters[0]!.blocks).toHaveLength(2);
    expect(book.chapters[0]!.blocks[0]).toEqual({
      id: 'ch01_p0001',
      kind: 'p',
      html: 'السَّطْرُ الْأَوَّلُ بِهِ &lt;tag&gt; وَحَرَكَاتٌ.',
      noIndent: true,
    });
    expect(book.chapters[0]!.blocks[1]).toEqual({
      id: 'ch01_p0002',
      kind: 'p',
      html: 'السَّطْرُ الثَّانِي مَعَ *نَجْمَةٍ* لَا تَتَحَوَّلُ لِتَنْسِيقٍ.',
    });
    expect(book.wordCount).toBe(12);
  });
});

describe('XSS hardening', () => {
  const imgs = (md: string) =>
    parseBook(`# فصل\n\n${md}\n`, 'x.md').chapters[0]!.blocks.filter((b) => b.kind === 'image');

  it.each([
    'javascript:alert(1)',
    ' JaVaScRiPt:alert(1)',
    'vbscript:x',
    'data:text/html;base64,PHNjcmlwdD4=',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'file:///etc/passwd',
    'blob:https://x/y',
    'content://com.android/x',
    '//evil.example/x.png',
  ])('drops unsafe image src %s', (src) => {
    expect(imgs(`![a](${src})`)).toHaveLength(0);
  });

  it.each(['assets/ch01.webp', 'https://example.com/a.png', 'data:image/png;base64,iVBORw0KGgo='])(
    'keeps safe image src %s',
    (src) => {
      expect(imgs(`![a](${src})`)).toHaveLength(1);
    },
  );

  it('never emits active html from raw input or link syntax', () => {
    const book = parseBook(
      '# فصل\n\n<script>alert(1)</script> <img src=x onerror=alert(1)> [click](javascript:alert(1)) <a href="javascript:x">y</a>\n',
      'x.md',
    );
    const html = book.chapters[0]!.blocks.map((b) => b.html).join('');
    // Every real tag must be from the inline allowlist; the raw input survives only as escaped text.
    const tags = [...html.matchAll(/<\/?([a-z0-9]+)/gi)].map((m) => m[1]!.toLowerCase());
    for (const t of tags) expect(['em', 'strong', 'br', 'sup', 'a']).toContain(t);
    expect(html).not.toMatch(/<a\b(?![^>]*class="fn-ref")[^>]*>/i);
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).toContain('&lt;script&gt;');
  });
});
