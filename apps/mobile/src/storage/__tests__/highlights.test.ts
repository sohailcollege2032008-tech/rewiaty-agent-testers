import { Share } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { Book } from '@rewiaty/book-format';

import {
  addHighlight,
  exportHighlightsToMarkdown,
  extractHighlightContext,
  normalizeHighlightItems,
  removeHighlightById,
  resolveHighlightRange,
  resolveHighlightsForBook,
  shareHighlightsMarkdown,
  sortHighlightsNewestFirst,
  updateHighlightColor,
  updateHighlightNote,
} from '@/storage/highlights';
import type { HighlightItem } from '@/types/reader';

function makeBook(): Book {
  return {
    id: 'book_hl_1',
    meta: { title: 'حَجَرُ الْمَاءِ', author: 'روايتي', lang: 'ar', dir: 'rtl' },
    chapters: [
      {
        id: 'ch01',
        title: 'الفصل الأول: المفتاح',
        wordCount: 50,
        hash: 'h1',
        blocks: [
          {
            id: 'ch01_p0001',
            kind: 'p',
            html: 'كَانَتْ نُورُ تَعْرِفُ الْبَحْرَ قَبْلَ أَنْ تَعْرِفَ اسْمَهُ.',
          },
          {
            id: 'ch01_p0002',
            kind: 'p',
            html: 'وَقَفَ سَلِيمٌ عِنْدَ الْمِينَاءِ، وَكَانَ الْبَحْرُ هَادِئًا جِدًّا، ثُمَّ سَمِعَ صَوْتَ الْمَوْجِ وَكَانَ الْبَحْرُ يَهْمِسُ بِأَسْرَارِ الْقَرْيَةِ.',
          },
        ],
      },
      {
        id: 'ch02',
        title: 'الفصل الثاني: المنارة',
        wordCount: 30,
        hash: 'h2',
        blocks: [
          {
            id: 'ch02_p0001',
            kind: 'p',
            html: 'صَعِدَ الدَّرَجَ الْحَلَزُونِيَّ نَحْوَ الضَّوْءِ الْبَعِيدِ.',
          },
        ],
      },
    ],
    footnotes: {},
    wordCount: 80,
  };
}

