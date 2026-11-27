import { describe, expect, it } from 'vitest';
import { deltaReparseBook, deltaReparseTxt, parseBook, parseTxt } from '../src/index.js';
import type { Book, Chapter } from '../src/index.js';

const FRONTMATTER = [
  '---',
  'title: "حَجَرُ الْمَاءِ"',
  'author: "روايتي"',
  'lang: ar',
  'dir: rtl',
  '---',
  '',
];

type ChapterSpec = {
  title: string;
  paragraphs: string[];
};

const ORDINALS = [
  'الْأَوَّلُ',
  'الثَّانِي',
  'الثَّالِثُ',
  'الرَّابِعُ',
  'الْخَامِسُ',
  'السَّادِسُ',
  'السَّابِعُ',
  'الثَّامِنُ',
  'التَّاسِعُ',
  'الْعَاشِرُ',
  'الْحَادِيَ عَشَرَ',
  'الثَّانِيَ عَشَرَ',
  'الثَّالِثَ عَشَرَ',
  'الرَّابِعَ عَشَرَ',
  'الْخَامِسَ عَشَرَ',
  'السَّادِسَ عَشَرَ',
];

function chapterSpec(index: number, body?: string): ChapterSpec {
  const n = index + 1;
  return {
    title: `الْفَصْلُ ${ORDINALS[index] ?? n}`,
    paragraphs: [
      body ??
        `فَقْرَةُ الْفَصْلِ رَقْمِ ${n} تَحْتَوِي عَلَى حِكَايَةٍ مَخْصُوصَةٍ لَا تَتَكَرَّرُ فِي فَصْلٍ آخَرَ.`,
      `الْفَقْرَةُ الثَّانِيَةُ مِنَ الْفَصْلِ ${n} تُكْمِلُ الْحِكَايَةَ وَتَزِيدُهَا وُضُوحًا.`,
    ],
  };
}

function makeChapters(count: number, bodies: Record<number, string> = {}): ChapterSpec[] {
  return Array.from({ length: count }, (_value, index) =>
    chapterSpec(index, bodies[index + 1]),
  );
}

function renderMarkdown(chapters: ChapterSpec[], extraBodyLinesBefore = ''): string {
  const lines = [...FRONTMATTER];
  if (extraBodyLinesBefore) {
    lines.push(extraBodyLinesBefore, '');
  }
  for (const chapter of chapters) {
    lines.push(`# ${chapter.title}`, '');
    for (const paragraph of chapter.paragraphs) {
      lines.push(paragraph, '');
    }
  }
  return lines.join('\n');
}

function stripRawHashes(book: Book): Book {
  return {
    ...book,
    chapters: book.chapters.map((chapter) => {
      const copy: Chapter = { ...chapter };
      delete copy.rawHash;
      return copy;
    }),
  };
}

