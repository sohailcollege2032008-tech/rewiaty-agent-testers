import { fireEvent, render } from '@testing-library/react-native';

import { TocModal } from '@/components/toc-modal';
import { getAppThemeTokens } from '@/theme/reader-theme';
import type { BookmarkItem, TocEntry } from '@/types/reader';
import type { Book, Chapter } from '@rewiaty/book-format';
import type { ReadingSnapshot, ReadingStats } from '@/storage/reading-stats';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const CHAPTERS: TocEntry[] = [
  { id: 'ch01', title: 'الفصل الأول', startPage: 1, pageCount: 3, wordCount: 120, estimated: false },
  { id: 'ch02', title: 'الفصل الثاني', startPage: 4, pageCount: 2, wordCount: 120, estimated: false },
];

function makeChapter(id: string, title: string, html: string): Chapter {
  return {
    id,
    title,
    hash: `${id}-hash`,
    wordCount: 120,
    blocks: [{ id: `${id}_p001`, kind: 'p', html }],
  };
}

const BOOK: Book = {
  id: 'book_1',
  meta: { title: 'رواية الاختبار', lang: 'ar', dir: 'rtl' },
  wordCount: 240,
  footnotes: {},
  chapters: [
    makeChapter('ch01', 'الفصل الأول', 'بدأ الحكي من هنا وتابع السرد حتى النهاية.'),
    makeChapter('ch02', 'الفصل الثاني', 'في الفصل الثاني تغيّرت الأحداث تماماً.'),
  ],
};

const BOOKMARKS: BookmarkItem[] = [
  {
    id: 'older',
    anchor: { blockId: 'ch01_p001', charOffset: 0 },
    chapterId: 'ch01',
    chapterTitle: 'الفصل الأول',
    quote: 'بدأ الحكي من هنا',
    contextBefore: '',
    contextAfter: 'وتابع السرد',
    page: 2,
    createdAt: 1_000,
  },
  {
    id: 'newer',
    anchor: { blockId: 'ch02_p001', charOffset: 0 },
    chapterId: 'ch02',
    chapterTitle: 'الفصل الثاني',
    quote: 'في الفصل الثاني',
    contextBefore: '',
    contextAfter: 'تغيّرت الأحداث',
    createdAt: 5_000,
  },
];

/** 2026-03-11 at noon, local time — the calendar/streak maths below is relative to it. */
const NOW = new Date(2026, 2, 11, 12, 0, 0).getTime();

const STATS: ReadingStats = {
  version: 1,
  effectiveWpm: 200,
  days: {
    '2026-03-05': { dateKey: '2026-03-05', activeMs: 5 * 60_000, words: 900 },
    '2026-03-06': { dateKey: '2026-03-06', activeMs: 6 * 60_000, words: 1_100 },
    '2026-03-07': { dateKey: '2026-03-07', activeMs: 7 * 60_000, words: 1_300 },
    '2026-03-09': { dateKey: '2026-03-09', activeMs: 12 * 60_000, words: 2400 },
    '2026-03-10': { dateKey: '2026-03-10', activeMs: 8 * 60_000, words: 1600 },
  },
};

const SNAPSHOT: ReadingSnapshot = {
  effectiveWpm: 200,
  activeMs: 4 * 60_000,
  wordsRead: 800,
  chapterRemainingMinutes: 12,
  bookRemainingMinutes: 80,
  estimatedFinishDate: new Date(2026, 2, 12, 0, 0, 0).getTime(),
};

async function renderToc(overrides: Partial<React.ComponentProps<typeof TocModal>> = {}) {
  const props = {
    visible: true,
    chapters: CHAPTERS,
    activeChapterId: 'ch01',
    dir: 'rtl' as const,
    theme: 'warraq' as const,
    onSelectChapter: jest.fn(),
    onClose: jest.fn(),
    bookmarks: BOOKMARKS,
    book: BOOK,
    onOpenBookmark: jest.fn(),
    onDeleteBookmark: jest.fn(),
    readingStats: STATS,
    readingSnapshot: SNAPSHOT,
    now: NOW,
    ...overrides,
  };
  const utils = await render(<TocModal {...props} />);
  return { ...utils, props };
}

