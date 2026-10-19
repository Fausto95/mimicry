const path = require('node:path');

/**
 * Add Mimicry's browser-native control implementations to an Expo Metro config.
 *
 * Native iOS and Android bundles keep using the real @expo/ui.
 * Only the browser target redirects selected imports into the web emulation layer.
 */
function withMimicry(config, { runtime = path.resolve(__dirname, 'src/index.tsx') } = {}) {
  const previous = config.resolver?.resolveRequest;
  const aliases = new Set([
    '@expo/ui',
    '@expo/ui/swift-ui',
    '@expo/ui/jetpack-compose'
  ]);
  config.resolver = { ...config.resolver };
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (platform === 'web' && aliases.has(moduleName)) {
      return { type: 'sourceFile', filePath: runtime };
    }
    return previous
      ? previous(context, moduleName, platform)
      : context.resolveRequest(context, moduleName, platform);
  };
  config.watchFolders = [...new Set([...(config.watchFolders || []), path.resolve(__dirname, '../..')])];
  return config;
}
module.exports = { withMimicry };
