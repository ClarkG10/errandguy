import React from 'react';
import { Platform, Text, TextInput, StyleSheet } from 'react-native';

/**
 * Both platforms render UI text in their native system typeface \u2014 SF Pro on
 * iOS, Roboto on Android \u2014 by remapping our font-family aliases to `System`
 * and translating the weight encoded in the family name into a real
 * `fontWeight`.
 *
 * Why Android too (July 2026): Quicksand is a rounder, heavier display face
 * with a larger x-height and wider glyphs than Roboto/SF Pro, so the identical
 * point size rendered visibly *larger and bolder* on Android than iOS \u2014
 * buttons and labels read chunky and inconsistent across platforms. Using the
 * system font on both gives true cross-platform sizing parity (this is the
 * root cause behind "Android buttons are several times bigger"). It also drops
 * the startup cost of shipping Quicksand/Inter where a system font suffices.
 *
 * Call `applySystemFont()` once at app start (in the root layout) before the
 * first render.
 */

const FAMILY_TO_WEIGHT: Record<string, string> = {
  // Quicksand
  Quicksand_400Regular: '400',
  Quicksand_500Medium: '500',
  Quicksand_600SemiBold: '600',
  Quicksand_700Bold: '700',
  // Inter
  Inter_400Regular: '400',
  Inter_500Medium: '500',
  Inter_600SemiBold: '600',
  Inter_700Bold: '700',
};

const remapStyle = (style: any): any => {
  if (!style) return style;
  if (Array.isArray(style)) return style.map(remapStyle);

  // StyleSheet IDs are numbers \u2014 resolve them, then re-flatten.
  if (typeof style === 'number') {
    const flat = StyleSheet.flatten(style);
    return remapStyle(flat);
  }

  if (typeof style === 'object' && style.fontFamily && FAMILY_TO_WEIGHT[style.fontFamily]) {
    const weight = FAMILY_TO_WEIGHT[style.fontFamily];
    return { ...style, fontFamily: 'System', fontWeight: weight };
  }
  return style;
};

let applied = false;

export function applySystemFont() {
  // Web keeps the loaded webfonts (CSS handles fallbacks); native (iOS +
  // Android) remaps to the system typeface for cross-platform parity.
  if (applied || Platform.OS === 'web') return;
  applied = true;

  const patch = (Component: any) => {
    const original = Component.render;
    if (!original) return;
    Component.render = function patched(...args: any[]) {
      const elem = original.apply(this, args);
      if (!elem || !elem.props) return elem;
      const nextStyle = remapStyle(elem.props.style);
      if (nextStyle === elem.props.style) return elem;
      return React.cloneElement(elem, { style: nextStyle });
    };
  };

  patch(Text);
  patch(TextInput);
}

/** @deprecated Renamed to `applySystemFont` — now applies on Android too. */
export const applySystemFontOnIOS = applySystemFont;
