import { hashBytes, hashString } from '@rewiaty/book-format';

/**
 * Compute a deterministic book ID from normalized file content so importing
 * the exact same novel twice always maps to the same bundle ID.
 */
export function computeBookId(rawContent: string, identitySuffix = ''): string {
  const withoutBom = rawContent.charCodeAt(0) === 0xfeff ? rawContent.slice(1) : rawContent;
  const normalized = withoutBom.replace(/\r\n?/g, '\n');
  const seed = identitySuffix ? `${normalized}\n${identitySuffix}` : normalized;
  return `book_${hashString(seed)}`;
}

export type IdentifiedAsset = { path: string; bytes: Uint8Array };

/**
 * Fingerprint of an archive's image bytes, so two archives with identical Markdown but different
 * pictures get different book IDs. Paths are sorted: asset order must not change the identity.
 */
export function computeAssetsIdentity(assets: readonly IdentifiedAsset[]): string {
  return [...assets]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((asset) => `${asset.path}:${asset.bytes.byteLength}:${hashBytes(asset.bytes)}`)
    .join('|');
}

/** Identity for an imported archive: the converted Markdown plus every asset's bytes. */
export function computeArchiveBookId(
  markdown: string,
  assets: readonly IdentifiedAsset[],
): string {
  return computeBookId(markdown, computeAssetsIdentity(assets));
}
