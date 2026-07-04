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
 * Gap between the floating pill tab bar and the OS safe-area edge.
 * The bar detaches from the screen bottom (2026 pill-nav pattern);
 * this is the breathing room under it. On devices with no bottom
 * inset (older Android hardware nav) the bar still floats this far
 * off the very bottom edge.
 */
export const TAB_BAR_FLOAT_GAP = 12;

/**
 * Side margin of the floating pill bar.
 */
export const TAB_BAR_SIDE_MARGIN = 16;

/**
 * Generous bottom padding for scrollable content inside a tab.
 * Equals tab-bar height + float gap + FAB clearance + breathing
 * room. The safe-area inset is added on top of this by each screen's
 * scroll container as needed — content scrolls behind the floating
 * pill, so the padding only has to clear the pill + FAB stack.
 */
export const TAB_CONTENT_BOTTOM_INSET = 148;
