const fs = require('node:fs');
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

const extraAssetExts = ['html', 'md', 'woff2'];
for (const ext of extraAssetExts) {
  if (!config.resolver.assetExts.includes(ext)) {
    config.resolver.assetExts.push(ext);
  }
}

const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    const originDir = path.dirname(context.originModulePath);
    const jsCandidate = path.resolve(originDir, moduleName);
    const tsCandidate = path.resolve(originDir, `${moduleName.slice(0, -3)}.ts`);
    if (!fs.existsSync(jsCandidate) && fs.existsSync(tsCandidate)) {
      const resolvedName = moduleName.slice(0, -3);
      return (upstreamResolveRequest ?? context.resolveRequest)(context, resolvedName, platform);
    }
  }
  return (upstreamResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
