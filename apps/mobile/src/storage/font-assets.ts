import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';

export type BundledFontAsset = {
  fileName: string;
  assetModule: number;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
export const BUNDLED_FONT_ASSETS: readonly BundledFontAsset[] = [
  { fileName: 'amiri-italic-400-arabic.woff2', assetModule: require('@/assets/fonts/amiri-italic-400-arabic.woff2') as number },
  { fileName: 'amiri-italic-400-latin-ext.woff2', assetModule: require('@/assets/fonts/amiri-italic-400-latin-ext.woff2') as number },
  { fileName: 'amiri-italic-400-latin.woff2', assetModule: require('@/assets/fonts/amiri-italic-400-latin.woff2') as number },
  { fileName: 'amiri-italic-700-arabic.woff2', assetModule: require('@/assets/fonts/amiri-italic-700-arabic.woff2') as number },
  { fileName: 'amiri-italic-700-latin-ext.woff2', assetModule: require('@/assets/fonts/amiri-italic-700-latin-ext.woff2') as number },
  { fileName: 'amiri-italic-700-latin.woff2', assetModule: require('@/assets/fonts/amiri-italic-700-latin.woff2') as number },
  { fileName: 'amiri-normal-400-arabic.woff2', assetModule: require('@/assets/fonts/amiri-normal-400-arabic.woff2') as number },
  { fileName: 'amiri-normal-400-latin-ext.woff2', assetModule: require('@/assets/fonts/amiri-normal-400-latin-ext.woff2') as number },
  { fileName: 'amiri-normal-400-latin.woff2', assetModule: require('@/assets/fonts/amiri-normal-400-latin.woff2') as number },
  { fileName: 'amiri-normal-700-arabic.woff2', assetModule: require('@/assets/fonts/amiri-normal-700-arabic.woff2') as number },
  { fileName: 'amiri-normal-700-latin-ext.woff2', assetModule: require('@/assets/fonts/amiri-normal-700-latin-ext.woff2') as number },
  { fileName: 'amiri-normal-700-latin.woff2', assetModule: require('@/assets/fonts/amiri-normal-700-latin.woff2') as number },
  { fileName: 'ibm-plex-sans-arabic-normal-300-arabic.woff2', assetModule: require('@/assets/fonts/ibm-plex-sans-arabic-normal-300-arabic.woff2') as number },
  { fileName: 'ibm-plex-sans-arabic-normal-300-latin-ext.woff2', assetModule: require('@/assets/fonts/ibm-plex-sans-arabic-normal-300-latin-ext.woff2') as number },
  { fileName: 'ibm-plex-sans-arabic-normal-300-latin.woff2', assetModule: require('@/assets/fonts/ibm-plex-sans-arabic-normal-300-latin.woff2') as number },
  { fileName: 'ibm-plex-sans-arabic-normal-400-arabic.woff2', assetModule: require('@/assets/fonts/ibm-plex-sans-arabic-normal-400-arabic.woff2') as number },
  { fileName: 'ibm-plex-sans-arabic-normal-400-latin-ext.woff2', assetModule: require('@/assets/fonts/ibm-plex-sans-arabic-normal-400-latin-ext.woff2') as number },
  { fileName: 'ibm-plex-sans-arabic-normal-400-latin.woff2', assetModule: require('@/assets/fonts/ibm-plex-sans-arabic-normal-400-latin.woff2') as number },
  { fileName: 'ibm-plex-sans-arabic-normal-500-arabic.woff2', assetModule: require('@/assets/fonts/ibm-plex-sans-arabic-normal-500-arabic.woff2') as number },
  { fileName: 'ibm-plex-sans-arabic-normal-500-latin-ext.woff2', assetModule: require('@/assets/fonts/ibm-plex-sans-arabic-normal-500-latin-ext.woff2') as number },
  { fileName: 'ibm-plex-sans-arabic-normal-500-latin.woff2', assetModule: require('@/assets/fonts/ibm-plex-sans-arabic-normal-500-latin.woff2') as number },
  { fileName: 'ibm-plex-sans-arabic-normal-600-arabic.woff2', assetModule: require('@/assets/fonts/ibm-plex-sans-arabic-normal-600-arabic.woff2') as number },
  { fileName: 'ibm-plex-sans-arabic-normal-600-latin-ext.woff2', assetModule: require('@/assets/fonts/ibm-plex-sans-arabic-normal-600-latin-ext.woff2') as number },
  { fileName: 'ibm-plex-sans-arabic-normal-600-latin.woff2', assetModule: require('@/assets/fonts/ibm-plex-sans-arabic-normal-600-latin.woff2') as number },
  { fileName: 'inter-normal-300-700-latin-ext.woff2', assetModule: require('@/assets/fonts/inter-normal-300-700-latin-ext.woff2') as number },
  { fileName: 'inter-normal-300-700-latin.woff2', assetModule: require('@/assets/fonts/inter-normal-300-700-latin.woff2') as number },
  { fileName: 'literata-italic-300-700-latin-ext.woff2', assetModule: require('@/assets/fonts/literata-italic-300-700-latin-ext.woff2') as number },
  { fileName: 'literata-italic-300-700-latin.woff2', assetModule: require('@/assets/fonts/literata-italic-300-700-latin.woff2') as number },
  { fileName: 'literata-normal-300-700-latin-ext.woff2', assetModule: require('@/assets/fonts/literata-normal-300-700-latin-ext.woff2') as number },
  { fileName: 'literata-normal-300-700-latin.woff2', assetModule: require('@/assets/fonts/literata-normal-300-700-latin.woff2') as number },
  { fileName: 'merriweather-italic-300-700-latin-ext.woff2', assetModule: require('@/assets/fonts/merriweather-italic-300-700-latin-ext.woff2') as number },
  { fileName: 'merriweather-italic-300-700-latin.woff2', assetModule: require('@/assets/fonts/merriweather-italic-300-700-latin.woff2') as number },
  { fileName: 'merriweather-normal-300-700-latin-ext.woff2', assetModule: require('@/assets/fonts/merriweather-normal-300-700-latin-ext.woff2') as number },
  { fileName: 'merriweather-normal-300-700-latin.woff2', assetModule: require('@/assets/fonts/merriweather-normal-300-700-latin.woff2') as number },
  { fileName: 'noto-naskh-arabic-normal-400-700-arabic.woff2', assetModule: require('@/assets/fonts/noto-naskh-arabic-normal-400-700-arabic.woff2') as number },
  { fileName: 'noto-naskh-arabic-normal-400-700-latin-ext.woff2', assetModule: require('@/assets/fonts/noto-naskh-arabic-normal-400-700-latin-ext.woff2') as number },
  { fileName: 'noto-naskh-arabic-normal-400-700-latin.woff2', assetModule: require('@/assets/fonts/noto-naskh-arabic-normal-400-700-latin.woff2') as number },
  { fileName: 'readex-pro-normal-300-700-arabic.woff2', assetModule: require('@/assets/fonts/readex-pro-normal-300-700-arabic.woff2') as number },
  { fileName: 'readex-pro-normal-300-700-latin-ext.woff2', assetModule: require('@/assets/fonts/readex-pro-normal-300-700-latin-ext.woff2') as number },
  { fileName: 'readex-pro-normal-300-700-latin.woff2', assetModule: require('@/assets/fonts/readex-pro-normal-300-700-latin.woff2') as number },
  { fileName: 'scheherazade-new-normal-400-arabic.woff2', assetModule: require('@/assets/fonts/scheherazade-new-normal-400-arabic.woff2') as number },
  { fileName: 'scheherazade-new-normal-400-latin-ext.woff2', assetModule: require('@/assets/fonts/scheherazade-new-normal-400-latin-ext.woff2') as number },
  { fileName: 'scheherazade-new-normal-400-latin.woff2', assetModule: require('@/assets/fonts/scheherazade-new-normal-400-latin.woff2') as number },
  { fileName: 'scheherazade-new-normal-500-arabic.woff2', assetModule: require('@/assets/fonts/scheherazade-new-normal-500-arabic.woff2') as number },
  { fileName: 'scheherazade-new-normal-500-latin-ext.woff2', assetModule: require('@/assets/fonts/scheherazade-new-normal-500-latin-ext.woff2') as number },
  { fileName: 'scheherazade-new-normal-500-latin.woff2', assetModule: require('@/assets/fonts/scheherazade-new-normal-500-latin.woff2') as number },
  { fileName: 'scheherazade-new-normal-600-arabic.woff2', assetModule: require('@/assets/fonts/scheherazade-new-normal-600-arabic.woff2') as number },
  { fileName: 'scheherazade-new-normal-600-latin-ext.woff2', assetModule: require('@/assets/fonts/scheherazade-new-normal-600-latin-ext.woff2') as number },
  { fileName: 'scheherazade-new-normal-600-latin.woff2', assetModule: require('@/assets/fonts/scheherazade-new-normal-600-latin.woff2') as number },
  { fileName: 'scheherazade-new-normal-700-arabic.woff2', assetModule: require('@/assets/fonts/scheherazade-new-normal-700-arabic.woff2') as number },
  { fileName: 'scheherazade-new-normal-700-latin-ext.woff2', assetModule: require('@/assets/fonts/scheherazade-new-normal-700-latin-ext.woff2') as number },
  { fileName: 'scheherazade-new-normal-700-latin.woff2', assetModule: require('@/assets/fonts/scheherazade-new-normal-700-latin.woff2') as number },
];

let cachedFontDirPromise: Promise<string> | null = null;

export function getOfflineFontsDir(): Directory {
  return new Directory(Paths.cache, 'rewiaty-fonts');
}

export async function ensureOfflineFontsDir(): Promise<string> {
  if (!cachedFontDirPromise) {
    cachedFontDirPromise = (async () => {
      const fontsDir = getOfflineFontsDir();
      fontsDir.create({ intermediates: true, idempotent: true });

      await Promise.all(
        BUNDLED_FONT_ASSETS.map(async ({ fileName, assetModule }) => {
          const target = new File(fontsDir, fileName);
          if (target.exists && target.size > 0) return;
          const asset = Asset.fromModule(assetModule);
          await asset.downloadAsync();
          const srcUri = asset.localUri ?? asset.uri;
          if (!srcUri) return;
          const srcFile = new File(srcUri);
          const bytes = await srcFile.bytes();
          await target.write(bytes);
        }),
      );

      return fontsDir.uri.endsWith('/') ? fontsDir.uri : `${fontsDir.uri}/`;
    })().catch((err) => {
      cachedFontDirPromise = null;
      throw err;
    });
  }
  return cachedFontDirPromise;
}
