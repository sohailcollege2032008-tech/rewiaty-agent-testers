import { describe, expect, it } from 'vitest';
import { cleanArabicText, parseBook, parseTxt } from '../src/index.js';

const TASHKEEL_LINE =
  'مُحَمَّدٌ يَقْرَأُ كِتَابًا مُشَكَّلًا بِالْفَتْحَةِ وَالضَّمَّةِ وَالْكَسْرَةِ.';

describe('cleanArabicText — punctuationSpacing', () => {
  it('removes spaces and tabs before Arabic punctuation', () => {
    expect(cleanArabicText('مرحبًا ، كيف حالك ؟')).toBe('مرحبًا، كيف حالك؟');
    expect(cleanArabicText('قال ؛ ثم سكت !')).toBe('قال؛ ثم سكت!');
    expect(cleanArabicText('انظر : هنا …')).toBe('انظر: هنا…');
    expect(cleanArabicText('نص\t، نص')).toBe('نص، نص');
  });

  it('never breaks decimal numbers', () => {
    expect(cleanArabicText('السعر 3.5 جنيه')).toBe('السعر 3.5 جنيه');
    expect(cleanArabicText('النسبة ١٢٫٥ بالمئة')).toBe('النسبة ١٢٫٥ بالمئة');
    expect(cleanArabicText('القيمة 3 .5 من الوحدة')).toBe('القيمة 3 .5 من الوحدة');
  });

  it('never breaks URLs, paths, or serial dots', () => {
    const url = 'https://example.com/a.b?c=1';
    expect(cleanArabicText(url)).toBe(url);
    expect(cleanArabicText('الرابط https ://example.com/a')).toBe('الرابط https ://example.com/a');
    expect(cleanArabicText('انتظر...')).toBe('انتظر...');
    expect(cleanArabicText('انتظر . . .')).toBe('انتظر . . .');
    expect(cleanArabicText('الملف report .pdf جاهز')).toBe('الملف report .pdf جاهز');
  });

  it('can be disabled', () => {
    const input = 'مرحبًا ، كيف حالك ؟';
    expect(cleanArabicText(input, { punctuationSpacing: false })).toBe(input);
  });
});

describe('cleanArabicText — arabicQuotes', () => {
  it('converts straight quotes around Arabic text to guillemets', () => {
    expect(cleanArabicText('قال "مرحبًا بك" ثم مضى')).toBe('قال «مرحبًا بك» ثم مضى');
    expect(cleanArabicText('"البداية" و"النهاية"')).toBe('«البداية» و«النهاية»');
  });

  it('pairs quotes strictly left to right', () => {
    expect(cleanArabicText('He said "hello" ثم "مرحبًا"')).toBe(
      'He said "hello" ثم «مرحبًا»',
    );
  });

  it('leaves English quotes untouched', () => {
    expect(cleanArabicText('He said "hello" and left')).toBe('He said "hello" and left');
    expect(cleanArabicText('"Hello"')).toBe('"Hello"');
  });

  it('leaves HTML and Markdown syntax attributes untouched', () => {
    const html = '<img src="cover.png" alt="وصف عربي">';
    expect(cleanArabicText(html)).toBe(html);
    const md = '[رابط](https://x.test "عنوان عربي")';
    expect(cleanArabicText(md)).toBe(md);
  });

  it('leaves unbalanced quotes and blank-line crossings untouched', () => {
    expect(cleanArabicText('قال "مرحبًا فقط')).toBe('قال "مرحبًا فقط');
    expect(cleanArabicText('"كلام عربي\n\nثم بقية"')).toBe('"كلام عربي\n\nثم بقية"');
  });

  it('can be disabled', () => {
    expect(cleanArabicText('قال "مرحبًا"', { arabicQuotes: false })).toBe('قال "مرحبًا"');
  });
});

