export const LightColors = {
  primary: '#2563EB',
  primaryDark: '#3B82F6',
  primaryLight: '#DBEAFE',
  primaryMuted: '#93C5FD',
  surface: '#FFFFFF',
  background: '#F8FAFC',
  textPrimary: '#0F172A',
  textSecondary: '#475569',
  divider: '#E2E8F0',
  danger: '#EF4444',
  dangerDark: '#F87171',
  success: '#22C55E',
} as const;

export const DarkColors = {
  primary: '#3B82F6',
  primaryDark: '#3B82F6',
  primaryLight: '#1D3461',
  primaryMuted: '#60A5FA',
  surface: '#0F172A',
  background: '#0A0F1E',
  textPrimary: '#F1F5F9',
  textSecondary: '#94A3B8',
  divider: '#1E293B',
  danger: '#F87171',
  dangerDark: '#F87171',
  success: '#22C55E',
} as const;

export type ColorToken = keyof typeof LightColors;
