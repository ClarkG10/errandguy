import React from 'react';
import { Platform, Text, TextInput, StyleSheet } from 'react-native';

/**
 * Renders UI text in Google Sans (the app's main face) by remapping the
 * legacy Quicksand/Inter family-name aliases used throughout the codebase to
 * the matching loaded GoogleSans weight. Montserrat Light is loaded for the
 * light-accent role. This keeps every existing `font-*` class / fontFamily
 * literal working without rewriting each screen.
 *
 * Call `applySystemFont()` once at app start (in the root layout) before the
 * first render.
 */

const FAMILY_TO_GOOGLE: Record<string, string> = {
  Quicksand_400Regular: 'GoogleSans_400Regular',
  Quicksand_500Medium: 'GoogleSans_500Medium',
  Quicksand_600SemiBold: 'GoogleSans_600SemiBold',
  Quicksand_700Bold: 'GoogleSans_700Bold',
  Inter_400Regular: 'GoogleSans_400Regular',
  Inter_500Medium: 'GoogleSans_500Medium',
  Inter_600SemiBold: 'GoogleSans_600SemiBold',
  Inter_700Bold: 'GoogleSans_700Bold',
};

const remapStyle = (style: any): any => {
  if (!style) return style;
  if (Array.isArray(style)) return style.map(remapStyle);

  // StyleSheet IDs are numbers \u2014 resolve them, then re-flatten.
  if (typeof style === 'number') {
    const flat = StyleSheet.flatten(style);
    return remapStyle(flat);
  }

  if (typeof style === 'object' && style.fontFamily && FAMILY_TO_GOOGLE[style.fontFamily]) {
    // The weighted family is authoritative; drop any explicit fontWeight so
    // Android doesn't faux-bold on top of it.
    return { ...style, fontFamily: FAMILY_TO_GOOGLE[style.fontFamily], fontWeight: undefined };
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
