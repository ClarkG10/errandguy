import React from 'react';
import { Platform, Text, TextInput, StyleSheet } from 'react-native';

/**
 * iOS uses Apple's San Francisco (SF Pro) as its system typeface. Loading
 * Quicksand / Inter from Google Fonts on iOS adds startup cost and bytes for
 * no visual benefit \u2014 SF Pro is a superior, free-to-use system font that
 * users already expect. On iOS we therefore remap our font-family aliases to
 * `System` and translate the weight encoded in the family name into a real
 * `fontWeight`. Android keeps the loaded fonts so brand consistency is
 * preserved on platforms without an equivalent system typeface.
 *
 * Call `applySystemFontOnIOS()` once at app start (in the root layout) before
 * the first render.
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

export function applySystemFontOnIOS() {
  if (applied || Platform.OS !== 'ios') return;
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
