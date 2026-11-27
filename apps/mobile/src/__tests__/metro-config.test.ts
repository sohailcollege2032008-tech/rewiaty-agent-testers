/**
 * The bundled offline dictionary is a generated, git-ignored SQLite file, so the
 * Metro wiring must keep two promises:
 *
 * 1. `.sqlite` is treated as an asset extension (it has to be packaged in the APK).
 * 2. `./dictionary-asset.resolver` becomes the SQLite asset **only when the file
 *    exists and is non-empty**; otherwise the plain `null` resolver stays in place
 *    so dev, `tsc` and Jest work on a clean clone.
 */

const config = require('../../metro.config.js');
const {
  DICTIONARY_ASSET_RELATIVE_PATH,
  dictionaryAssetPath,
  isDictionaryAssetAvailable,
  isDictionaryAssetResolverRequest,
  resolveDictionaryAssetRequest,
} = require('../../metro.dictionary-asset.js');

type FakeStat = { isFile: () => boolean; size: number };

function statFor(size: number): () => FakeStat {
  return () => ({ isFile: () => true, size });
}

describe('metro.config.js — bundled dictionary asset', () => {
  it('packages .sqlite as an asset extension', () => {
    expect(config.resolver.assetExts).toContain('sqlite');
  });

  it('recognizes the resolver indirection only', () => {
    expect(isDictionaryAssetResolverRequest('./dictionary-asset.resolver')).toBe(true);
    expect(
      isDictionaryAssetResolverRequest('../storage/dictionary-asset.resolver'),
    ).toBe(true);
    expect(isDictionaryAssetResolverRequest('./dictionary-asset')).toBe(false);
    expect(isDictionaryAssetResolverRequest('expo-sqlite')).toBe(false);
    expect(isDictionaryAssetResolverRequest(undefined)).toBe(false);
  });

  it('resolves the SQLite asset when it exists, at the generated path', () => {
    const resolveRequest = jest.fn(
      (_context: unknown, moduleName: string) => `resolved:${moduleName}`,
    );
    const context = { originModulePath: '/repo/apps/mobile/src/storage/dictionary-asset.ts' };

    const result = resolveDictionaryAssetRequest(
      { projectRoot: '/repo/apps/mobile', statSync: statFor(2592768) },
      context,
      './dictionary-asset.resolver',
      'android',
      resolveRequest,
    );

    expect(result).toBe(`resolved:${dictionaryAssetPath('/repo/apps/mobile')}`);
    expect(resolveRequest).toHaveBeenCalledWith(
      context,
      dictionaryAssetPath('/repo/apps/mobile'),
      'android',
    );
    expect(dictionaryAssetPath('/repo/apps/mobile')).toBe(
      `/repo/apps/mobile/${DICTIONARY_ASSET_RELATIVE_PATH}`,
    );
    expect(dictionaryAssetPath('/repo/apps/mobile')).toMatch(/arwiktionary\.sqlite$/);
  });

  it('leaves the default resolver in place when the file is missing or empty', () => {
    const resolveRequest = jest.fn();
    const context = { originModulePath: '/repo/apps/mobile/src/storage/dictionary-asset.ts' };

    const missing = () =>
      resolveDictionaryAssetRequest(
        {
          projectRoot: '/repo/apps/mobile',
          statSync: () => {
            throw new Error('ENOENT');
          },
        },
        context,
        './dictionary-asset.resolver',
        'android',
        resolveRequest,
      );
    const empty = () =>
      resolveDictionaryAssetRequest(
        { projectRoot: '/repo/apps/mobile', statSync: statFor(0) },
        context,
        './dictionary-asset.resolver',
        'android',
        resolveRequest,
      );

    expect(missing()).toBeUndefined();
    expect(empty()).toBeUndefined();
    expect(resolveRequest).not.toHaveBeenCalled();
  });

  it('does not treat a non-dictionary import as the SQLite asset', () => {
    const resolveRequest = jest.fn();
    const result = resolveDictionaryAssetRequest(
      { projectRoot: '/repo/apps/mobile', statSync: statFor(2592768) },
      {},
      'expo-sqlite',
      'android',
      resolveRequest,
    );

    expect(result).toBeUndefined();
    expect(resolveRequest).not.toHaveBeenCalled();
  });

  it('reports availability from a real stat of the generated file', () => {
    const present = isDictionaryAssetAvailable('/repo/apps/mobile', {
      statSync: statFor(10),
    });
    const absent = isDictionaryAssetAvailable('/repo/apps/mobile', {
      statSync: () => {
        throw new Error('ENOENT');
      },
    });

    expect(present).toBe(true);
    expect(absent).toBe(false);
  });
});