describe('deltaReparseBook', () => {
  it('re-parses nothing when the text is unchanged and returns the exact full-parse book', () => {
    const text = renderMarkdown(makeChapters(15));
    const previous = parseBook(text, 'sea.md');

    const result = deltaReparseBook(text, 'sea.md', previous);

    expect(result.reparsedCount).toBe(0);
    expect(result.unchangedChapterIds).toHaveLength(15);
    expect(result.changedChapterIds).toEqual([]);
    expect(result.addedChapterIds).toEqual([]);
    expect(result.removedChapterIds).toEqual([]);
    expect(result.footnotesChanged).toBe(false);
    expect(result.book).toEqual(parseBook(text, 'sea.md'));
    // Reused chapters are the very same objects — no markdown pipeline ran for them.
    expect(result.book.chapters[3]).toBe(previous.chapters[3]);
  });

  it('parses only the edited chapter in a 15-chapter book', () => {
    const original = renderMarkdown(makeChapters(15));
    const previous = parseBook(original, 'sea.md');

    const edited = renderMarkdown(
      makeChapters(15, {
        8: 'نَصٌّ جَدِيدٌ تَمَّ تَعْدِيلُهُ فِي الْفَصْلِ الثَّامِنِ وَحْدَهُ.',
      }),
    );
    const result = deltaReparseBook(edited, 'sea.md', previous);

    expect(result.reparsedCount).toBe(1);
    expect(result.unchangedChapterIds).toHaveLength(14);
    expect(result.changedChapterIds).toEqual(['ch08']);
    expect(result.addedChapterIds).toEqual([]);
    expect(result.removedChapterIds).toEqual([]);
    expect(result.book.chapters[7]?.blocks[0]?.html).toContain('تَمَّ تَعْدِيلُهُ');
    expect(result.book).toEqual(parseBook(edited, 'sea.md'));
    // Untouched neighbours are still the reused originals.
    expect(result.book.chapters[0]).toBe(previous.chapters[0]);
    expect(result.book.chapters[14]).toBe(previous.chapters[14]);
  });

  it('handles an appended chapter as a single new parse', () => {
    const previous = parseBook(renderMarkdown(makeChapters(15)), 'sea.md');
    const appended = renderMarkdown(makeChapters(16));
    const result = deltaReparseBook(appended, 'sea.md', previous);

    expect(result.reparsedCount).toBe(1);
    expect(result.addedChapterIds).toEqual(['ch16']);
    expect(result.changedChapterIds).toEqual(['ch16']);
    expect(result.unchangedChapterIds).toHaveLength(15);
    expect(result.removedChapterIds).toEqual([]);
    expect(result.book).toEqual(parseBook(appended, 'sea.md'));
  });

  it('reports removed chapters when the document shrinks', () => {
    const previous = parseBook(renderMarkdown(makeChapters(15)), 'sea.md');
    const shrunk = renderMarkdown(makeChapters(14));
    const result = deltaReparseBook(shrunk, 'sea.md', previous);

    expect(result.reparsedCount).toBe(0);
    expect(result.removedChapterIds).toEqual(['ch15']);
    expect(result.changedChapterIds).toEqual([]);
    expect(result.unchangedChapterIds).toHaveLength(14);
    expect(result.book).toEqual(parseBook(shrunk, 'sea.md'));
  });

  it('remaps a chapter inserted in the middle without re-parsing the shifted chapters', () => {
    const previous = parseBook(renderMarkdown(makeChapters(15)), 'sea.md');
    // A genuinely new chapter at 1-based position 4 pushes every later chapter down one slot.
    const inserted = makeChapters(15);
    inserted.splice(3, 0, {
      title: 'الْفَصْلُ الْمُسْتَحْدَثُ',
      paragraphs: ['فَصْلٌ جَدِيدٌ أُضِيفَ فِي مُنْتَصَفِ الْكِتَابِ.'],
    });

    const result = deltaReparseBook(renderMarkdown(inserted), 'sea.md', previous);

    expect(result.reparsedCount).toBe(1);
    expect(result.addedChapterIds).toEqual(['ch04']);
    expect(result.changedChapterIds).toHaveLength(13);
    expect(result.changedChapterIds).toEqual([
      'ch04',
      'ch05',
      'ch06',
      'ch07',
      'ch08',
      'ch09',
      'ch10',
      'ch11',
      'ch12',
      'ch13',
      'ch14',
      'ch15',
      'ch16',
    ]);
    expect(result.unchangedChapterIds).toEqual(['ch01', 'ch02', 'ch03']);
    expect(result.book).toEqual(parseBook(renderMarkdown(inserted), 'sea.md'));
    // The shifted chapter kept its title but now lives under its new id and block prefix.
    expect(result.book.chapters[4]?.title).toBe(previous.chapters[3]?.title);
    expect(result.book.chapters[4]?.blocks[0]?.id).toBe('ch05_p0001');
  });

  it('reorders chapters by remapping ids only, never by re-parsing', () => {
    const chapters = makeChapters(15);
    const previous = parseBook(renderMarkdown(chapters), 'sea.md');

    const swapped = [...chapters];
    const second = swapped[1]!;
    swapped[1] = swapped[4]!;
    swapped[4] = second;
    const reorderedText = renderMarkdown(swapped);

    const result = deltaReparseBook(reorderedText, 'sea.md', previous);

    expect(result.reparsedCount).toBe(0);
    expect(result.changedChapterIds).toEqual(['ch02', 'ch05']);
    expect(result.unchangedChapterIds).toHaveLength(13);
    expect(result.book).toEqual(parseBook(reorderedText, 'sea.md'));
    expect(result.book.chapters[1]?.title).toBe(chapters[4]?.title);
    expect(result.book.chapters[1]?.blocks.map((block) => block.id)).toEqual([
      'ch02_p0001',
      'ch02_p0002',
    ]);
  });

  it('detects a footnote definition edit without touching any chapter', () => {
    const withFootnote = renderMarkdown(makeChapters(3), '[^n1]: حَاشِيَةٌ أُولَى');
    const editedFootnote = renderMarkdown(makeChapters(3), '[^n1]: حَاشِيَةٌ مُعَدَّلَةٌ');
    const previous = parseBook(withFootnote, 'sea.md');

    const result = deltaReparseBook(editedFootnote, 'sea.md', previous);

    expect(result.footnotesChanged).toBe(true);
    expect(result.reparsedCount).toBe(0);
    expect(result.changedChapterIds).toEqual([]);
    expect(result.book).toEqual(parseBook(editedFootnote, 'sea.md'));
  });

  it('re-parses a chapter that starts referencing a footnote that now exists', () => {
    const paragraphWithRef =
      'فَقْرَةُ الْفَصْلِ الثَّانِي تَحْتَوِي عَلَى إِحَالَةٍ إِلَى حَاشِيَةٍ[^n1] جَدِيدَةٍ.';
    const body = makeChapters(3, { 2: paragraphWithRef });
    const withoutDef = renderMarkdown(body);
    const withDef = renderMarkdown(body, '[^n1]: حَاشِيَةٌ جَدِيدَةٌ');

    const previous = parseBook(withoutDef, 'sea.md');
    // Without the definition the ref stays literal text in the rendered block.
    expect(previous.chapters[1]?.blocks[0]?.html).toContain('[^n1]');

    const result = deltaReparseBook(withDef, 'sea.md', previous);

    expect(result.footnotesChanged).toBe(true);
    expect(result.reparsedCount).toBe(1);
    expect(result.changedChapterIds).toEqual(['ch02']);
    expect(result.addedChapterIds).toEqual([]);
    expect(result.book).toEqual(parseBook(withDef, 'sea.md'));
    expect(result.book.chapters[1]?.blocks[0]?.html).toContain('fn-ref');
  });

  it('falls back to a full re-parse when the previous book has no raw hashes', () => {
    const text = renderMarkdown(makeChapters(15));
    const withoutHashes = stripRawHashes(parseBook(text, 'sea.md'));

    const result = deltaReparseBook(text, 'sea.md', withoutHashes);

    expect(result.reparsedCount).toBe(15);
    expect(result.changedChapterIds).toHaveLength(15);
    expect(result.addedChapterIds).toEqual([]);
    expect(result.book).toEqual(parseBook(text, 'sea.md'));
  });

  it('treats a different cleanArabic option as a content change', () => {
    const text = renderMarkdown(makeChapters(5));
    const uncleaned = parseBook(text, 'sea.md');

    const cleanedUnchanged = deltaReparseBook(text, 'sea.md', uncleaned, { cleanArabic: true });
    expect(cleanedUnchanged.reparsedCount).toBe(5);
    expect(cleanedUnchanged.book).toEqual(parseBook(text, 'sea.md', { cleanArabic: true }));

    const cleanedAgain = deltaReparseBook(
      text,
      'sea.md',
      cleanedUnchanged.book,
      { cleanArabic: true },
    );
    expect(cleanedAgain.reparsedCount).toBe(0);
    expect(cleanedAgain.unchangedChapterIds).toHaveLength(5);
  });

  it('exposes a raw hash per chapter that is stable across parses', () => {
    const text = renderMarkdown(makeChapters(4));
    const first = parseBook(text, 'sea.md');
    const second = parseBook(text, 'sea.md');

    const hashes = first.chapters.map((chapter) => chapter.rawHash);
    expect(hashes.every((hash) => typeof hash === 'string' && /^[0-9a-f]{16}$/.test(hash))).toBe(
      true,
    );
    expect(new Set(hashes).size).toBe(4);
    expect(second.chapters.map((chapter) => chapter.rawHash)).toEqual(hashes);
  });

  it('never reuses a txt chapter for Markdown when the identical text changes format', () => {
    const body = 'سَطْرٌ فِيهِ **بولد** وَ *مَائِل* وَ نَصٌّ عَادِيٌّ.';
    const txt = ['الفصل الأول', '', body, ''].join('\n');

    // Parsed as plain text, `**bold**` is literal: no inline markup may survive the format flip.
    const asTxt = parseTxt(txt, 'novel.txt');
    expect(asTxt.chapters[0]!.blocks[0]!.html).toContain('**بولد**');

    const asMarkdown = deltaReparseBook(txt, 'novel.md', asTxt);

    expect(asMarkdown.reparsedCount).toBe(1);
    expect(asMarkdown.reusedChapterIdMap[asTxt.chapters[0]!.id]).toBeUndefined();
    const markdownHtml = asMarkdown.book.chapters[0]!.blocks.map((block) => block.html).join('\n');
    expect(markdownHtml).toContain('<strong>بولد</strong>');
    expect(markdownHtml).not.toContain('**بولد**');
    expect(asMarkdown.book).toEqual(parseBook(txt, 'novel.md'));
  });

  it('never reuses a Markdown chapter for plain text when the identical text changes format', () => {
    const body = 'سَطْرٌ فِيهِ **بولد** وَ نَصٌّ عَادِيٌّ.';
    const md = ['# الفصل الأول', '', body].join('\n');

    const asMarkdown = parseBook(md, 'novel.md');
    expect(asMarkdown.chapters[0]!.blocks[0]!.html).toContain('<strong>بولد</strong>');

    // `parseTxt` detects the heading too, so the same chapter shape is produced as escaped text.
    const asTxt = deltaReparseTxt(md, 'novel.txt', asMarkdown);

    expect(asTxt.reparsedCount).toBe(1);
    expect(asTxt.reusedChapterIdMap[asMarkdown.chapters[0]!.id]).toBeUndefined();
    const plainHtml = asTxt.book.chapters[0]!.blocks.map((block) => block.html).join('\n');
    expect(plainHtml).toContain('**بولد**');
    expect(plainHtml).not.toContain('<strong>');
    expect(asTxt.book).toEqual(parseTxt(md, 'novel.txt'));
  });

  it('reports old->new ids for every reused chapter', () => {
    const previous = parseBook(renderMarkdown(makeChapters(3)), 'sea.md');
    const result = deltaReparseBook(renderMarkdown(makeChapters(3)), 'sea.md', previous);

    expect(result.reusedChapterIdMap).toEqual({ ch01: 'ch01', ch02: 'ch02', ch03: 'ch03' });
  });
});