describe('TocModal tabs', () => {
  it('opens on the chapters tab and keeps the old chapter items working', async () => {
    const { getByTestId, queryByTestId, props } = await renderToc();

    expect(getByTestId('toc-tab-chapters')).toBeSelected();

    await fireEvent.press(getByTestId('toc-item-ch02'));
    expect(props.onSelectChapter).toHaveBeenCalledWith('ch02');
    expect(props.onClose).toHaveBeenCalled();

    // The bookmarks list is behind its own tab.
    expect(queryByTestId('toc-bookmark-newer')).toBeNull();
  });

  it('lists bookmarks newest first with the quote and page', async () => {
    const { getByTestId, getAllByText } = await renderToc();

    await fireEvent.press(getByTestId('toc-tab-bookmarks'));

    expect(getByTestId('toc-tab-bookmarks')).toBeSelected();
    expect(getByTestId('toc-bookmark-newer')).toBeTruthy();
    expect(getByTestId('toc-bookmark-older')).toBeTruthy();
    expect(getAllByText('«في الفصل الثاني»')).toHaveLength(1);
    expect(getAllByText('«بدأ الحكي من هنا»')).toHaveLength(1);
    expect(getAllByText('صفحة ٢')).toHaveLength(1);
  });

  it('shows the empty state when nothing is bookmarked', async () => {
    const { getByTestId, getByText } = await renderToc({ bookmarks: [] });

    await fireEvent.press(getByTestId('toc-tab-bookmarks'));

    expect(getByText('لا توجد علامات مرجعية بعد. المس الشريطة لحفظ موضعك.')).toBeTruthy();
  });

  it('re-resolves the anchor before jumping and closes the drawer', async () => {
    const { getByTestId, props } = await renderToc();

    await fireEvent.press(getByTestId('toc-tab-bookmarks'));
    await fireEvent.press(getByTestId('toc-bookmark-older'));

    const bookmark = BOOKMARKS.find((item) => item.id === 'older');
    expect(props.onOpenBookmark).toHaveBeenCalledWith(bookmark, {
      blockId: 'ch01_p001',
      charOffset: 0,
    });
    expect(props.onClose).toHaveBeenCalled();
  });

  it('falls back to the stored anchor when the book cannot resolve the quote', async () => {
    const { getByTestId, props } = await renderToc({ book: null });

    await fireEvent.press(getByTestId('toc-tab-bookmarks'));
    await fireEvent.press(getByTestId('toc-bookmark-newer'));

    const bookmark = BOOKMARKS.find((item) => item.id === 'newer');
    expect(props.onOpenBookmark).toHaveBeenCalledWith(bookmark, bookmark?.anchor);
  });

  it('deletes a bookmark from its row without opening it', async () => {
    const { getByTestId, props } = await renderToc();

    await fireEvent.press(getByTestId('toc-tab-bookmarks'));
    await fireEvent.press(getByTestId('bookmark-delete-older'));

    expect(props.onDeleteBookmark).toHaveBeenCalledWith('older');
    expect(props.onOpenBookmark).not.toHaveBeenCalled();
  });

  it('shows reading stats on the stats tab', async () => {
    const { getByTestId, getByText, queryByTestId } = await renderToc();

    await fireEvent.press(getByTestId('toc-tab-stats'));

    expect(getByTestId('toc-tab-stats')).toBeSelected();
    expect(getByTestId('reading-stats-panel')).toBeTruthy();
    expect(getByTestId('stats-wpm')).toHaveTextContent('٢٠٠ كلمة/دقيقة');
    expect(getByTestId('stats-chapter-remaining')).toHaveTextContent('١٢ دقيقة');
    expect(getByTestId('stats-book-remaining')).toHaveTextContent('ساعة و٢٠ دقيقة');
    expect(getByTestId('stats-finish-date')).toHaveTextContent('غداً');
    expect(getByTestId('stats-streak-current')).toHaveTextContent('يومان');
    expect(getByTestId('stats-streak-longest')).toHaveTextContent('٣ أيام');
    expect(getByText('مارس ٢٠٢٦')).toBeTruthy();
    expect(queryByTestId('stats-day-2026-03-10')).toBeTruthy();
  });

  it('paints reading days in the accent colour and leaves unread days transparent', async () => {
    const { getByTestId } = await renderToc();
    const palette = getAppThemeTokens('warraq');

    await fireEvent.press(getByTestId('toc-tab-stats'));

    expect(getByTestId('stats-day-2026-03-10')).toHaveStyle({
      backgroundColor: palette.accent,
    });
    expect(getByTestId('stats-day-2026-03-11')).toHaveStyle({
      backgroundColor: 'transparent',
    });
  });

  it('renders empty stats safely when no data was passed', async () => {
    const { getByTestId } = await renderToc({ readingStats: null, readingSnapshot: null });

    await fireEvent.press(getByTestId('toc-tab-stats'));

    expect(getByTestId('stats-wpm')).toHaveTextContent('١٨٠ كلمة/دقيقة');
    expect(getByTestId('stats-streak-current')).toHaveTextContent('لا توجد بعد');
    expect(getByTestId('stats-finish-date')).toHaveTextContent('غير معروف');
  });
});
