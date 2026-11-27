/**
 * Offline Arabic dictionary lookup (F49).
 *
 * The dictionary ships as a bundled SQLite file built by
 * `scripts/build-dictionary.py` from a pinned, dated Arabic Wiktionary dump.
 * The app never bundles the dump itself, only the generated database, and the
 * generated file is git-ignored (see `.gitignore`).
 *
 * License: the dictionary *content* stays licensed CC BY-SA 4.0 by the Arabic
 * Wiktionary contributors. The entries are **modified** before distribution —
 * extracted from the dump, stripped of wiki markup and indexed into SQLite — and
 * CC BY-SA 4.0 requires that change to be disclosed, so every surface that shows
 * an entry also links back to the original page and its contributor history. The
 * application source keeps its own license (the Expo template's MIT notice in
 * `apps/mobile/LICENSE`).
 * `DICTIONARY_ATTRIBUTION` is attached to every lookup result so the UI can
 * always show the credit.
 */

import * as SQLite from 'expo-sqlite';

import { generateStemCandidates, normalizeArabicWord } from './arabic-stemmer';
import { getBundledDictionaryAssetId } from './dictionary-asset';
import type { DatabaseAdapter } from './database';

const WIKTIONARY_ORIGIN = 'https://ar.wiktionary.org';

export const DICTIONARY_ATTRIBUTION = {
  source: 'ويكاموس العربي (Arabic Wiktionary)',
  sourceUrl: WIKTIONARY_ORIGIN,
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  noticeAr: 'بيانات القاموس من مساهمي ويكاموس العربي، مرخّصة بموجب المشاع الإبداعي CC BY-SA 4.0.',
  /**
   * What we actually do to the source text. This is deliberately explicit: the
   * entries are modified before distribution, and CC BY-SA 4.0 requires the
   * modification to be disclosed alongside the credit.
   */
  processingAr:
    'المداخل مُستخلصة من ويكاموس العربي ومُنظّفة من ترميز الويكي ومُفهرسة للبحث السريع دون إنترنت، مع الحفاظ على شروط رخصة CC BY-SA 4.0 كما هي.',
  contributorsAr: 'محتوى القاموس من مساهمي ويكاموس العربي ويبقى مرخّصاً بموجب CC BY-SA 4.0.',
} as const;

/**
 * The original Arabic Wiktionary page for one headword plus the history page
 * that lists its contributors — the two links CC BY-SA attribution needs.
 */
export function buildWiktionaryEntryUrl(word: string): {
  pageUrl: string;
  historyUrl: string;
} {
  const encoded = encodeURIComponent(typeof word === 'string' ? word : '');
  return {
    pageUrl: `${WIKTIONARY_ORIGIN}/wiki/${encoded}`,
    historyUrl: `${WIKTIONARY_ORIGIN}/w/index.php?title=${encoded}&action=history`,
  };
}

/** Metadata recorded in `scripts/dictionary-meta.json` for the shipped build. */
export const DICTIONARY_DUMP_DATE = '2026-11-01';
export const DICTIONARY_ENTRY_COUNT = 15735;
export const DICTIONARY_DB_FILE_NAME = 'arwiktionary.sqlite';
export const DICTIONARY_UNAVAILABLE_REASON = 'القاموس غير متاح حالياً على الجهاز.';

export interface DictionaryEntry {
  word: string;
  norm: string;
  pos: string | null;
  root: string | null;
  definitions: string[];
}

export type DictionaryLookupResult =
  | {
      status: 'found';
      query: string;
      matchType: 'exact' | 'stemmed';
      matchedNorm: string;
      entries: DictionaryEntry[];
      attribution: typeof DICTIONARY_ATTRIBUTION;
    }
  | {
      status: 'not_found';
      query: string;
      normalized: string;
      attribution: typeof DICTIONARY_ATTRIBUTION;
    }
  | {
      status: 'unavailable';
      query: string;
      reasonAr: string;
      attribution: typeof DICTIONARY_ATTRIBUTION;
    };

/** The only surface the dictionary needs from `DatabaseAdapter`. */
export type DictionaryDbAdapter = Pick<DatabaseAdapter, 'getAllAsync'>;

type DictionaryRow = {
  word: string | null;
  norm: string | null;
  pos: string | null;
  root: string | null;
  defs: string | null;
};

/** Stay well under SQLite's default 999 bound-variable limit. */
const LOOKUP_CHUNK_SIZE = 400;

function toLookupQuery(rawWord: unknown): string {
  return typeof rawWord === 'string' ? rawWord : '';
}

