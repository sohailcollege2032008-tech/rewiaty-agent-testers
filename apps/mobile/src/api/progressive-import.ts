import { importBookContent as defaultImportBookContent } from '@/storage/bundle';
import type { DatabaseAdapter } from '@/storage/database';
import type { BookLibraryRecord } from '@/types/reader';

import { ApiError, type RewiatyApiClient } from './client';
import type { BundleMeta, ChapterBundleAsset, ChapterBundleResponse } from './types';

/** Signature of the canonical bundle writer the importer delegates to. */
export type ImportBookContentFn = (
  rawText: string,
  fileName: string,
  db?: DatabaseAdapter,
  options?: { bookId?: string },
) => Promise<BookLibraryRecord | null | undefined>;

/** Optional binary downloader for chapter images (host injects filesystem/S3 access). */
export type ChapterAssetDownloader = (
  asset: ChapterBundleAsset,
  bookId: string,
) => Promise<void> | void;

export interface ProgressiveImportDeps {
  importBookContent: ImportBookContentFn;
  /** Optional binary asset downloader so tests can run fully in memory. */
  downloadAsset?: ChapterAssetDownloader;
  /** Alias of `downloadAsset`, accepted for call-site convenience. */
  downloadAssets?: ChapterAssetDownloader;
}

export interface ProgressiveImportOptions {
  client: RewiatyApiClient;
  bookId: string;
  db?: DatabaseAdapter;
  deps?: Partial<ProgressiveImportDeps>;
}

export interface ProgressiveImportResult {
  importedCount: number;
  skippedCount: number;
  totalChapters: number;
  isComplete: boolean;
  bookRecord: BookLibraryRecord | null;
}

export type ImportedChapter = {
  chapterId: string;
  chapterIndex: number;
  title: string;
  hash: string;
  markdown: string;
  assets: ChapterBundleAsset[];
};

/** Quote a value so Arabic punctuation, `#` and `:` stay literal YAML strings. */
function yamlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function buildFrontmatter(meta: BundleMeta): string {
  const lines = ['---', `title: ${yamlString(meta.title)}`];
  if (meta.author) lines.push(`author: ${yamlString(meta.author)}`);
  lines.push(`lang: ${yamlString(meta.lang || 'ar')}`);
  lines.push(`dir: ${yamlString(meta.dir || 'rtl')}`);
  if (meta.coverColor) lines.push(`coverColor: ${yamlString(meta.coverColor)}`);
  lines.push('---');
  return lines.join('\n');
}

/** A chapter body must be exactly one `#` section; add the heading only when it is missing. */
function withChapterHeading(chapter: ImportedChapter): string {
  const body = chapter.markdown.replace(/^\uFEFF/, '').trim();
  const firstLine = body.split('\n', 1)[0]?.trim() ?? '';
  if (firstLine.startsWith('# ')) return body;
  return `# ${chapter.title}\n\n${body}`.trimEnd();
}

/**
 * Assemble the canonical `book.md`: YAML frontmatter from the manifest, then every known chapter
 * in `chapter_index` order. Chapters that are not ready yet are simply absent, which is exactly
 * what an incremental bundle looks like (the contract allows a book.md that ends early).
 */
export function assembleBookMarkdown(meta: BundleMeta, chapters: ImportedChapter[]): string {
  const ordered = [...chapters].sort((a, b) => a.chapterIndex - b.chapterIndex);
  const parts = [buildFrontmatter(meta), ...ordered.map(withChapterHeading)];
  return `${parts.join('\n\n')}\n`;
}

/**
 * Incrementally merges ready chapters from the backend into the local canonical bundle.
 *
 * The importer caches every chapter it has downloaded (id → hash), so calling
 * `importReadyChapters()` again only downloads chapters that are new or whose `hash` changed.
 *
 * Two invariants keep the local bundle trustworthy while a job is still producing chapters:
 *
 * 1. `book.md` only ever contains the **contiguous prefix** of the manifest, starting at the
 *    first chapter. `@rewiaty/book-format` re-numbers chapters sequentially by document order
 *    (`ch01`, `ch02`, …), so writing a lone `ch02` would persist its text as `ch01`. A chapter
 *    that arrives out of order is cached in memory and written once the gap before it is filled.
 * 2. Newly fetched chapters are **staged**, not committed, until `importBookContent` resolves.
 *    A failed write therefore leaves the content intact, and the next run retries the write
 *    instead of re-downloading (or worse, silently dropping) it.
 */
