/**
 * Font-scale (Dynamic Type) tokens.
 *
 * ── What the app actually does today ────────────────────────────────────
 * OS text scaling is ON. Every `Text` / `TextInput` honours the iOS
 * "Larger Text" slider and the Android "Font size" / "Display size"
 * settings, and grows without limit unless the component opts into a cap
 * by passing `maxFontSizeMultiplier`.
 *
 * That is deliberate — a low-vision user must be able to raise the system
 * font — but it means fixed-height chrome has to say so explicitly.
 *
 * ── Why there is no global default ──────────────────────────────────────
 * The historical way to set one app-wide was:
 *
 *     Text.defaultProps.allowFontScaling = false;      // ← DEAD
 *
 * That line lived in `src/app/_layout.tsx` and had silently stopped doing
 * anything. React 19 dropped `defaultProps` resolution for function
 * components, and this project compiles JSX with the automatic runtime
 * (`babel.config.js` → `babel-preset-expo`, `jsxImportSource: 'nativewind'`);
 * `react/cjs/react-jsx-runtime.*.js` contains zero references to
 * `defaultProps`. React Native's `Text` is a plain function component
 * (`Libraries/Text/Text.js` — both feature-flag branches are arrow
 * components), so nothing applied those defaults at runtime. Only the
 * legacy `React.createElement` path still resolves them, which is why any
 * third-party library still compiled that way DID get the lock — an
 * inconsistency, not a feature.
 *
 * The trap: `react-native/jest/setup.js` swaps `Text` for a CLASS mock, and
 * classes still resolve `defaultProps`, so a jest test can "prove" a global
 * lock that does not exist on a device. `src/constants/__tests__/fontScale.test.tsx`
 * pins the real behaviour instead.
 *
 * There is no React-19-safe way to set a global default short of aliasing
 * the `react-native` `Text` export to a wrapper — which would have to be
 * re-verified against NativeWind's `cssInterop`, and is not something to do
 * without a device pass. So caps are per-component and explicit.
 *
 * ── How to use these ────────────────────────────────────────────────────
 *   • CHROME  — anything in a fixed-height or side-by-side container: bars,
 *     pills, badges, buttons, tab labels, table-style label/value rows.
 *     Cap it. 1.3 is the multiplier the existing layouts were written
 *     against (see Button.tsx, Typography.tsx, ToastProvider.tsx).
 *   • NUMERAL — countdown / currency numerals sized by `lineHeight` inside
 *     a ring or disc, where even 1.3 clips.
 *   • BODY    — paragraphs, descriptions, headlines that are free to wrap
 *     and push their container taller. Do NOT cap these; leaving them
 *     uncapped is the accessibility win. `BODY_MAX_FONT_SCALE` exists only
 *     for body copy that sits inside a modal card which itself cannot grow
 *     past the viewport.
 */

/** Chrome: fixed-height / side-by-side layout. The layouts assume this. */
export const CHROME_MAX_FONT_SCALE = 1.3;

/** Numerals inside a fixed disc/ring where 1.3 already clips. */
export const NUMERAL_MAX_FONT_SCALE = 1.2;

/**
 * Body copy inside a container that cannot grow past the viewport
 * (e.g. a centred modal card). Ordinary scrolling body copy takes NO cap.
 */
export const BODY_MAX_FONT_SCALE = 1.6;