function splitDefinitions(defs: string | null | undefined): string[] {
  if (typeof defs !== 'string' || defs.length === 0) return [];
  return defs
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function rowToEntry(row: DictionaryRow): DictionaryEntry | null {
  if (!row || typeof row.word !== 'string' || typeof row.norm !== 'string') return null;
  return {
    word: row.word,
    norm: row.norm,
    pos: typeof row.pos === 'string' && row.pos.length > 0 ? row.pos : null,
    root: typeof row.root === 'string' && row.root.length > 0 ? row.root : null,
    definitions: splitDefinitions(row.defs),
  };
}

async function fetchRows(
  candidates: readonly string[],
  db: DictionaryDbAdapter,
): Promise<DictionaryRow[]> {
  const rows: DictionaryRow[] = [];
  for (let start = 0; start < candidates.length; start += LOOKUP_CHUNK_SIZE) {
    const chunk = candidates.slice(start, start + LOOKUP_CHUNK_SIZE);
    if (chunk.length === 0) continue;
    const placeholders = chunk.map(() => '?').join(', ');
    const found = await db.getAllAsync<DictionaryRow>(
      `SELECT word, norm, pos, root, defs FROM entries
       WHERE norm IN (${placeholders})
       ORDER BY id`,
      ...chunk,
    );
    if (Array.isArray(found)) {
      rows.push(...found);
    }
  }
  return rows;
}

/**
 * Look a word up in the bundled dictionary using exact + light-stem candidates.
 *
 * Never throws: an unavailable database, a missing table or any SQLite error is
 * reported as `status: 'unavailable'`, and a word with no Arabic content is
 * reported as `status: 'not_found'`.
 */
export async function lookupDictionaryWord(
  rawWord: string,
  db?: DictionaryDbAdapter | null,
): Promise<DictionaryLookupResult> {
  const query = toLookupQuery(rawWord);
  const normalized = normalizeArabicWord(query);
  const candidates = generateStemCandidates(query);

  if (normalized.length < 2 || candidates.length === 0) {
    return {
      status: 'not_found',
      query,
      normalized,
      attribution: DICTIONARY_ATTRIBUTION,
    };
  }

  if (!db) {
    return {
      status: 'unavailable',
      query,
      reasonAr: DICTIONARY_UNAVAILABLE_REASON,
      attribution: DICTIONARY_ATTRIBUTION,
    };
  }

  try {
    const rows = await fetchRows(candidates, db);
    if (rows.length === 0) {
      return {
        status: 'not_found',
        query,
        normalized,
        attribution: DICTIONARY_ATTRIBUTION,
      };
    }

    const entriesByNorm = new Map<string, DictionaryEntry[]>();
    for (const row of rows) {
      const entry = rowToEntry(row);
      if (!entry) continue;
      const bucket = entriesByNorm.get(entry.norm);
      if (bucket) {
        bucket.push(entry);
      } else {
        entriesByNorm.set(entry.norm, [entry]);
      }
    }

    // Prefer the exact normalized word, then the earliest (strongest) stem.
    let matchedNorm: string | null = null;
    for (const candidate of candidates) {
      if (entriesByNorm.has(candidate)) {
        matchedNorm = candidate;
        break;
      }
    }

    if (!matchedNorm) {
      return {
        status: 'not_found',
        query,
        normalized,
        attribution: DICTIONARY_ATTRIBUTION,
      };
    }

    return {
      status: 'found',
      query,
      matchType: matchedNorm === candidates[0] ? 'exact' : 'stemmed',
      matchedNorm,
      entries: entriesByNorm.get(matchedNorm) ?? [],
      attribution: DICTIONARY_ATTRIBUTION,
    };
  } catch {
    return {
      status: 'unavailable',
      query,
      reasonAr: DICTIONARY_UNAVAILABLE_REASON,
      attribution: DICTIONARY_ATTRIBUTION,
    };
  }
}

let bundledDbPromise: Promise<DictionaryDbAdapter | null> | null = null;

/** Close a SQLite handle without ever throwing at the caller. */
async function closeQuietly(db: { closeAsync?: () => Promise<void> } | null): Promise<void> {
  if (!db || typeof db.closeAsync !== 'function') return;
  try {
    await db.closeAsync();
  } catch {
    // Already closed, or the handle never opened properly: nothing to do.
  }
}

/**
 * Open the bundled dictionary database with a safe `null` fallback.
 *
 * The SQLite file shipped inside the APK never becomes a usable database on its
 * own: on the first launch `arwiktionary.sqlite` is created empty by
 * `openDatabaseAsync`. When the `entries` table is missing and a bundled asset
 * exists, the asset is imported over that empty file
 * (`importDatabaseFromAssetAsync(..., { forceOverwrite: true })`), the database
 * is reopened and only a *verified* handle is cached. Every failure path closes
 * the handle, clears the cache and returns `null` so the UI shows the calm
 * "unavailable" state and the next call retries instead of replaying a cached
 * `null`.
 */
export async function openBundledDictionaryDb(): Promise<DictionaryDbAdapter | null> {
  if (!bundledDbPromise) {
    bundledDbPromise = openVerifiedBundledDictionaryDb();
  }
  return bundledDbPromise;
}

type SqliteAssetImporter = (
  databaseName: string,
  options: { assetId: number; forceOverwrite?: boolean },
) => Promise<void>;

async function hasEntriesTable(db: SQLite.SQLiteDatabase): Promise<boolean> {
  const probe = await db.getFirstAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'entries'",
  );
  return Boolean(probe);
}

