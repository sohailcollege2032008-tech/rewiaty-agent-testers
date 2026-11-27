const fs = require('node:fs');
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const {
  resolveDictionaryAssetRequest,
} = require('./metro.dictionary-asset');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

const extraAssetExts = ['html', 'md', 'woff2', 'sqlite'];
for (const ext of extraAssetExts) {
  if (!config.resolver.assetExts.includes(ext)) {
    config.resolver.assetExts.push(ext);
  }
}

const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolveRequest = upstreamResolveRequest ?? context.resolveRequest;

  // F49: when the generated dictionary SQLite exists, the resolver indirection
  // loads it as an asset; otherwise it stays the plain `null` resolver module.
  const dictionaryAsset = resolveDictionaryAssetRequest(
    { projectRoot: __dirname },
    context,
    moduleName,
    platform,
    resolveRequest,
  );
  if (dictionaryAsset !== undefined) {
    return dictionaryAsset;
  }

  if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    const originDir = path.dirname(context.originModulePath);
    const jsCandidate = path.resolve(originDir, moduleName);
    const tsCandidate = path.resolve(originDir, `${moduleName.slice(0, -3)}.ts`);
    if (!fs.existsSync(jsCandidate) && fs.existsSync(tsCandidate)) {
      const resolvedName = moduleName.slice(0, -3);
      return resolveRequest(context, resolvedName, platform);
    }
  }
  return resolveRequest(context, moduleName, platform);
};

module.exports = config;
