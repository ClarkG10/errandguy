const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Stub native-only packages for web so the bundler doesn't fail.
const RNMAPBOX_STUB = path.resolve(__dirname, 'src/__mocks__/rnmapbox-stub.js');

const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Stub CSS imports from native-only packages (e.g. mapbox-gl/dist/mapbox-gl.css)
  // but NEVER stub global.css — that's NativeWind's entry point.
  if (
    moduleName.endsWith('.css') &&
    !moduleName.endsWith('global.css')
  ) {
    return { type: 'empty' };
  }
  // Stub mapbox native packages on web
  if (
    platform === 'web' &&
    (moduleName === '@rnmapbox/maps' ||
      moduleName === 'mapbox-gl' ||
      moduleName.startsWith('mapbox-gl/'))
  ) {
    return { type: 'sourceFile', filePath: RNMAPBOX_STUB };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: './global.css' });