/**
 * Copy the packaged SQLite asset into the SQLite directory when the runtime has
 * no `importDatabaseFromAssetAsync` (older Expo SQLite builds). Returns `false`
 * instead of throwing.
 */
async function copyBundledDictionaryAsset(assetId: number): Promise<boolean> {
  try {
    // Loaded lazily: dev/tests without a bundled database must not need them.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Asset } = require('expo-asset') as typeof import('expo-asset');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fileSystem = require('expo-file-system') as typeof import('expo-file-system');

    const asset = Asset.fromModule(assetId);
    await asset.downloadAsync();
    const sourceUri = asset.localUri ?? asset.uri;
    if (!sourceUri) return false;

    const { Directory, File, Paths } = fileSystem;
    const defaultDirectory = (
      SQLite as unknown as { defaultDatabaseDirectory?: unknown }
    ).defaultDatabaseDirectory;
    const databaseDirectory =
      typeof defaultDirectory === 'string' && defaultDirectory.length > 0
        ? new Directory(defaultDirectory)
        : new Directory(Paths.document, 'SQLite');
    databaseDirectory.create({ intermediates: true, idempotent: true });

    const target = new File(databaseDirectory, DICTIONARY_DB_FILE_NAME);
    if (target.exists) {
      target.delete();
    }
    const source = new File(sourceUri);
    const bytes = await source.bytes();
    await target.write(bytes);
    return true;
  } catch {
    return false;
  }
}

/** Import the packaged dictionary over the (empty) database file. */
async function importBundledDictionaryAsset(assetId: number): Promise<boolean> {
  const importFromAsset = (
    SQLite as unknown as { importDatabaseFromAssetAsync?: SqliteAssetImporter }
  ).importDatabaseFromAssetAsync;

  if (typeof importFromAsset !== 'function') {
    return copyBundledDictionaryAsset(assetId);
  }

  try {
    await importFromAsset.call(SQLite, DICTIONARY_DB_FILE_NAME, {
      assetId,
      forceOverwrite: true,
    });
    return true;
  } catch {
    return false;
  }
}

async function openVerifiedBundledDictionaryDb(): Promise<DictionaryDbAdapter | null> {
  let raw: SQLite.SQLiteDatabase | null = null;
  try {
    let ready = false;
    try {
      raw = await SQLite.openDatabaseAsync(DICTIONARY_DB_FILE_NAME);
      ready = await hasEntriesTable(raw);
    } catch {
      // A truncated/corrupt file from an interrupted first-launch import can make
      // openDatabaseAsync or the sqlite_master probe throw; fall through so the
      // bundled asset overwrites and repairs it.
      ready = false;
    }

    if (!ready) {
      // First launch or interrupted copy: close any broken/empty handle and import.
      await closeQuietly(raw);
      raw = null;

      const assetId = getBundledDictionaryAssetId();
      if (assetId === null) {
        bundledDbPromise = null;
        return null;
      }

      if (!(await importBundledDictionaryAsset(assetId))) {
        bundledDbPromise = null;
        return null;
      }

      raw = await SQLite.openDatabaseAsync(DICTIONARY_DB_FILE_NAME);
      if (!(await hasEntriesTable(raw))) {
        await closeQuietly(raw);
        raw = null;
        bundledDbPromise = null;
        return null;
      }
    }

    const handle = raw!;
    return {
      getAllAsync: <T>(source: string, ...params: SQLite.SQLiteBindValue[]): Promise<T[]> =>
        handle.getAllAsync<T>(source, ...params),
    };
  } catch {
    await closeQuietly(raw);
    bundledDbPromise = null;
    return null;
  }
}

/** Forget the cached bundled database handle (tests, or a retry after a failure). */
export function resetBundledDictionaryDbCache(): void {
  bundledDbPromise = null;
}