describe('cleanArabicText — unwrapHardLines', () => {
  it('joins hard-wrapped lines inside a paragraph with a single space', () => {
    const input = ['هذا سطر', 'مكسور في فقرة', 'واحدة.', '', 'فقرة ثانية', 'مكسورة.'].join('\n');
    expect(cleanArabicText(input)).toBe(
      ['هذا سطر مكسور في فقرة واحدة.', '', 'فقرة ثانية مكسورة.'].join('\n'),
    );
  });

  it('keeps blank lines as paragraph separators', () => {
    expect(cleanArabicText('أ\n\nب\n\nج')).toBe('أ\n\nب\n\nج');
  });

  it('keeps a line ending with a sentence terminator on its own line', () => {
    expect(cleanArabicText('انتهى الأمر.\nثم ذهب')).toBe('انتهى الأمر.\nثم ذهب');
    expect(cleanArabicText('أين ذهبت؟\nلا أعلم')).toBe('أين ذهبت؟\nلا أعلم');
    expect(cleanArabicText('«مرحبًا»\nوسطر جديد')).toBe('«مرحبًا»\nوسطر جديد');
    expect(cleanArabicText('واصل…\nثم توقف')).toBe('واصل…\nثم توقف');
  });

  it('keeps YAML frontmatter intact', () => {
    const input = [
      '---',
      'title: "كتاب عربي"',
      'author: كاتب',
      '---',
      '',
      'هذا سطر',
      'مكسور',
    ].join('\n');
    expect(cleanArabicText(input)).toBe(
      ['---', 'title: "كتاب عربي"', 'author: كاتب', '---', '', 'هذا سطر مكسور'].join('\n'),
    );
  });

  it('keeps headings, scene breaks, quotes, images, and footnotes on their own lines', () => {
    const input = [
      '# عنوان',
      'سطر',
      'مكسور',
      '## عنوان فرعي',
      '***',
      '---',
      '___',
      '> اقتباس',
      'يس',
      '![صورة](assets/a.png)',
      '![صورة](assets/b.png)',
      '![[img.webp]]',
      '[^1]: حاشية',
      'نص عادي',
      'مكسور',
    ].join('\n');

    expect(cleanArabicText(input)).toBe(
      [
        '# عنوان',
        'سطر مكسور',
        '## عنوان فرعي',
        '***',
        '---',
        '___',
        '> اقتباس',
        'يس',
        '![صورة](assets/a.png)',
        '![صورة](assets/b.png)',
        '![[img.webp]]',
        '[^1]: حاشية',
        'نص عادي مكسور',
      ].join('\n'),
    );
  });

  it('never glues dialogue lines into the line before them', () => {
    const input = ['نص عادي', '- عنصر حوار', '— حوار مسرحي', '«اقتباس»', 'تكملة'].join('\n');
    expect(cleanArabicText(input)).toBe(input);
  });

  it('keeps detected .txt chapter headings on their own line', () => {
    const input = ['الفصل الأول', 'نص السطر', 'مكسور', 'Chapter 2', 'بداية', 'ثانية'].join('\n');
    expect(cleanArabicText(input)).toBe(
      ['الفصل الأول', 'نص السطر مكسور', 'Chapter 2', 'بداية ثانية'].join('\n'),
    );
  });

  it('can be disabled', () => {
    expect(cleanArabicText('أ\nب', { unwrapHardLines: false })).toBe('أ\nب');
  });
});

