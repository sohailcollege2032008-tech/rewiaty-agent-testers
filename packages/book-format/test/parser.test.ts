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