export class ProgressiveBookImporter {
  private readonly client: RewiatyApiClient;
  private readonly bookId: string;
  private readonly db?: DatabaseAdapter;
  private importBookContent: ImportBookContentFn = defaultImportBookContent;
  private downloadAsset?: ChapterAssetDownloader;

  /** Chapters already persisted into the local bundle. */
  private readonly chapters = new Map<string, ImportedChapter>();
  /** Chapters downloaded but not yet persisted; merged only after a successful write. */
  private readonly staged = new Map<string, ImportedChapter>();
  private readonly downloadedAssets = new Set<string>();
  /**
   * Chapters whose manifest listed images that failed to download.
   *
   * Why (review finding): a chapter payload carries **presigned** asset URLs with an expiry.
   * When a download fails we keep the chapter text cached (the hash is unchanged) but the
   * old URLs may already be dead by the next attempt. The retry must ask the API for a fresh
   * chapter payload — new signatures — instead of replaying a stale URL only because the hash
   * matches.
   */
  private readonly staleAssetChapters = new Set<string>();
  /** Exact markdown of the last successful `importBookContent`, to avoid redundant writes. */
  private lastWrittenMarkdown: string | null = null;

  constructor(options: ProgressiveImportOptions);
  constructor(
    client: RewiatyApiClient,
    bookId: string,
    db?: DatabaseAdapter,
    deps?: Partial<ProgressiveImportDeps>,
  );
  constructor(
    clientOrOptions: RewiatyApiClient | ProgressiveImportOptions,
    bookId?: string,
    db?: DatabaseAdapter,
    deps?: Partial<ProgressiveImportDeps>,
  ) {
    const isOptionsObject =
      typeof clientOrOptions === 'object' &&
      clientOrOptions !== null &&
      'client' in clientOrOptions &&
      'bookId' in clientOrOptions;

    if (isOptionsObject) {
      const options = clientOrOptions as ProgressiveImportOptions;
      this.client = options.client;
      this.bookId = options.bookId;
      this.db = options.db;
      this.applyDeps(options.deps);
    } else {
      this.client = clientOrOptions as RewiatyApiClient;
      this.bookId = bookId ?? '';
      this.db = db;
      this.applyDeps(deps);
    }

    if (!this.bookId) {
      throw new Error('ProgressiveBookImporter يحتاج bookId');
    }
  }

  private applyDeps(deps?: Partial<ProgressiveImportDeps>): void {
    this.importBookContent = deps?.importBookContent ?? defaultImportBookContent;
    this.downloadAsset = deps?.downloadAsset ?? deps?.downloadAssets;
  }

