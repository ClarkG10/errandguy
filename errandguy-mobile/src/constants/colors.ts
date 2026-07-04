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

  // Status.
  danger: '#EF4444',
  dangerDark: '#DC2626',
  dangerSoft: '#FEE2E2',
  success: '#16A34A',
  successSoft: '#DCFCE7',
  successLight: '#F0FDF4',
  warning: '#F59E0B',
  warningSoft: '#FEF3C7',
  warningLight: '#FFFBEB',
  info: '#0EA5E9',
  infoSoft: '#E0F2FE',
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
  successSoft: '#0B2E1A',
  successLight: '#052E16',
  warning: '#F59E0B',
  warningSoft: '#3B2A0A',
  warningLight: '#422006',
  info: '#38BDF8',
  infoSoft: '#0B2A3F',
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
