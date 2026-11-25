import { describe, expect, it } from 'vitest';
import { detectTxtChapterHeading, parseTxt } from '../src/index.js';

const isolated = { prevBlank: true, nextBlank: true };

describe('detectTxtChapterHeading — Arabic headings', () => {
  it.each([
    'الفصل الأول',
    'الفصل الأول: البداية',
    'الفصل 1',
    'الفصل ١٢',
    'فصل 3',
    'الباب الثاني',
    'باب 4',
    'الجزء الأول',
    'الجزء ١',
    'المقدمة',
    'مقدمة',
    'مقدمة: كلمة قبل البداية',
    'تمهيد',
    'الخاتمة',
    'خاتمة',
    'الفصل الحادي عشر',
    'الفصل الثاني والعشرون',
    'فصل: الأول',
  ])('detects %s', (line) => {
    expect(detectTxtChapterHeading(line)).toBe(line);
  });

  it('detects headings that carry Tashkeel and returns them unchanged', () => {
    const line = 'الْفَصْلُ الْأَوَّلُ: الْبِدَايَةُ';
    expect(detectTxtChapterHeading(line)).toBe(line);
    expect(detectTxtChapterHeading('الْبَابُ الثَّانِي')).toBe('الْبَابُ الثَّانِي');
  });

  it('rejects narrative lines that merely start with a chapter word', () => {
    expect(detectTxtChapterHeading('الفصل ده كان حكاية طويلة')).toBeNull();
    expect(detectTxtChapterHeading('المقدمة كانت صعبة')).toBeNull();
    expect(detectTxtChapterHeading('الفصل الأخير كان مؤثرًا')).toBeNull();
    expect(detectTxtChapterHeading('وسألته عن الفصل الأول')).toBeNull();
  });
});

describe('detectTxtChapterHeading — English headings', () => {
  it.each([
    'Chapter 1',
    'CHAPTER IV: Title',
    'Chapter One',
    'Part 1',
    'Prologue',
    'Epilogue',
    'Chapter 12 — The Return',
  ])('detects %s', (line) => {
    expect(detectTxtChapterHeading(line)).toBe(line);
  });

  it('rejects English prose', () => {
    expect(detectTxtChapterHeading('Chapter 1 was long and cold.')).toBeNull();
    expect(detectTxtChapterHeading('He opened chapter one slowly')).toBeNull();
    expect(detectTxtChapterHeading('Chapter')).toBeNull();
  });
});

describe('detectTxtChapterHeading — standalone numbers', () => {
  it.each(['1', '١', '١٢', '(١)', '[1]', '- 1 -', '— ١ —'])(
    'detects %s when isolated by a blank line before it',
    (line) => {
      expect(detectTxtChapterHeading(line, isolated)).toBe(line);
      expect(detectTxtChapterHeading(line, { prevBlank: true, nextBlank: false })).toBe(line);
    },
  );

  it.each(['I', 'IV', 'IX', 'X', 'XIV', 'XL', 'L'])(
    'detects roman numeral %s only when surrounded by blank lines',
    (line) => {
      expect(detectTxtChapterHeading(line, isolated)).toBe(line);
      expect(detectTxtChapterHeading(line, { prevBlank: true, nextBlank: false })).toBeNull();
    },
  );

  it('rejects numbers that are not isolated', () => {
    expect(detectTxtChapterHeading('1', { prevBlank: false, nextBlank: true })).toBeNull();
    expect(detectTxtChapterHeading('IV', { prevBlank: false, nextBlank: true })).toBeNull();
  });

  it('rejects false positives', () => {
    expect(detectTxtChapterHeading('1234567890123')).toBeNull();
    expect(detectTxtChapterHeading('VIIII')).toBeNull();
    expect(detectTxtChapterHeading('')).toBeNull();
    expect(detectTxtChapterHeading('   ')).toBeNull();
  });
});