  /**
   * Download every ready chapter that is new or changed, then rebuild the local bundle.
   *
   * The bundle is only rewritten when the writable prefix actually produced different text (or
   * after a previous write failed), and only the contiguous prefix is written.
   *
   * @param readyChapterIds restrict the run to these ids (defaults to the manifest's
   *   `ready_chapter_ids`).
   */
  async importReadyChapters(readyChapterIds?: string[]): Promise<ProgressiveImportResult> {
    const manifest = await this.client.getBundleManifest(this.bookId);

    const metaById = new Map(manifest.chapters.map((chapter) => [chapter.id, chapter]));
    const readyIds = new Set(readyChapterIds ?? manifest.ready_chapter_ids ?? []);
    // Book order, not the order the ids arrived in.
    const wantedIds = manifest.chapters
      .map((chapter) => chapter.id)
      .filter((id) => readyIds.has(id));

    let importedCount = 0;
    let skippedCount = 0;

    for (const chapterId of wantedIds) {
      const summary = metaById.get(chapterId);
      if (!summary) continue;

      const cached = this.staged.get(chapterId) ?? this.chapters.get(chapterId);
      const needsFreshAssetUrls = this.staleAssetChapters.has(chapterId);
      if (cached && cached.hash === summary.hash && !needsFreshAssetUrls) {
        // The text is already downloaded: only assets that failed earlier are retried.
        await this.downloadChapterAssets(cached);
        skippedCount += 1;
        continue;
      }

      let chapter: ChapterBundleResponse;
      try {
        chapter = await this.client.getBundleChapter(this.bookId, chapterId);
      } catch (error) {
        // A chapter advertised as ready but not downloadable yet is skipped, not fatal.
        if (error instanceof ApiError && (error.status === 404 || error.status === 409)) {
          skippedCount += 1;
          continue;
        }
        throw error;
      }

      const imported: ImportedChapter = {
        chapterId,
        chapterIndex: chapter.chapter_index,
        title: chapter.title || summary.title,
        hash: chapter.hash || summary.hash,
        markdown: chapter.markdown ?? '',
        assets: chapter.assets ?? [],
      };
      this.staged.set(chapterId, imported);
      if (cached && cached.hash === summary.hash) {
        // Same text, freshly signed asset URLs: this is an asset retry, not a new import.
        skippedCount += 1;
      } else {
        importedCount += 1;
      }

      await this.downloadChapterAssets(imported);
    }

    const isComplete = manifest.is_complete;
    const totalChapters = manifest.chapters.length;

    const writable = this.writablePrefix(manifest.chapters);
    if (writable.length === 0) {
      return {
        importedCount,
        skippedCount,
        totalChapters,
        isComplete,
        bookRecord: null,
      };
    }

    const markdown = assembleBookMarkdown(manifest.meta, writable);
    if (markdown === this.lastWrittenMarkdown) {
      return {
        importedCount,
        skippedCount,
        totalChapters,
        isComplete,
        bookRecord: null,
      };
    }

    const fileName = `${manifest.meta.title || this.bookId}.md`;
    const record = await this.importBookContent(markdown, fileName, this.db, {
      bookId: this.bookId,
    });

    // Commit only after the write succeeded; a throw above leaves everything staged so the
    // next run retries `book.md` without touching the network.
    for (const [chapterId, chapter] of this.staged) {
      this.chapters.set(chapterId, chapter);
    }
    this.staged.clear();
    this.lastWrittenMarkdown = markdown;

    return {
      importedCount,
      skippedCount,
      totalChapters,
      isComplete,
      bookRecord: record ?? null,
    };
  }

  /**
   * The longest leading run of manifest chapters whose content is already downloaded.
   *
   * Stops at the first missing chapter so a gap (ch02 ready before ch01) can never shift the
   * document order and make `@rewiaty/book-format` renumber ch02 as ch01.
   */
  private writablePrefix(
    manifestChapters: { id: string }[],
  ): ImportedChapter[] {
    const prefix: ImportedChapter[] = [];
    for (const summary of manifestChapters) {
      const known = this.staged.get(summary.id) ?? this.chapters.get(summary.id);
      if (!known) break;
      prefix.push(known);
    }
    return prefix;
  }

  private async downloadChapterAssets(chapter: ImportedChapter): Promise<void> {
    if (!this.downloadAsset) {
      // Nothing to download: a chapter can never be stuck waiting for a fresh payload.
      this.staleAssetChapters.delete(chapter.chapterId);
      return;
    }

    let failed = false;
    for (const asset of chapter.assets) {
      if (this.downloadedAssets.has(asset.name)) continue;
      this.downloadedAssets.add(asset.name);
      try {
        await this.downloadAsset(asset, this.bookId);
      } catch {
        // The bundle text is the deliverable; a failed image is retried on the next import.
        // Forget the name so the retry downloads it, and mark the chapter as needing a fresh
        // payload: its presigned URLs may have expired since this attempt.
        this.downloadedAssets.delete(asset.name);
        failed = true;
      }
    }

    if (failed) {
      this.staleAssetChapters.add(chapter.chapterId);
    } else {
      this.staleAssetChapters.delete(chapter.chapterId);
    }
  }
}
