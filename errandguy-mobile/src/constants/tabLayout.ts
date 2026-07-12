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

/** Visible tab bar height, excluding the OS safe-area inset. Each
 *  layout adds `insets.bottom` on top of this for the bar's real
 *  height so the icon row clears the home indicator.
 *
 *  Trimmed 64 → 52 over two passes: the bar read as too tall (a big empty
 *  band above the icons) once the QuickBook FAB moved out to straddle the
 *  top edge, and the runner bar (no FAB) felt taller still. 52 + inset is a
 *  compact, standard-height bar with the icon row centred. Shared by both
 *  the customer and runner tab shells. */
export const TAB_BAR_HEIGHT = 52;

/**
 * Reserved. The live bars are attached, full-width surfaces with a
 * top border (see the runner/customer `(tabs)/_layout`), not a
 * detached pill. These pill-geometry helpers below are not consumed
 * by any layout today; kept only in case a floating treatment is
 * later adopted. Do not assume the bar floats.
 */
export const TAB_BAR_FLOAT_GAP = 12;

/**
 * Reserved — see TAB_BAR_FLOAT_GAP. Unused by the current attached bar.
 */
export const TAB_BAR_SIDE_MARGIN = 16;

/**
 * Width of the empty centre gap in the customer tab bar that the
 * QuickBookFAB (52pt disc) docks into. Applied as marginRight /
 * marginLeft of half this value on the two middle tab items, so the
 * gap is real layout — glyph and touch slot stay aligned at every
 * device width (unlike a visual translateX nudge).
 */
export const TAB_BAR_CENTER_GAP = 56;

/**
 * Reserved — see TAB_BAR_FLOAT_GAP. Offset formula for a detached
 * pill bar; unused while the bar is attached to the screen bottom.
 */
export function tabBarBottomOffset(insetBottom: number): number {
  return Math.max(insetBottom, TAB_BAR_FLOAT_GAP) + TAB_BAR_FLOAT_GAP / 2;
}

/**
 * Generous bottom padding for scrollable content inside a tab so the
 * last row clears the attached bar + the overlaid QuickBookFAB. The
 * bar is opaque (content does not show through it), so this only has
 * to clear the bar height + FAB disc + breathing room; the OS
 * safe-area inset is reserved by the bar itself, not by this value.
 */
export const TAB_CONTENT_BOTTOM_INSET = 148;
