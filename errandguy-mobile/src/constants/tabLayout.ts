/**
 * Layout constants for the tab-bar shell on customer + runner stacks.
 *
 * Centralised so that:
 *   • The QuickBookFAB knows exactly how high to sit above the bar.
 *   • Every scrollable tab screen knows exactly how much bottom
 *     padding to reserve so its last row never hides under the FAB
 *     or the bar's safe-area inset (the bug visible in the
 *     screenshot where the price text was clipped by the FAB disc).
 *
 * Import `TAB_CONTENT_BOTTOM_INSET` and pass it as
 * `contentContainerStyle.paddingBottom` on any FlatList /
 * SectionList / ScrollView that lives inside `(tabs)`.
 */

/** Visible tab bar height, excluding the OS safe-area inset. */
export const TAB_BAR_HEIGHT = 64;

/**
 * Generous bottom padding for scrollable content inside a tab.
 * Equals tab-bar height + FAB diameter + breathing room. Safe for
 * both notched and non-notched devices because the safe-area inset
 * is added on top of this by the OS via the tab bar style itself.
 */
export const TAB_CONTENT_BOTTOM_INSET = 132;