describe('cleanArabicText — invariants', () => {
  it('preserves Arabic Tashkeel character-for-character', () => {
    const cleaned = cleanArabicText(TASHKEEL_LINE);
    expect(cleaned).toBe(TASHKEEL_LINE);
    expect([...cleaned].map((c) => c.codePointAt(0))).toEqual(
      [...TASHKEEL_LINE].map((c) => c.codePointAt(0)),
    );
  });

  it('is idempotent on mixed fixtures', () => {
    const fixtures = [
      'مرحبًا ، كيف حالك ؟',
      'قال "مرحبًا بك" ثم مضى ، سلام .',
      ['سطر', 'مكسور', '', 'ثانٍ.'].join('\n'),
      ['---', 'title: "كتاب"', '---', '', 'نص', 'مكسور ، هنا'].join('\n'),
      ['# عنوان', 'نص "عربي" ، هنا', '***', 'سطر', 'مكسور'].join('\n'),
      'https://example.com/a.b?c=1',
    ];

    for (const fixture of fixtures) {
      const once = cleanArabicText(fixture);
      expect(cleanArabicText(once)).toBe(once);
    }
  });

  it('never mutates a .txt file on disk (pure string transform)', () => {
    const source = 'نص ، عربي';
    cleanArabicText(source);
    expect(source).toBe('نص ، عربي');
  });
});

describe('parseBook — cleanArabic option', () => {
  it('defaults to off and keeps the historical text untouched', () => {
    const book = parseBook('# فصل\n\nنص ، عربي\n', 'x.md');
    expect(book.chapters[0]!.blocks[0]!.html).toBe('نص ، عربي');
  });

  it('cleans the body only, leaving frontmatter metadata intact', () => {
    const md = [
      '---',
      'title: "ليلة في القاهرة"',
      'dir: rtl',
      '---',
      '',
      '# الْفَصْلُ الْأَوَّلُ',
      '',
      'نص ، عربي .',
    ].join('\n');

    const book = parseBook(md, 'x.md', { cleanArabic: true });
    expect(book.meta.title).toBe('ليلة في القاهرة');
    expect(book.chapters[0]!.title).toBe('الْفَصْلُ الْأَوَّلُ');
    expect(book.chapters[0]!.blocks[0]!.html).toBe('نص، عربي.');
  });

  it('still parses structure (headings, images, footnotes) after cleaning', () => {
    const md = [
      '# Chapter 1',
      '',
      '![a](assets/a.png)',
      '',
      'نص "عربي" هنا[^1] .',
      '',
      '[^1]: حاشية',
    ].join('\n');

    const book = parseBook(md, 'x.md', { cleanArabic: true });
    const blocks = book.chapters[0]!.blocks;
    expect(blocks.map((b) => b.kind)).toEqual(['image', 'p']);
    expect(blocks[1]!.html).toContain('«عربي»');
    expect(blocks[1]!.html).toContain('<sup class="fn-ref">');
    expect(book.footnotes['1']?.[0]?.html).toBe('حاشية');
  });
});

describe('parseTxt — cleanArabic option', () => {
  it('joins wrapped lines and fixes punctuation when enabled', () => {
    const txt = ['الفصل الأول', 'هذا سطر', 'مكسور ، هنا'].join('\n');
    const book = parseTxt(txt, 'story.txt', { cleanArabic: true });

    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0]!.title).toBe('الفصل الأول');
    expect(book.chapters[0]!.blocks).toHaveLength(1);
    expect(book.chapters[0]!.blocks[0]!.html).toBe('هذا سطر مكسور، هنا');
  });

  it('defaults to off and keeps each source line as its own paragraph', () => {
    const txt = ['هذا سطر', 'مكسور ، هنا'].join('\n');
    const book = parseTxt(txt, 'story.txt');
    expect(book.chapters[0]!.blocks).toHaveLength(2);
  });
});

describe('cleanArabicText performance (Codex #20)', () => {
  it('cleans a ~200k-word book full of spaced punctuation in linear time', () => {
    const para = 'قال الرجل ، ثم سكت ؛ وسأل : لماذا ؟ لا أعرف ! انتهى …\n\n';
    const text = para.repeat(20000); // ~240k words, 120k spaced marks
    const t0 = Date.now();
    const out = cleanArabicText(text);
    const ms = Date.now() - t0;
    expect(out).toContain('قال الرجل، ثم سكت؛');
    expect(ms).toBeLessThan(2000);
  });
});