function makeHighlight(overrides: Partial<HighlightItem> = {}): HighlightItem {
  const full = 'وَقَفَ سَلِيمٌ عِنْدَ الْمِينَاءِ، وَكَانَ الْبَحْرُ هَادِئًا جِدًّا، ثُمَّ سَمِعَ صَوْتَ الْمَوْجِ وَكَانَ الْبَحْرُ يَهْمِسُ بِأَسْرَارِ الْقَرْيَةِ.';
  const quote = 'الْبَحْرُ';
  const secondIdx = full.lastIndexOf(quote);
  return {
    id: 'hl_1',
    anchor: { blockId: 'ch01_p0002', charOffset: secondIdx },
    length: quote.length,
    color: 'gold',
    quote,
    contextBefore: full.slice(Math.max(0, secondIdx - 20), secondIdx),
    contextAfter: full.slice(secondIdx + quote.length, secondIdx + quote.length + 20),
    chapterId: 'ch01',
    chapterTitle: 'الفصل الأول: المفتاح',
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

describe('highlights: context extraction and fuzzy anchoring', () => {
  it('extracts exact quote plus 20 chars before and after while preserving Tashkeel', () => {
    const book = makeBook();
    const text = book.chapters[0]!.blocks[0]!.html;
    const target = 'تَعْرِفُ الْبَحْرَ';
    const start = text.indexOf(target);

    const ctx = extractHighlightContext(book, { blockId: 'ch01_p0001', charOffset: start }, target.length);
    expect(ctx.chapterId).toBe('ch01');
    expect(ctx.chapterTitle).toBe('الفصل الأول: المفتاح');
    expect(ctx.quote).toBe(target);
    expect(ctx.length).toBe(target.length);
    expect(ctx.contextBefore.length).toBeLessThanOrEqual(20);
    expect(ctx.contextAfter.length).toBeLessThanOrEqual(20);
    expect(ctx.contextBefore).toBe(text.slice(Math.max(0, start - 20), start));
    expect(ctx.contextAfter).toBe(text.slice(start + target.length, start + target.length + 20));
  });

  it('returns the stored anchor and length when the file is unchanged', () => {
    const book = makeBook();
    const item = makeHighlight();
    expect(resolveHighlightRange(book, item)).toEqual({
      anchor: item.anchor,
      length: item.length,
    });
  });

  it('disambiguates repeated words inside the same block using 20-char context after shift', () => {
    const book = makeBook();
    const originalBlock = book.chapters[0]!.blocks[1]!.html;
    const prefix = 'مُقَدِّمَةٌ إِضَافِيَّةٌ طَوِيلَةٌ. ';
    const edited: Book = {
      ...book,
      chapters: [
        {
          ...book.chapters[0]!,
          blocks: [
            book.chapters[0]!.blocks[0]!,
            { id: 'ch01_p0002', kind: 'p', html: prefix + originalBlock },
          ],
        },
        book.chapters[1]!,
      ],
    };

    const item = makeHighlight();
    const resolved = resolveHighlightRange(edited, item);
    const expectedOffset = prefix.length + originalBlock.lastIndexOf('الْبَحْرُ');
    expect(resolved.anchor).toEqual({ blockId: 'ch01_p0002', charOffset: expectedOffset });
    expect(resolved.length).toBe('الْبَحْرُ'.length);
  });

  it('re-anchors across renumbered blocks and stripped/changed Tashkeel while updating length', () => {
    const item = makeHighlight({
      quote: 'عِنْدَ الْمِينَاءِ، وَكَانَ الْبَحْرُ هَادِئًا',
      contextBefore: 'وَقَفَ سَلِيمٌ ',
      contextAfter: ' جِدًّا، ثُمَّ سَمِعَ',
    });

    const editedBook: Book = {
      id: 'book_hl_edited',
      meta: { title: 'نسخة معدلة', lang: 'ar', dir: 'rtl' },
      chapters: [
        {
          id: 'ch01',
          title: 'الفصل الأول: المفتاح',
          wordCount: 40,
          hash: 'h1-edited',
          blocks: [
            { id: 'ch01_p0001', kind: 'p', html: 'فقرة جديدة أضيفت في البداية.' },
            { id: 'ch01_p0002', kind: 'p', html: 'فقرة ثانية قبل الحدث.' },
            {
              id: 'ch01_p0003',
              kind: 'p',
              html: 'في الصباح وقف سليم عند الميناء، وكان البحر هادئا جدا، ثم سمع صوت الموج.',
            },
          ],
        },
      ],
      footnotes: {},
      wordCount: 40,
    };

    const resolved = resolveHighlightRange(editedBook, item);
    const targetText = editedBook.chapters[0]!.blocks[2]!.html;
    const expectedSub = 'عند الميناء، وكان البحر هادئا';
    expect(resolved.anchor).toEqual({
      blockId: 'ch01_p0003',
      charOffset: targetText.indexOf(expectedSub),
    });
    expect(resolved.length).toBe(expectedSub.length);
  });

  it('keeps trailing Tashkeel on the last letter when re-anchoring stripped quote onto vocalized text', () => {
    const editedWithTashkeel: Book = {
      id: 'book_tashkeel',
      meta: { title: 'مشكول', lang: 'ar', dir: 'rtl' },
      chapters: [
        {
          id: 'ch01',
          title: 'فصل',
          wordCount: 10,
          hash: 'h',
          blocks: [{ id: 'ch01_p0001', kind: 'p', html: 'أَشْرَقَتِ الشَّمْسُ عَلَى الْمَدِينَةِ.' }],
        },
      ],
      footnotes: {},
      wordCount: 10,
    };
    const item = makeHighlight({
      anchor: { blockId: 'ch99_p0001', charOffset: 0 },
      quote: 'اشرقت الشمس',
      length: 'اشرقت الشمس'.length,
      contextBefore: '',
      contextAfter: ' على المدينة',
    });

    const resolved = resolveHighlightRange(editedWithTashkeel, item);
    expect(resolved.anchor).toEqual({ blockId: 'ch01_p0001', charOffset: 0 });
    expect(
      editedWithTashkeel.chapters[0]!.blocks[0]!.html.slice(
        resolved.anchor.charOffset,
        resolved.anchor.charOffset + resolved.length,
      ),
    ).toBe('أَشْرَقَتِ الشَّمْسُ');
  });

  it('re-anchors via 20-char surrounding context even when a word inside the quote was edited', () => {
    const editedBook: Book = {
      id: 'book_inner_edit',
      meta: { title: 'تعديل داخلي', lang: 'ar', dir: 'rtl' },
      chapters: [
        {
          id: 'ch01',
          title: 'فصل',
          wordCount: 20,
          hash: 'h',
          blocks: [
            {
              id: 'ch01_p0005',
              kind: 'p',
              html: 'في الصباح الباكر، جلس الصياد العجوز بصمت فوق الصخرة المبللة ينظر للأفق البعيد.',
            },
          ],
        },
      ],
      footnotes: {},
      wordCount: 20,
    };

    const item = makeHighlight({
      anchor: { blockId: 'ch01_p0001', charOffset: 10 },
      quote: 'جلس الصياد المسن بصمت',
      length: 'جلس الصياد المسن بصمت'.length,
      contextBefore: 'في الصباح الباكر، ',
      contextAfter: ' فوق الصخرة المبللة',
    });

    const resolved = resolveHighlightRange(editedBook, item);
    const plain = editedBook.chapters[0]!.blocks[0]!.html;
    expect(resolved.anchor.blockId).toBe('ch01_p0005');
    expect(plain.slice(resolved.anchor.charOffset, resolved.anchor.charOffset + resolved.length)).toBe(
      'جلس الصياد العجوز بصمت',
    );
  });

  it('never matches by page number and safely skips deleted blocks in resolveHighlightsForBook', () => {
    const book = makeBook();
    const valid = makeHighlight({ id: 'ok' });
    const deleted = makeHighlight({
      id: 'gone',
      anchor: { blockId: 'ch09_p0001', charOffset: 0 },
      quote: 'جملة حُذفت بالكامل من الرواية',
      contextBefore: 'سياق محذوف',
      contextAfter: 'سياق آخر محذوف',
    });

    expect(resolveHighlightRange(book, deleted).anchor).toEqual({
      blockId: 'ch09_p0001',
      charOffset: 0,
    });
    const resolved = resolveHighlightsForBook(book, [valid, deleted]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.id).toBe('ok');
  });
});

describe('highlights: CRUD, normalization, and Markdown export/share', () => {
  it('normalizes valid highlights, drops malformed ones, and fills missing metadata', () => {
    const book = makeBook();
    const items = normalizeHighlightItems(
      [
        {
          id: 'h1',
          anchor: { blockId: 'ch02_p0001', charOffset: 0 },
          length: 13,
          color: 'unknown-color',
          note: '  ملاحظة مهمة  ',
          createdAt: 500,
        },
        { id: 'h1', anchor: { blockId: 'ch02_p0001', charOffset: 0 }, length: 5 }, // duplicate
        { id: 'bad', anchor: { blockId: '', charOffset: 0 }, length: 5 },
        { id: 'bad2', anchor: { blockId: 'ch01_p0001', charOffset: 0 }, length: 0 },
      ],
      book,
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'h1',
      color: 'gold',
      chapterId: 'ch02',
      chapterTitle: 'الفصل الثاني: المنارة',
      quote: 'صَعِدَ الدَّر',
      note: 'ملاحظة مهمة',
    });
  });

  it('adds, updates color/note, removes, and sorts newest first', () => {
    const { items: after1, created: c1 } = addHighlight([], {
      anchor: { blockId: 'ch01_p0001', charOffset: 0 },
      length: 6,
      color: 'sage',
      quote: 'كَانَتْ',
      contextBefore: '',
      contextAfter: ' نُورُ',
      chapterId: 'ch01',
      chapterTitle: 'الفصل الأول',
      now: 1000,
    });
    const { items: after2, created: c2 } = addHighlight(after1, {
      anchor: { blockId: 'ch02_p0001', charOffset: 0 },
      length: 5,
      color: 'sky',
      quote: 'صَعِدَ',
      contextBefore: '',
      contextAfter: ' الدَّرَجَ',
      chapterId: 'ch02',
      chapterTitle: 'الفصل الثاني',
      note: 'بداية المشهد',
      now: 2000,
    });

    const recolored = updateHighlightColor(after2, c1.id, 'rose', 2500);
    expect(recolored.find((h) => h.id === c1.id)?.color).toBe('rose');

    const noted = updateHighlightNote(recolored, c1.id, 'تعديل الملاحظة', 3000);
    expect(noted.find((h) => h.id === c1.id)?.note).toBe('تعديل الملاحظة');

    const clearedNote = updateHighlightNote(noted, c2.id, '   ', 3500);
    expect(clearedNote.find((h) => h.id === c2.id)?.note).toBeUndefined();

    expect(sortHighlightsNewestFirst(clearedNote).map((h) => h.id)).toEqual([c2.id, c1.id]);
    expect(removeHighlightById(clearedNote, c1.id).map((h) => h.id)).toEqual([c2.id]);
  });

  it('exports Markdown ordered by book chapters and block positions (not creation order)', () => {
    const book = makeBook();
    const ch2Highlight = makeHighlight({
      id: 'h_ch2',
      anchor: { blockId: 'ch02_p0001', charOffset: 0 },
      length: 23,
      chapterId: 'ch02',
      chapterTitle: 'الفصل الثاني: المنارة',
      quote: 'صَعِدَ الدَّرَجَ الْحَلَزُونِيَّ',
      note: 'لحظة الصعود',
      createdAt: 100, // older timestamp, later chapter
    });
    const ch1SecondBlock = makeHighlight({
      id: 'h_ch1_b2',
      anchor: { blockId: 'ch01_p0002', charOffset: 0 },
      length: 12,
      chapterId: 'ch01',
      chapterTitle: 'الفصل الأول: المفتاح',
      quote: 'وَقَفَ سَلِيمٌ',
      createdAt: 300,
    });
    const ch1FirstBlock = makeHighlight({
      id: 'h_ch1_b1',
      anchor: { blockId: 'ch01_p0001', charOffset: 0 },
      length: 11,
      chapterId: 'ch01',
      chapterTitle: 'الفصل الأول: المفتاح',
      quote: 'كَانَتْ نُورُ',
      note: 'تقديم الشخصية',
      createdAt: 500, // newest timestamp, first paragraph
    });

    const md = exportHighlightsToMarkdown(book, [ch2Highlight, ch1SecondBlock, ch1FirstBlock]);
    expect(md).toContain('# اقتباسات وملاحظات: حَجَرُ الْمَاءِ');
    expect(md).toContain('_المؤلف: روايتي_');

    const ch1Pos = md.indexOf('## الفصل الأول: المفتاح');
    const q1Pos = md.indexOf('> كَانَتْ نُورُ');
    const note1Pos = md.indexOf('- **ملاحظة:** تقديم الشخصية');
    const q2Pos = md.indexOf('> وَقَفَ سَلِيمٌ');
    const ch2Pos = md.indexOf('## الفصل الثاني: المنارة');
    const q3Pos = md.indexOf('> صَعِدَ الدَّرَجَ الْحَلَزُونِيَّ');

    expect(ch1Pos).toBeGreaterThan(-1);
    expect(ch1Pos).toBeLessThan(q1Pos);
    expect(q1Pos).toBeLessThan(note1Pos);
    expect(note1Pos).toBeLessThan(q2Pos);
    expect(q2Pos).toBeLessThan(ch2Pos);
    expect(ch2Pos).toBeLessThan(q3Pos);
  });

  it('writes the .md export file and sends it through the share sheet', async () => {
    const book = makeBook();
    const item = makeHighlight({ note: 'للتجربة' });

    const exportsDir = new Directory(Paths.cache, 'exports');
    if (exportsDir.exists) exportsDir.delete();

    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValueOnce(true);
    const res = await shareHighlightsMarkdown(book, [item]);

    expect(res.fileUri.endsWith('-highlights.md')).toBe(true);
    const written = await new File(res.fileUri).text();
    expect(written).toBe(res.markdown);
    expect(Sharing.shareAsync).toHaveBeenCalledWith(
      res.fileUri,
      expect.objectContaining({ mimeType: 'text/markdown' }),
    );

    // Fallback to RN Share when Sharing is unavailable
    const shareSpy = jest
      .spyOn(Share, 'share')
      .mockResolvedValueOnce({ action: 'sharedAction', activityType: undefined });
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValueOnce(false);
    await shareHighlightsMarkdown(book, [item]);
    expect(shareSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: res.markdown, url: res.fileUri }),
    );
    shareSpy.mockRestore();
  });
});
