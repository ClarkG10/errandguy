import { create } from 'zustand';

interface TabBarState {
  /** Whether the bottom tab bar (and the QuickBook FAB) are slid out of view. */
  hidden: boolean;
  setHidden: (hidden: boolean) => void;
  /** Force the bar visible — used on tab-screen focus so a new screen never
   *  inherits a hidden bar. */
  show: () => void;
}

/**
 * Visibility of the bottom tab bar + QuickBook FAB.
 *
 * `useHideTabBarOnScroll` flips `hidden` on sustained scroll-down / -up from
 * each tab screen; `HidingTabBar` and `QuickBookFAB` animate to it. Default is
 * visible, and every tab-screen focus resets it to visible.
 *
 * Writes are guarded so a scroll handler that keeps detecting the same
 * direction every frame doesn't re-render subscribers — state only changes on
 * an actual direction flip, which is infrequent.
 */
export const useTabBarStore = create<TabBarState>((set) => ({
  hidden: false,
  setHidden: (hidden) => set((s) => (s.hidden === hidden ? s : { hidden })),
  show: () => set((s) => (s.hidden ? { hidden: false } : s)),
}));
