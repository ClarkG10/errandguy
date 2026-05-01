/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './App.tsx',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        primary: '#2563EB',
        'primary-dark': '#1D4ED8',
        primaryDark: '#1D4ED8',
        'primary-light': '#EFF6FF',
        primaryLight: '#EFF6FF',
        'primary-muted': '#93C5FD',
        primaryMuted: '#93C5FD',
        'primary-50': '#EFF6FF',
        primary50: '#EFF6FF',
        'primary-100': '#DBEAFE',
        primary100: '#DBEAFE',
        'primary-500': '#3B82F6',
        primary500: '#3B82F6',
        'primary-600': '#2563EB',
        primary600: '#2563EB',
        'primary-700': '#1D4ED8',
        primary700: '#1D4ED8',
        surface: '#FFFFFF',
        background: '#F8FAFC',
        'text-primary': '#0F172A',
        textPrimary: '#0F172A',
        'text-secondary': '#64748B',
        textSecondary: '#64748B',
        'text-tertiary': '#64748B',
        textTertiary: '#64748B',
        // Subdued caption tone for `text-textMuted` (replaces previous
        // textTertiary which was too light against bg-background
        // — #94A3B8 on #F8FAFC failed WCAG AA at ~2.6:1).
        textMuted: '#94A3B8',
        divider: '#E2E8F0',
        danger: '#EF4444',
        'danger-dark': '#DC2626',
        dangerDark: '#DC2626',
        success: '#22C55E',
        'success-light': '#F0FDF4',
        successLight: '#F0FDF4',
        warning: '#F59E0B',
        'warning-light': '#FFFBEB',
        warningLight: '#FFFBEB',
        // Dark mode colors
        'surface-dark': '#0F172A',
        surfaceDark: '#0F172A',
        'background-dark': '#020617',
        backgroundDark: '#020617',
        'text-primary-dark': '#F1F5F9',
        textPrimaryDark: '#F1F5F9',
        'text-secondary-dark': '#94A3B8',
        textSecondaryDark: '#94A3B8',
        'divider-dark': '#1E293B',
        dividerDark: '#1E293B',
      },
      fontFamily: {
        // UI / friendly text — Quicksand. Aliased as `montserrat*` for
        // historical reasons; safe to keep so existing classNames don't
        // need touching.
        montserrat: ['Quicksand_400Regular'],
        'montserrat-semi': ['Quicksand_500Medium'],
        'montserrat-bold': ['Quicksand_700Bold'],
        // Data-dense / numeric / monospaced-feeling info — Inter. Use
        // these for prices, currency, fare breakdowns, distances, ETAs,
        // PIN codes, booking numbers, and any tabular display where
        // legibility at small sizes matters more than warmth.
        inter: ['Inter_400Regular'],
        'inter-medium': ['Inter_500Medium'],
        'inter-semi': ['Inter_600SemiBold'],
      },
      borderRadius: {
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '20px',
        '2xl': '24px',
        full: '9999px',
      },
      fontSize: {
        xs: '12px',
        sm: '14px',
        base: '16px',
        lg: '18px',
        xl: '20px',
        '2xl': '24px',
        '3xl': '30px',
      },
    },
  },
  plugins: [],
};