describe('deltaReparseTxt', () => {
  function renderTxt(count: number, bodies: Record<number, string> = {}): string {
    const lines: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const n = i + 1;
      lines.push(`الفصل ${ORDINALS[i] ?? n}`, '', bodies[n] ?? `سطر الفصل ${n} الأول.`, '');
    }
    return lines.join('\n');
  }

  it('parses only the edited chapter of a txt book', () => {
    const original = renderTxt(15);
    const previous = parseTxt(original, 'novel.txt');

    expect(previous.chapters).toHaveLength(15);

    const edited = renderTxt(15, { 6: 'سطر جديد تمامًا في الفصل السادس.' });
    const result = deltaReparseTxt(edited, 'novel.txt', previous);

    expect(result.reparsedCount).toBe(1);
    expect(result.changedChapterIds).toEqual(['ch06']);
    expect(result.unchangedChapterIds).toHaveLength(14);
    expect(result.book).toEqual(parseTxt(edited, 'novel.txt'));
  });

  it('does no work when the txt book is unchanged', () => {
    const text = renderTxt(4);
    const previous = parseTxt(text, 'novel.txt');
    const result = deltaReparseTxt(text, 'novel.txt', previous);

    expect(result.reparsedCount).toBe(0);
    expect(result.changedChapterIds).toEqual([]);
    expect(result.book).toEqual(parseTxt(text, 'novel.txt'));
  });
});
