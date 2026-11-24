import { Alert, View } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import * as Linking from 'expo-linking';

import {
  importBookFromUri,
  isBookImportUri,
  resolveBookFileNameFromUri,
} from '@/storage/intent-import';
import type { BookLibraryRecord } from '@/types/reader';
import { useIncomingBookIntent } from '@/utils/use-incoming-book-intent';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('expo-linking', () => ({
  getInitialURL: jest.fn(),
  addEventListener: jest.fn(),
}));

jest.mock('@/storage/bundle', () => ({
  importBookContent: jest.fn(),
}));

const MOCK_RECORD: BookLibraryRecord = {
  id: 'book_intent_1',
  title: 'حكاية من تيليجرام',
  author: 'مؤلف',
  dir: 'rtl',
  coverSeed: 'حكاية من تيليجرام',
  coverColor: null,
  progress: 0,
  lastOpenedAt: 1000,
  addedAt: 1000,
};

function IntentHost() {
  useIncomingBookIntent();
  return <View testID="intent-host" />;
}

describe('intent-import & Android Open With flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Linking.getInitialURL as jest.Mock).mockResolvedValue(null);
    (Linking.addEventListener as jest.Mock).mockReturnValue({ remove: jest.fn() });
  });

  it('recognizes content:// and file:// URIs and resolves filenames safely', () => {
    expect(isBookImportUri('content://org.telegram.messenger.provider/media/story.md')).toBe(true);
    expect(isBookImportUri('file:///storage/emulated/0/Download/novel.txt')).toBe(true);
    expect(isBookImportUri('rewiaty://reader/123')).toBe(false);
    expect(isBookImportUri('https://example.com/a.md')).toBe(false);

    expect(
      resolveBookFileNameFromUri('content://com.android.externalstorage.documents/document/primary%3ADownload%2F%D8%B1%D9%88%D8%A7%D9%8A%D8%A9.md'),
    ).toBe('رواية.md');
    expect(() => resolveBookFileNameFromUri('content://media/external/file/42')).toThrow(
      'صيغة الملف غير مدعومة',
    );
    expect(() => resolveBookFileNameFromUri('file:///tmp/book.pdf')).toThrow(
      'صيغة الملف غير مدعومة',
    );
  });

  it('imports book content from URI using injected file reader and importer', async () => {
    const readFile = jest.fn().mockResolvedValue({
      text: '# الفصل الأول\n\nنص تجريبي للفتح من تطبيق خارجي.',
      name: 'telegram-story.md',
    });
    const importContent = jest.fn().mockResolvedValue(MOCK_RECORD);

    const record = await importBookFromUri(
      'content://org.telegram.messenger.provider/files/1234',
      { readFile, importContent },
    );

    expect(readFile).toHaveBeenCalledWith(
      'content://org.telegram.messenger.provider/files/1234',
    );
    expect(importContent).toHaveBeenCalledWith(
      '# الفصل الأول\n\nنص تجريبي للفتح من تطبيق خارجي.',
      'telegram-story.md',
      undefined,
    );
    expect(record).toEqual(MOCK_RECORD);
  });

  it('imports and navigates immediately on cold-start getInitialURL intent', async () => {
    const { importBookContent } = require('@/storage/bundle') as {
      importBookContent: jest.Mock;
    };
    const intentSpy = jest.spyOn(
      require('@/storage/intent-import') as { importBookFromUri: typeof importBookFromUri },
      'importBookFromUri',
    );
    intentSpy.mockResolvedValueOnce(MOCK_RECORD);
    (Linking.getInitialURL as jest.Mock).mockResolvedValueOnce(
      'content://org.telegram.messenger/doc/story.md',
    );

    await render(<IntentHost />);

    await waitFor(() => {
      expect(intentSpy).toHaveBeenCalledWith('content://org.telegram.messenger/doc/story.md');
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/reader/[id]',
        params: { id: 'book_intent_1' },
      });
    });

    expect(importBookContent).not.toHaveBeenCalled();
    intentSpy.mockRestore();
  });

  it('imports and navigates on warm-start Linking url event and alerts on error', async () => {
    let urlHandler: ((event: { url: string }) => void) | undefined;
    (Linking.addEventListener as jest.Mock).mockImplementationOnce(
      (_event: string, cb: (e: { url: string }) => void) => {
        urlHandler = cb;
        return { remove: jest.fn() };
      },
    );

    const intentModule = require('@/storage/intent-import') as {
      importBookFromUri: typeof importBookFromUri;
    };
    const intentSpy = jest.spyOn(intentModule, 'importBookFromUri');
    intentSpy.mockResolvedValueOnce(MOCK_RECORD);

    await render(<IntentHost />);
    expect(urlHandler).toBeDefined();

    urlHandler?.({ url: 'file:///storage/emulated/0/Download/book.txt' });

    await waitFor(() => {
      expect(intentSpy).toHaveBeenCalledWith('file:///storage/emulated/0/Download/book.txt');
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/reader/[id]',
        params: { id: 'book_intent_1' },
      });
    });

    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    intentSpy.mockRejectedValueOnce(new Error('صيغة الملف غير مدعومة. اختر ملف .md أو .txt.'));
    urlHandler?.({ url: 'file:///storage/emulated/0/Download/bad.pdf' });

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'تعذّر فتح الكتاب',
        'صيغة الملف غير مدعومة. اختر ملف .md أو .txt.',
      );
    });

    alertSpy.mockRestore();
    intentSpy.mockRestore();
  });
});
