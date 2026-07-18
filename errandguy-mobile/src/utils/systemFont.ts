/**
 * Font wiring is now done at load time in the root layout: the loaded Google
 * Sans TTFs are registered under both their real `GoogleSans_*` names and the
 * legacy `Quicksand_*` / `Inter_*` aliases still referenced across the app
 * (via NativeWind `font-*` classes and inline `fontFamily` StyleSheet
 * literals). RN's font resolver maps those family names straight to Google
 * Sans, so no render-time remap is needed.
 *
 * This module used to monkey-patch `Text.render` / `TextInput.render` to
 * rewrite the family on every render. That was fragile under NativeWind v4
 * (it didn't reliably see the resolved fontFamily, so text fell back to the
 * OS face) and added a `cloneElement` cost to every text node. Load-time
 * aliasing replaces it entirely; this is kept as a no-op so existing callers
 * don't need to change.
 */
export function applySystemFont() {
  // Intentionally empty — see module doc. Fonts are aliased in _layout.tsx.
}

/** @deprecated Font wiring moved to load-time aliasing in the root layout. */
export const applySystemFontOnIOS = applySystemFont;
