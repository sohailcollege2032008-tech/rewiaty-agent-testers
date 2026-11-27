/**
 * Metro wiring for the bundled offline dictionary (F49).
 *
 * The generated `apps/mobile/assets/dictionary/arwiktionary.sqlite` is git-ignored
 * and only exists after `scripts/build-apk.sh` runs the builder, so it can be
 * absent on a plain `git clone`, in `tsc` and in Jest.
 *
 * Metro swaps the `./dictionary-asset.resolver` import inside
 * `src/storage/dictionary-asset.ts` for the SQLite asset **only when the file is
 * actually there** (and not empty). Otherwise the normal resolver module is
 * kept, and `getBundledDictionaryAssetId()` returns `null` so dev/tests keep
 * working without any generated file.
 */

const fs = require('node:fs');
const path = require('node:path');

const DICTIONARY_ASSET_RELATIVE_PATH = path.join(
  'assets',
  'dictionary',
  'arwiktionary.sqlite',
);

const DICTIONARY_RESOLVER_MODULE_NAME = 'dictionary-asset.resolver';

/** Absolute path of the generated dictionary asset for a project root. */
function dictionaryAssetPath(projectRoot) {
  return path.join(projectRoot, DICTIONARY_ASSET_RELATIVE_PATH);
}

/**
 * Is the generated dictionary asset present *and* non-empty?
 *
 * `statSync` is injectable so the logic can be unit tested without creating a
 * (git-ignored) SQLite file inside the repository.
 */
function isDictionaryAssetAvailable(projectRoot, options = {}) {
  const statSync = options.statSync ?? fs.statSync;
  try {
    const stat = statSync(dictionaryAssetPath(projectRoot));
    return Boolean(stat && stat.isFile() && stat.size > 0);
  } catch {
    return false;
  }
}

/** Is this import the resolver indirection `src/storage/dictionary-asset.ts` uses? */
function isDictionaryAssetResolverRequest(moduleName) {
  if (typeof moduleName !== 'string') return false;
  const normalized = moduleName.replace(/\\/g, '/');
  return (
    normalized === `./${DICTIONARY_RESOLVER_MODULE_NAME}` ||
    normalized.endsWith(`/${DICTIONARY_RESOLVER_MODULE_NAME}`)
  );
}

/**
 * Resolve a dictionary-resolver import to the SQLite asset when the generated
 * file exists. Returns `undefined` when this request is not ours, or when there
 * is no asset to swap in (the caller then resolves normally).
 */
function resolveDictionaryAssetRequest(
  { projectRoot, statSync },
  context,
  moduleName,
  platform,
  resolveRequest,
) {
  if (!isDictionaryAssetResolverRequest(moduleName)) return undefined;
  if (!isDictionaryAssetAvailable(projectRoot, { statSync })) return undefined;
  return resolveRequest(context, dictionaryAssetPath(projectRoot), platform);
}

module.exports = {
  DICTIONARY_ASSET_RELATIVE_PATH,
  DICTIONARY_RESOLVER_MODULE_NAME,
  dictionaryAssetPath,
  isDictionaryAssetAvailable,
  isDictionaryAssetResolverRequest,
  resolveDictionaryAssetRequest,
};
