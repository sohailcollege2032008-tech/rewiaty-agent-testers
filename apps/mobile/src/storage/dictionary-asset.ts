/**
 * The bundled offline dictionary asset (F49).
 *
 * Metro resolves `./dictionary-asset.resolver` to the generated
 * `assets/dictionary/arwiktionary.sqlite` when that file exists (a release
 * build), and to the plain `null` resolver module otherwise (dev, `tsc`, Jest,
 * or any environment without the generated database).
 *
 * This module normalizes both shapes into the numeric asset id
 * `SQLite.importDatabaseFromAssetAsync` expects, or `null` when there is no
 * packaged dictionary — never an exception.
 */

import bundledDictionaryAssetModule from './dictionary-asset.resolver';

type AssetModuleShape = {
  default?: unknown;
  assetId?: unknown;
  id?: unknown;
  uri?: unknown;
  localUri?: unknown;
};

function toPositiveAssetId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function readAssetId(moduleShape: AssetModuleShape): number | null {
  // Metro's asset modules export the numeric id directly.
  const direct = toPositiveAssetId(moduleShape as unknown);
  if (direct !== null) return direct;

  // …or an object carrying it (depending on the Metro/Expo version).
  for (const candidate of [moduleShape.default, moduleShape.assetId, moduleShape.id]) {
    const id = toPositiveAssetId(candidate);
    if (id !== null) return id;
  }
  return null;
}

/**
 * Numeric id of the packaged `arwiktionary.sqlite`, or `null` when the build did
 * not bundle one. Safe to call on every launch.
 */
export function getBundledDictionaryAssetId(): number | null {
  if (
    bundledDictionaryAssetModule === null ||
    bundledDictionaryAssetModule === undefined
  ) {
    return null;
  }
  if (typeof bundledDictionaryAssetModule !== 'object') {
    return toPositiveAssetId(bundledDictionaryAssetModule);
  }
  return readAssetId(bundledDictionaryAssetModule as AssetModuleShape);
}
