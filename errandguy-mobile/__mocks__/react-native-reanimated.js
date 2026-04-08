// Manual mock for react-native-reanimated v4
// Avoids loading the actual native module which requires worklets initialization

const React = require('react');
const { View, Text, Image, ScrollView, FlatList } = require('react-native');

const useSharedValue = (init) => ({ value: init });
const useAnimatedStyle = (fn) => { try { return fn(); } catch { return {}; } };
const useEvent = (handler) => handler;
const useHandler = (handlers) => ({ context: {}, doDependenciesDiffer: false, useWeb: false });
const withSpring = (val) => val;
const withTiming = (val) => val;
const withDelay = (_, val) => val;
const withRepeat = (val) => val;
const withSequence = (...vals) => vals[vals.length - 1];
const runOnJS = (fn) => fn;
const runOnUI = (fn) => fn;
const cancelAnimation = () => {};
const interpolate = (val, input, output) => output[0];
const Extrapolation = { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' };
const useAnimatedScrollHandler = () => ({});
const useAnimatedRef = () => React.createRef();
const useAnimatedGestureHandler = () => ({});
const useDerivedValue = (fn) => ({ value: fn() });
const useAnimatedReaction = () => {};
const useScrollViewOffset = () => ({ value: 0 });
const measure = () => null;
const scrollTo = () => {};
const Easing = {
  linear: (t) => t,
  ease: (t) => t,
  quad: (t) => t,
  bezier: () => (t) => t,
  in: (fn) => fn,
  out: (fn) => fn,
  inOut: (fn) => fn,
};
const FadeIn = { duration: () => FadeIn };
const FadeOut = { duration: () => FadeOut };
const SlideInRight = { duration: () => SlideInRight };
const SlideOutLeft = { duration: () => SlideOutLeft };
const Layout = { duration: () => Layout };

const Animated = {
  View,
  Text,
  Image,
  ScrollView,
  FlatList,
  createAnimatedComponent: (Component) => Component,
};

module.exports = {
  __esModule: true,
  default: Animated,
  Animated,
  useSharedValue,
  useAnimatedStyle,
  useEvent,
  useHandler,
  withSpring,
  withTiming,
  withDelay,
  withRepeat,
  withSequence,
  runOnJS,
  runOnUI,
  cancelAnimation,
  interpolate,
  Extrapolation,
  useAnimatedScrollHandler,
  useAnimatedRef,
  useAnimatedGestureHandler,
  useDerivedValue,
  useAnimatedReaction,
  useScrollViewOffset,
  measure,
  scrollTo,
  Easing,
  FadeIn,
  FadeOut,
  SlideInRight,
  SlideOutLeft,
  Layout,
  SharedValue: {},
  makeMutable: (val) => ({ value: val }),
  setUpTests: () => {},
  advanceAnimationByFrame: () => {},
  advanceAnimationByTime: () => {},
  getAnimatedStyle: () => ({}),
  withReanimatedTimer: (fn) => fn(),
  reanimatedVersion: '4.0.0',
  ReduceMotion: { System: 'system', Always: 'always', Never: 'never' },
};