describe('detectTxtChapterHeading — false-positive protection', () => {
  it('rejects any line longer than 80 characters', () => {
    const longArabic = `الفصل الأول ${'طويل '.repeat(20)}`;
    expect(longArabic.length).toBeGreaterThan(80);
    expect(detectTxtChapterHeading(longArabic)).toBeNull();

    const longEnglish = `Chapter 1 ${'long '.repeat(20)}`;
    expect(longEnglish.length).toBeGreaterThan(80);
    expect(detectTxtChapterHeading(longEnglish)).toBeNull();
  });

  it('rejects lines that end with sentence-final punctuation', () => {
    expect(detectTxtChapterHeading('الفصل الأول.')).toBeNull();
    expect(detectTxtChapterHeading('Chapter 1?')).toBeNull();
    expect(detectTxtChapterHeading('تمهيد!')).toBeNull();
  });
});

describe('parseTxt — chapter detection', () => {
  it('splits on detected headings and starts every chapter on a non-indented paragraph', () => {
    const txt = [
      'الفصل الأول: البداية',
      'بدأت الحكاية هنا.',
      'الفصل الثاني',
      'ثم انتهت.',
    ].join('\n');

    const book = parseTxt(txt, 'novel.txt');
    expect(book.chapters.map((c) => c.id)).toEqual(['ch01', 'ch02']);
    expect(book.chapters.map((c) => c.title)).toEqual(['الفصل الأول: البداية', 'الفصل الثاني']);
    expect(book.chapters[0]!.blocks[0]!.noIndent).toBe(true);
    expect(book.chapters[1]!.blocks[0]!.noIndent).toBe(true);
    expect(book.chapters[0]!.blocks[0]!.html).toBe('بدأت الحكاية هنا.');
  });

  it('keeps text before the first heading as chapter one and numbers the rest from ch02', () => {
    const txt = [
      'كان يا ما كان',
      'في قديم الزمان',
      'الفصل الأول',
      'بدأت الحكاية',
      'الفصل الثاني',
      'وانتهت',
    ].join('\n');

    const book = parseTxt(txt, 'story-sample.txt');
    expect(book.chapters.map((c) => c.id)).toEqual(['ch01', 'ch02', 'ch03']);
    expect(book.chapters[0]!.title).toBe('story-sample');
    expect(book.chapters[0]!.blocks).toHaveLength(2);
    expect(book.chapters[0]!.blocks[0]!.noIndent).toBe(true);
    expect(book.chapters[1]!.title).toBe('الفصل الأول');
    expect(book.chapters[2]!.title).toBe('الفصل الثاني');
  });

  it('treats standalone numbers and English headings as chapters', () => {
    const txt = [
      '1',
      'أول فصل',
      '',
      '2',
      'ثاني فصل',
      '',
      'Chapter 3',
      'ثالث فصل',
    ].join('\n');
    const book = parseTxt(txt, 'numbered.txt');
    expect(book.chapters.map((c) => c.title)).toEqual(['1', '2', 'Chapter 3']);
  });

  it('keeps the historical single-chapter result when no heading is detected', () => {
    const txt = ['سطر أول', '', 'سطر ثانٍ'].join('\n');
    const book = parseTxt(txt, 'plain.txt');
    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0]!.id).toBe('ch01');
    expect(book.chapters[0]!.title).toBe('plain');
    expect(book.chapters[0]!.blocks).toHaveLength(2);
    expect(book.chapters[0]!.blocks[0]!.html).toBe('سطر أول');
    expect(book.chapters[0]!.blocks[1]!.html).toBe('سطر ثانٍ');
  });

  it('does not detect chapter headings when detectChapters is false', () => {
    const txt = ['الفصل الأول', 'نص', 'الفصل الثاني', 'نص آخر'].join('\n');
    const book = parseTxt(txt, 'plain.txt', { detectChapters: false });
    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0]!.blocks).toHaveLength(4);
  });

  it('does not turn a narrative line into a chapter title', () => {
    const txt = ['الفصل ده كان حكاية طويلة', 'ثم انتهى الأمر'].join('\n');
    const book = parseTxt(txt, 'prose.txt');
    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0]!.blocks).toHaveLength(2);
  });

  it('counts words across all detected chapters', () => {
    const txt = ['الفصل الأول', 'واحد اثنان', 'الفصل الثاني', 'ثلاثة'].join('\n');
    const book = parseTxt(txt, 'words.txt');
    expect(book.chapters).toHaveLength(2);
    expect(book.wordCount).toBe(
      book.chapters[0]!.wordCount + book.chapters[1]!.wordCount,
    );
    expect(book.wordCount).toBe(3);
  });
});
