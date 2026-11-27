/**
 * Default (no generated dictionary) side of the Metro indirection.
 *
 * `metro.config.js` swaps this module for
 * `assets/dictionary/arwiktionary.sqlite` **only when that generated file exists
 * and is not empty**. On a fresh clone, in `tsc`, in Jest and in dev without the
 * release build, the real module is used and there is simply no bundled database
 * asset to import — `getBundledDictionaryAssetId()` then returns `null` and the
 * dictionary keeps its calm "unavailable" state.
 *
 * Do not import this file directly outside `dictionary-asset.ts`: the bundle
 * must go through the resolver so Metro can substitute the asset.
 */
const bundledDictionaryAssetModule: unknown = null;

export default bundledDictionaryAssetModule;
