/**
 * ErrandGuy design tokens — blue-first identity.
 *
 * The app revolves around a single, confident brand blue (`primary` =
 * #2563EB / Tailwind blue-600) used for every primary CTA, active
 * state, focus ring, navigation highlight, progress indicator and
 * accent. Surrounding neutrals stay cool slate so the blue always
 * reads as the figure.
 *
 * Token layering:
 *   • `primary50…900` — full brand ramp (Tailwind blue scale).
 *   • `primary` / `primaryDark` / `primaryLight` / `primaryMuted` —
 *     semantic aliases preserved for backward compatibility.
 *   • `gradientStart/Mid/End` — three-stop brand gradient used by
 *     the GradientHeader and hero CTAs.
 *   • `ink` — near-black for headlines (warmer than pure black so
 *     the blue accents pop).
 *   • `surface` / `surfaceMuted` / `surfaceTinted` — three white-to-
 *     blue tints for stacking cards on neutral backgrounds.
 */
export const LightColors = {
  // Brand ramp — full Tailwind blue scale.
  primary50: '#EFF6FF',
  primary100: '#DBEAFE',
  primary200: '#BFDBFE',
  primary300: '#93C5FD',
  primary400: '#60A5FA',
  primary500: '#3B82F6',
  primary600: '#2563EB',
  primary700: '#1D4ED8',
  primary800: '#1E40AF',
  primary900: '#1E3A8A',

  // Semantic aliases.
  primary: '#2563EB',
  primaryDark: '#1D4ED8',
  primaryLight: '#EFF6FF',
  primaryMuted: '#93C5FD',
  primarySoft: '#DBEAFE',

  // Brand gradient stops (hero moments only: home hero, welcome, FAB).
  // Deliberately calm — deep → core → core reads as a subtle sheen
  // rather than a candy gradient. Three stops kept so call sites
  // expecting a triple don't break.
  gradientStart: '#1E40AF',
  gradientMid: '#2563EB',
  gradientEnd: '#2563EB',

  // Surfaces — neutral near-white canvas; blue lives in accents only.
  surface: '#FFFFFF',
  surfaceMuted: '#F4F6F8',
  surfaceTinted: '#EFF4FF',
  background: '#F7F8FA',

  // Ink / text.
  ink: '#0B1220',
  textPrimary: '#0F172A',
  textSecondary: '#475569',
  textTertiary: '#64748B',
  textMuted: '#94A3B8',
  textInverse: '#FFFFFF',

  // Lines.
  divider: '#ECEFF3',
  dividerStrong: '#CBD5E1',

  // Status. Convention: the base tone for fills/borders/glyphs, the
  // *Dark rung for status TEXT below ~17px (the base tones sit under the
  // 4.5:1 AA floor on their soft/light washes — e.g. success on
  // successLight is only ~3.2:1).
  danger: '#EF4444',
  // 700-weight rung (not 600): #DC2626 measured 3.95:1 on dangerSoft,
  // under the 4.5:1 AA floor for the error cards that pair them.
  dangerDark: '#B91C1C',
  dangerSoft: '#FEE2E2',
  success: '#16A34A',
  successDark: '#15803D',
  successSoft: '#DCFCE7',
  successLight: '#F0FDF4',
  warning: '#F59E0B',
  warningDark: '#B45309',
  warningSoft: '#FEF3C7',
  warningLight: '#FFFBEB',
  info: '#0EA5E9',
  infoSoft: '#E0F2FE',

  // ── Amber BRAND ACCENT — the "Guy" half of the wordmark ──────────────
  // Semantically DISTINCT from `warning` above: warning = caution / pending;
  // accent = brand warmth — rewards, ratings, earnings & premium highlights.
  // Deliberately one rung BRIGHTER than warning (amber-400 #FBBF24 vs
  // warning's amber-500 #F59E0B) so brand-gold and caution-amber never read
  // alike side by side. `accentStrong` (#F59E0B) is reserved for star fills /
  // small glyphs on white where the dense look must be preserved exactly.
  // NEVER use accent to mean a status, and never place an accent chip in the
  // same row as a warning chip (they'd blur).
  accent: '#FBBF24',
  accentStrong: '#F59E0B',
  accentDark: '#B45309',
  accentSoft: '#FEF0C7',
  accentLight: '#FFFAEC',
  accent50: '#FFFAEC',
  accent100: '#FEF0C7',
  accent200: '#FDE29A',
  accent300: '#FCD34D',
  accent400: '#FBBF24',
  accent500: '#F59E0B',
  accent600: '#D97706',
  accent700: '#B45309',
  accent800: '#92400E',
  accent900: '#78350F',
} as const;

