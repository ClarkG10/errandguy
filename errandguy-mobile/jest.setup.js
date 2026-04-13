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

// Mock @rnmapbox/maps
jest.mock('@rnmapbox/maps', () => ({
  default: {
    setAccessToken: jest.fn(),
    StyleURL: { Street: 'mapbox://styles/mapbox/streets-v12' },
  },
  MapView: 'MapView',
  Camera: 'Camera',
  MarkerView: 'MarkerView',
  PointAnnotation: 'PointAnnotation',
  ShapeSource: 'ShapeSource',
  LineLayer: 'LineLayer',
  FillLayer: 'FillLayer',
  UserLocation: 'UserLocation',
}));

// Mock lottie-react-native
jest.mock('lottie-react-native', () => 'LottieView');

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
