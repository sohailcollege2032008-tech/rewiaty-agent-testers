import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { HighlightToolbar } from '@/components/highlight-toolbar';
import { TocModal } from '@/components/toc-modal';
import type { HighlightItem, TocEntry } from '@/types/reader';
import type { Book, Chapter } from '@rewiaty/book-format';

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
    makeChapter('ch01', 'الفصل الأول', 'بَدَأَ الْحَكْيُ مِنْ هُنَا وَتَابَعَ السَّرْدَ حَتَّى النِّهَايَةِ.'),
    makeChapter('ch02', 'الفصل الثاني', 'فِي الْفَصْلِ الثَّانِي تَغَيَّرَتِ الْأَحْدَاثُ تَمَامًا.'),
  ],
};

const HIGHLIGHTS: HighlightItem[] = [
  {
    id: 'hl_old',
    anchor: { blockId: 'ch01_p001', charOffset: 0 },
    length: 14,
    color: 'gold',
    quote: 'بَدَأَ الْحَكْيُ',
    contextBefore: '',
    contextAfter: ' مِنْ هُنَا',
    chapterId: 'ch01',
    chapterTitle: 'الفصل الأول',
    note: 'ملاحظة أولى',
    createdAt: 1000,
    updatedAt: 1000,
  },
  {
    id: 'hl_new',
    anchor: { blockId: 'ch02_p001', charOffset: 0 },
    length: 15,
    color: 'sage',
    quote: 'فِي الْفَصْلِ الثَّانِي',
    contextBefore: '',
    contextAfter: ' تَغَيَّرَتِ',
    chapterId: 'ch02',
    chapterTitle: 'الفصل الثاني',
    createdAt: 5000,
    updatedAt: 5000,
  },
];

async function renderTocWithHighlights(overrides: Partial<React.ComponentProps<typeof TocModal>> = {}) {
  const props = {
    visible: true,
    chapters: CHAPTERS,
    activeChapterId: 'ch01',
    dir: 'rtl' as const,
    theme: 'warraq' as const,
    onSelectChapter: jest.fn(),
    onClose: jest.fn(),
    book: BOOK,
    highlights: HIGHLIGHTS,
    onOpenHighlight: jest.fn(),
    onDeleteHighlight: jest.fn(),
    onUpdateHighlightNote: jest.fn(),
    onExportHighlights: jest.fn(),
    ...overrides,
  };
  const utils = await render(<TocModal {...props} />);
  return { ...utils, props };
}

describe('TocModal highlights tab', () => {
  it('renders the Quotes tab next to Bookmarks and lists highlights newest first with notes', async () => {
    const { getByTestId, getByText } = await renderTocWithHighlights();

    await fireEvent.press(getByTestId('toc-tab-highlights'));

    expect(getByTestId('toc-tab-highlights')).toBeSelected();
    expect(getByTestId('toc-highlight-hl_new')).toBeTruthy();
    expect(getByTestId('toc-highlight-hl_old')).toBeTruthy();
    expect(getByText('«فِي الْفَصْلِ الثَّانِي»')).toBeTruthy();
    expect(getByText('«بَدَأَ الْحَكْيُ»')).toBeTruthy();
    expect(getByTestId('toc-highlight-note-hl_old')).toHaveTextContent('ملاحظة: ملاحظة أولى');
  });

  it('shows empty state when there are no highlights', async () => {
    const { getByTestId, queryByTestId } = await renderTocWithHighlights({ highlights: [] });

    await fireEvent.press(getByTestId('toc-tab-highlights'));

    expect(getByTestId('highlights-empty')).toBeTruthy();
    expect(queryByTestId('highlights-export-button')).toBeNull();
  });

  it('navigates to the re-anchored highlight position and closes drawer on press', async () => {
    const { getByTestId, props } = await renderTocWithHighlights();

    await fireEvent.press(getByTestId('toc-tab-highlights'));
    await fireEvent.press(getByTestId('toc-highlight-hl_old'));

    expect(props.onOpenHighlight).toHaveBeenCalledWith(
      HIGHLIGHTS[0],
      { blockId: 'ch01_p001', charOffset: 0 },
    );
    expect(props.onClose).toHaveBeenCalled();
  });

  it('edits a highlight note from the Quotes tab', async () => {
    const { getByTestId, props } = await renderTocWithHighlights();

    await fireEvent.press(getByTestId('toc-tab-highlights'));
    await fireEvent.press(getByTestId('highlight-edit-note-hl_old'));

    expect(getByTestId('highlight-note-modal')).toBeTruthy();
    await fireEvent.changeText(getByTestId('highlight-note-input'), 'ملاحظة محدّثة');
    await fireEvent.press(getByTestId('highlight-note-save'));

    expect(props.onUpdateHighlightNote).toHaveBeenCalledWith('hl_old', 'ملاحظة محدّثة');
  });

  it('deletes a highlight without triggering navigation', async () => {
    const { getByTestId, props } = await renderTocWithHighlights();

    await fireEvent.press(getByTestId('toc-tab-highlights'));
    await fireEvent.press(getByTestId('highlight-delete-hl_old'));

    expect(props.onDeleteHighlight).toHaveBeenCalledWith('hl_old');
    expect(props.onOpenHighlight).not.toHaveBeenCalled();
  });

  it('triggers Markdown export from the export button', async () => {
    const { getByTestId, props } = await renderTocWithHighlights();

    await fireEvent.press(getByTestId('toc-tab-highlights'));
    await fireEvent.press(getByTestId('highlights-export-button'));

    expect(props.onExportHighlights).toHaveBeenCalledTimes(1);
  });
});

describe('HighlightToolbar RTL physical coordinate isolation', () => {
  it('wraps toolbar inside a direction:ltr container and keeps physical left coordinates', async () => {
    const { getByTestId } = await render(
      <HighlightToolbar
        visible
        rect={{ left: 260, top: 240, right: 340, bottom: 270, width: 80, height: 30 }}
        containerWidth={400}
        containerHeight={800}
        topInset={24}
        bottomInset={20}
        webviewOffsetTop={0}
        theme="warraq"
        onSelectColor={jest.fn()}
        onPressNote={jest.fn()}
      />,
    );

    const containerStyle = StyleSheet.flatten(getByTestId('highlight-toolbar-container').props.style);
    const toolbarStyle = StyleSheet.flatten(getByTestId('highlight-toolbar').props.style);

    expect(containerStyle.direction).toBe('ltr');
    expect(toolbarStyle.direction).toBeUndefined();
    // Before `onLayout`, centerX = 300 with the estimated width (320):
    // left = min(400 - 320 - 12 = 68, 300 - 160 = 140) = 68. The measured width takes over
    // on the next frame (Issue #59), still clamped to the same 12dp gutter.
    expect(toolbarStyle.left).toBe(68);
  });
});
