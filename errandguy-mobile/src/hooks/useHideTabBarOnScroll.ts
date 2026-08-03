import { useCallback, useRef } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTabBarStore } from '../stores/tabBarStore';

// Ignore sub-threshold movement so a resting finger, momentum wobble or an
// iOS rubber-band bounce doesn't toggle the bar.
const DELTA_THRESHOLD = 10;
// Always keep the bar visible within this zone of the very top (and during
// iOS overscroll, where contentOffset.y goes negative).
const TOP_ZONE = 24;

/**
 * Auto-hide the bottom tab bar on scroll-down and reveal it on scroll-up.
 *
 * Spread the return value onto the screen's main vertical scroller:
 *
 *   const hideOnScroll = useHideTabBarOnScroll();
 *   <ScrollView {...hideOnScroll} … />        // or FlatList / SectionList
 *
 * The bar always returns to visible when the screen (re)gains focus, so the
 * default is "shown" unless the user is actively scrolling down.
 */
export function useHideTabBarOnScroll() {
  const setHidden = useTabBarStore((s) => s.setHidden);
  const show = useTabBarStore((s) => s.show);
  const lastY = useRef(0);

  // Default is visible: reset on focus, and again on blur so the next screen
  // starts from a shown bar regardless of how this one was left.
  useFocusEffect(
    useCallback(() => {
      show();
      lastY.current = 0;
      return () => show();
    }, [show]),
  );

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      // Near the top → always show, and re-anchor so the first pull away from
      // the top is measured from here.
      if (y <= TOP_ZONE) {
        show();
        lastY.current = y;
        return;
      }
      const dy = y - lastY.current;
      // Below threshold: don't re-anchor, so a slow steady scroll still
      // accumulates enough delta to eventually flip.
      if (Math.abs(dy) < DELTA_THRESHOLD) return;
      setHidden(dy > 0); // scrolling down → hide, up → show
      lastY.current = y;
    },
    [setHidden, show],
  );

  return { onScroll, scrollEventThrottle: 16 } as const;
}
