import { Directory, Paths } from 'expo-file-system';

import {
  importBookContent,
  readBookBundle,
  saveBookReaderState,
} from '@/storage/bundle';
import { initDatabase, type DatabaseAdapter } from '@/storage/database';
import type { BookLibraryRecord, BookReaderState } from '@/types/reader';

/**
 * F46 regression (Codex #64 P1): `readBookBundle` rebuilt the state field by field and
 * dropped `scenes`, so a reopened book lost every saved scene placeholder (edited prompt,
 * collapsed flag, queued status). These tests go through the real disk bundle — save then
 * close then reopen — instead of mocking the parser.
 */

function createInMemoryDb(): DatabaseAdapter {
  const books = new Map<string, BookLibraryRecord>();
  const kv = new Map<string, string>();

  return {
    async execAsync() {
      // Schema creation/migrations handled declaratively in memory
    },
    async runAsync(source: string, ...params: unknown[]) {
      const sql = source.replace(/\s+/g, ' ').trim();
      if (sql.startsWith('INSERT INTO books')) {
        const [id, title, author, dir, coverSeed, coverColor, progress, lastOpenedAt, addedAt] =
          params as [
            string,
            string,
            string | null,
            'rtl' | 'ltr',
            string,
            string | null,
            number,
            number,
            number,
          ];
        books.set(id, {
          id,
          title,
          author,
          dir,
          coverSeed,
          coverColor,
          progress,
          lastOpenedAt,
          addedAt,
        });
        return { changes: 1 };
      }
      if (sql.startsWith('UPDATE books SET title =')) {
        const [title, author, dir, coverSeed, coverColor, lastOpenedAt, id] = params as [
          string,
          string | null,
          'rtl' | 'ltr',
          string,
          string | null,
          number,
          string,
        ];
        const existing = books.get(id);
        if (!existing) return { changes: 0 };
        books.set(id, { ...existing, title, author, dir, coverSeed, coverColor, lastOpenedAt });
        return { changes: 1 };
      }
      if (sql.startsWith('UPDATE books SET progress =')) {
        const [progress, lastOpenedAt, id] = params as [number, number, string];
        const existing = books.get(id);
        if (!existing) return { changes: 0 };
        books.set(id, { ...existing, progress, lastOpenedAt });
        return { changes: 1 };
      }
      if (sql.startsWith('DELETE FROM books')) {
        const [id] = params as [string];
        return { changes: books.delete(id) ? 1 : 0 };
      }
      if (sql.startsWith('INSERT INTO kv')) {
        const [key, value] = params as [string, string];
        kv.set(key, value);
        return { changes: 1 };
      }
      return { changes: 0 };
    },
    async getFirstAsync<T>(source: string, ...params: unknown[]): Promise<T | null> {
      const sql = source.replace(/\s+/g, ' ').trim();
      if (sql.includes('FROM books WHERE id =')) {
        const [id] = params as [string];
        return (books.get(id) as T | undefined) ?? null;
      }
      if (sql.includes('FROM kv WHERE key =')) {
        const [key] = params as [string];
        const value = kv.get(key);
        return value !== undefined ? ({ value } as T) : null;
      }
      return null;
    },
    async getAllAsync<T>(source: string): Promise<T[]> {
      const sql = source.replace(/\s+/g, ' ').trim();
      if (sql.startsWith('PRAGMA table_info(books)')) {
        return [{ name: 'coverColor' }] as T[];
      }
      if (sql.includes('FROM books')) {
        return Array.from(books.values()) as T[];
      }
      return [];
    },
  };
}

const SAMPLE_MD = `---
title: "أَوْرَاقُ الْبَحْرِ"
author: "كاتب تجريبي"
lang: ar
dir: rtl
coverColor: "#4E342E"
---

# الفصل الأول

كَانَ الْفَجْرُ يَتَسَلَّلُ بِهُدُوءٍ فَوْقَ أَرْصِفَةِ الْمِينَاءِ.
`;

type SceneList = NonNullable<BookReaderState['scenes']>;

function savedScenes(): SceneList {
  return [
    {
      id: 'scene_1',
      afterBlockId: 'ch01_p0001',
      caption: 'المشهد الأول',
      prompt: { setting: 'شاطئ عند الغروب', mood: 'مفعم بالحنين', characters: 'نور', style: 'حبر ورماد' },
      status: 'queued',
      collapsed: true,
    },
  ];
}

describe('bundle reader-state scenes (F46)', () => {
  let db: DatabaseAdapter;

  beforeEach(async () => {
    const root = new Directory(Paths.document, 'books');
    if (root.exists) root.delete();
    db = createInMemoryDb();
    await initDatabase(db);
  });

  it('keeps saved scene placeholders after closing and reopening the bundle', async () => {
    const record = await importBookContent(SAMPLE_MD, 'scenes-round-trip.md', db);

    await saveBookReaderState(
      record.id,
      {
        anchor: null,
        progress: 0.2,
        chapterId: 'ch01',
        page: 2,
        pageCount: 4,
        scenes: savedScenes(),
        updatedAt: Date.now(),
      },
      db,
    );

    // Reopening reads only `.reader-state.json`; nothing is carried over in memory.
    const reopened = await readBookBundle(record.id);

    expect(reopened.state.scenes).toHaveLength(1);
    expect(reopened.state.scenes).toEqual([
      expect.objectContaining({
        id: 'scene_1',
        afterBlockId: 'ch01_p0001',
        caption: 'المشهد الأول',
        status: 'queued',
        collapsed: true,
        prompt: expect.objectContaining({
          setting: 'شاطئ عند الغروب',
          mood: 'مفعم بالحنين',
          characters: 'نور',
          style: 'حبر ورماد',
        }),
      }),
    ]);
  });

  it('keeps scenes when a later save moves the reading position', async () => {
    const record = await importBookContent(SAMPLE_MD, 'scenes-position.md', db);

    await saveBookReaderState(
      record.id,
      { anchor: null, progress: 0.1, chapterId: 'ch01', page: 1, pageCount: 4, scenes: savedScenes(), updatedAt: 1000 },
      db,
    );
    await saveBookReaderState(
      record.id,
      { anchor: null, progress: 0.6, chapterId: 'ch01', page: 3, pageCount: 4, scenes: savedScenes(), updatedAt: 2000 },
      db,
    );

    const reopened = await readBookBundle(record.id);
    expect(reopened.state.progress).toBeCloseTo(0.6);
    expect(reopened.state.page).toBe(3);
    expect(reopened.state.scenes).toEqual([
      expect.objectContaining({ id: 'scene_1', collapsed: true, status: 'queued' }),
    ]);
  });

  it('stays backward compatible with a pre-F46 state file that has no scenes key', async () => {
    const record = await importBookContent(SAMPLE_MD, 'scenes-legacy.md', db);

    await saveBookReaderState(
      record.id,
      { anchor: null, progress: 0.3, chapterId: 'ch01', page: 2, pageCount: 4, updatedAt: 1000 },
      db,
    );

    const reopened = await readBookBundle(record.id);
    expect(reopened.state.scenes).toBeUndefined();
    expect(reopened.state.progress).toBeCloseTo(0.3);
  });
});
