import { useWindowDimensions, PixelRatio } from 'react-native';

/**
 * Responsive scaling primitives for the app.
 *
 * The app is built around a 375×812 reference device (iPhone 13/14
 * mini class). Real users span ~320 (iPhone SE 1st gen) to 1024+
 * (iPad Pro). Without a scale system, hard-coded pixels read fine on
 * the reference device and either overflow on small phones or float
 * lost in white space on tablets.
 *
 * Three helpers, each with a different intent:
 *
 *  • `scale(n)` — proportional horizontal scale. Use for widths,
 *    margins, and any value that should grow ~linearly with screen
 *    width. A 200-pt button on the 375 reference device becomes
 *    ~228 pt on a 414-wide phone, ~169 pt on iPhone SE.
 *
 *  • `vScale(n)` — proportional vertical scale. Use for heights and
 *    vertical paddings. Pulled separately so landscape doesn't
 *    accidentally double everything.
 *
 *  • `mScale(n, factor=0.4)` — *moderate* scale. The same proportional
 *    delta is applied at a fraction of its full strength, so things
 *    grow/shrink, but never dramatically. This is the right choice
 *    for FONT SIZES and for UI chrome (button heights, icon boxes,
 *    border radii) — those should adjust subtly across devices, not
 *    look like a different design altogether on a tablet.
 *
 * NEVER call these at module scope (the value would be locked to
 * whatever orientation the JS bundle was first evaluated in). Use
 * them inside components via `useResponsive()`, or import the bare
 * helpers and pass `width` from `useWindowDimensions()` if you need
 * them inside a `StyleSheet.create()`-style memoised factory.
 */

// Reference device — chosen to match the tightest common iPhone width
// the design was prototyped for. Don't bump this without re-eyeballing
// every screen; downstream sizes are authored against it.
export const REF_WIDTH = 375;
export const REF_HEIGHT = 812;

// Breakpoints. Anything below `phoneSm` is iPhone SE / small Android;
// anything `tablet` and up should also pick up wider gutters and a
// max-width content container so paragraphs don't reflow to 100+ chars.
export const Breakpoints = {
  phoneSm: 360,
  phone: 400,
  phoneLg: 500,
  tablet: 720,
  desktop: 1024,
} as const;

export type ScreenClass = 'phoneSm' | 'phone' | 'phoneLg' | 'tablet' | 'desktop';

const classify = (width: number): ScreenClass => {
  if (width >= Breakpoints.desktop) return 'desktop';
  if (width >= Breakpoints.tablet) return 'tablet';
  if (width >= Breakpoints.phoneLg) return 'phoneLg';
  if (width >= Breakpoints.phoneSm) return 'phone';
  return 'phoneSm';
};

const round = (n: number) => PixelRatio.roundToNearestPixel(n);

/** Bare helpers — prefer `useResponsive()` in components. */
export const scaleFor = (width: number, n: number) => round((width / REF_WIDTH) * n);
export const vScaleFor = (height: number, n: number) => round((height / REF_HEIGHT) * n);
export const mScaleFor = (width: number, n: number, factor = 0.4) =>
  round(n + (scaleFor(width, n) - n) * factor);

/**
 * Container max-width. Phones get full width; tablets and larger
 * clamp to a readable column so cards and forms don't stretch to the
 * edge of an iPad. This is the single setting that fixes the bulk
 * of the "looks weird on iPad" complaints without per-screen work.
 */
export const containerMaxWidth = (width: number): number => {
  if (width >= Breakpoints.desktop) return 720;
  if (width >= Breakpoints.tablet) return 640;
  return width;
};

export interface Responsive {
  width: number;
  height: number;
  /** Coarse screen class — switch on this for layout-level decisions. */
  screen: ScreenClass;
  /** True for tablet+. Use to render two-column layouts, larger heroes, etc. */
  isTablet: boolean;
  /** True for iPhone SE-class devices. Use to drop optional padding /
   *  switch to a more compact variant of a component. */
  isCompact: boolean;
  /** Landscape orientation. */
  isLandscape: boolean;
  /** Centred content max-width — apply to top-level scrollviews. */
  contentMaxWidth: number;
  scale: (n: number) => number;
  vScale: (n: number) => number;
  /** Moderate scale — the right default for type / chrome sizing. */
  mScale: (n: number, factor?: number) => number;
}

/**
 * Subscribe a component to viewport changes. Re-renders on rotation
 * and on multi-window resize (iPad split view). All three scale
 * helpers are bound to the live width — call them inside `useMemo`
 * if you're using them to build a `StyleSheet.create`-style object
 * that's expensive to rebuild.
 */
export function useResponsive(): Responsive {
  const { width, height } = useWindowDimensions();
  const screen = classify(width);
  return {
    width,
    height,
    screen,
    isTablet: width >= Breakpoints.tablet,
    isCompact: width < Breakpoints.phoneSm,
    isLandscape: width > height,
    contentMaxWidth: containerMaxWidth(width),
    scale: (n) => scaleFor(width, n),
    vScale: (n) => vScaleFor(height, n),
    mScale: (n, factor = 0.4) => mScaleFor(width, n, factor),
  };
}