export const DarkColors = {
  // Brand ramp shifts up one notch in the dark so blue still sings
  // against the deep navy background.
  primary50: '#0B1F3D',
  primary100: '#13294D',
  primary200: '#1E3A5F',
  primary300: '#1E40AF',
  primary400: '#2563EB',
  primary500: '#3B82F6',
  primary600: '#60A5FA',
  primary700: '#93C5FD',
  primary800: '#BFDBFE',
  primary900: '#DBEAFE',

  primary: '#3B82F6',
  primaryDark: '#2563EB',
  primaryLight: '#13294D',
  primaryMuted: '#60A5FA',
  primarySoft: '#1E3A5F',

  gradientStart: '#1E40AF',
  gradientMid: '#2563EB',
  gradientEnd: '#60A5FA',

  surface: '#0F172A',
  surfaceMuted: '#0B1220',
  surfaceTinted: '#13294D',
  background: '#020617',

  ink: '#F8FAFC',
  textPrimary: '#F1F5F9',
  textSecondary: '#CBD5E1',
  textTertiary: '#94A3B8',
  textMuted: '#64748B',
  textInverse: '#0F172A',

  divider: '#1E293B',
  dividerStrong: '#334155',

  danger: '#F87171',
  dangerDark: '#EF4444',
  dangerSoft: '#3B1212',
  success: '#22C55E',
  // In dark mode the "dark" (high-contrast text) rung is LIGHTER, not
  // darker — it must read on the dark soft washes.
  successDark: '#4ADE80',
  successSoft: '#0B2E1A',
  successLight: '#052E16',
  warning: '#F59E0B',
  warningDark: '#FBBF24',
  warningSoft: '#3B2A0A',
  warningLight: '#422006',
  info: '#38BDF8',
  infoSoft: '#0B2A3F',

  // Amber brand accent (dark). accentDark is pinned to #FCD34D — NOT
  // #FBBF24 — because DarkColors.warningDark already owns #FBBF24, so
  // reusing it would merge accent and warning in dark mode. See LightColors
  // for the semantic rules (accent = brand gold, never a status).
  accent: '#FBBF24',
  accentStrong: '#FBBF24',
  accentDark: '#FCD34D',
  accentSoft: '#40300A',
  accentLight: '#4A2A08',
  accent50: '#4A2A08',
  accent100: '#40300A',
  accent200: '#78350F',
  accent300: '#92400E',
  accent400: '#B45309',
  accent500: '#D97706',
  accent600: '#F59E0B',
  accent700: '#FBBF24',
  accent800: '#FCD34D',
  accent900: '#FDE29A',
} as const;

export type ColorToken = keyof typeof LightColors;

/**
 * Shadow / elevation presets tuned to the blue-first identity.
 * Use `Platform.select(...)` at the call site; these are the source
 * of truth so individual components stop hand-rolling shadow values.
 */
export const Elevation = {
  // Card-level lift — soft and diffuse: bigger offset + radius,
  // lower opacity, so cards float rather than sit on a hard edge.
  sm: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 1,
  },
  // Prominent cards, sticky bars.
  md: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 2,
  },
  // Sheets, bottom action bars, floating chrome.
  lg: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 5,
  },
  // Brand-tinted lift for primary CTAs and the QuickBook FAB.
  primary: {
    shadowColor: '#1D4ED8',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 5,
  },
} as const;
