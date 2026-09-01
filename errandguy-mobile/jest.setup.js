import 'react-native-gesture-handler/jestSetup';

// Mock GestureDetector to be a simple children passthrough (avoids Reanimated useEvent calls)
jest.mock('react-native-gesture-handler', () => {
  const actual = jest.requireActual('react-native-gesture-handler');
  const RN = require('react-native');
  return {
    ...actual,
    GestureHandlerRootView: RN.View,
    GestureDetector: ({ children }) => children,
    Gesture: {
      Pan: jest.fn(() => {
        const handler = {
          onStart: jest.fn(function () { return this; }),
          onUpdate: jest.fn(function () { return this; }),
          onEnd: jest.fn(function () { return this; }),
          // Config builders the real RNGH Pan chain supports — every one
          // returns `this` so component code can chain them in any order.
          hitSlop: jest.fn(function () { return this; }),
          activeOffsetX: jest.fn(function () { return this; }),
          activeOffsetY: jest.fn(function () { return this; }),
          failOffsetX: jest.fn(function () { return this; }),
          failOffsetY: jest.fn(function () { return this; }),
        };
        return handler;
      }),
      Tap: jest.fn(() => ({
        onEnd: jest.fn(function () { return this; }),
      })),
    },
  };
});

// Mock expo-secure-store
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

// Mock expo-haptics
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'Light', Medium: 'Medium', Heavy: 'Heavy' },
  notificationAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 'Success', Warning: 'Warning', Error: 'Error' },
  selectionAsync: jest.fn(() => Promise.resolve()),
}));

// Mock expo-router
jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    navigate: jest.fn(),
  })),
  useLocalSearchParams: jest.fn(() => ({})),
  useSegments: jest.fn(() => []),
  Link: 'Link',
  Redirect: 'Redirect',
  Stack: { Screen: 'Stack.Screen' },
  Tabs: { Screen: 'Tabs.Screen' },
}));

// Mock @maplibre/maplibre-react-native (replaces the older @rnmapbox/maps
// dependency \u2014 keep the mocked surface aligned with what
// `src/components/map/index.tsx` actually imports so test suites that
// pull in the map wrapper transitively don't blow up at module load.)
jest.mock('@maplibre/maplibre-react-native', () => ({
  Map: 'Map',
  Camera: 'Camera',
  CameraRef: 'CameraRef',
  UserLocation: 'UserLocation',
  GeoJSONSource: 'GeoJSONSource',
  Layer: 'Layer',
  Marker: 'Marker',
}));
// Mock AsyncStorage — the package ships a Jest mock at
// `mock/async-storage` but importing it via jest.mock wires the right
// in-memory shim so stores that depend on AsyncStorage (authStore,
// bookingStore, etc.) load cleanly under jest-expo.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
// Mock expo-location
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  getCurrentPositionAsync: jest.fn(() => Promise.resolve({
    coords: { latitude: 14.5995, longitude: 120.9842, accuracy: 5 },
  })),
  watchPositionAsync: jest.fn(() => Promise.resolve({ remove: jest.fn() })),
  Accuracy: { High: 'high', Balanced: 'balanced' },
}));

// Mock expo-image-picker
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(() => Promise.resolve({ canceled: true })),
  launchCameraAsync: jest.fn(() => Promise.resolve({ canceled: true })),
  MediaTypeOptions: { Images: 'Images', All: 'All' },
  requestMediaLibraryPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
}));

// Mock expo-image (optimized image component)
jest.mock('expo-image', () => {
  const RN = require('react-native');
  return {
    Image: RN.Image,
  };
});

// Mock react-native-reanimated is handled via moduleNameMapper in jest.config.js

// Suppress console warnings in tests
const originalWarn = console.warn;
beforeAll(() => {
  console.warn = (...args) => {
    if (
      args[0]?.includes?.('NativeAnimatedHelper') ||
      args[0]?.includes?.('useNativeDriver') ||
      args[0]?.includes?.('act(')
    ) return;
    originalWarn(...args);
  };
});
afterAll(() => {
  console.warn = originalWarn;
});
