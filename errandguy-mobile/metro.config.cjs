const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Stub native-only packages for web so the bundler doesn't fail.
const RNM_STUB = path.resolve(__dirname, 'src/__mocks__/react-native-maps.js');

const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Stub CSS imports from native-only packages
  if (
    moduleName.endsWith('.css') &&
    !moduleName.endsWith('global.css')
  ) {
    return { type: 'empty' };
  }
  // Stub react-native-maps on web
  if (
    platform === 'web' &&
    (moduleName === 'react-native-maps' ||
      moduleName.startsWith('react-native-maps/'))
  ) {
    return { type: 'sourceFile', filePath: RNM_STUB };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: './global.css' });
