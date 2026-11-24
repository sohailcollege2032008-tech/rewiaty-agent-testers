import { hashString } from '@rewiaty/book-format';

/**
 * Compute a deterministic book ID from normalized file content so importing
 * the exact same novel twice always maps to the same bundle ID.
 */
export function computeBookId(rawContent: string): string {
  const withoutBom = rawContent.charCodeAt(0) === 0xfeff ? rawContent.slice(1) : rawContent;
  const normalized = withoutBom.replace(/\r\n?/g, '\n');
  return `book_${hashString(normalized)}`;
}
