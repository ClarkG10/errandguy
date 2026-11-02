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
        // Brand blue ramp — full Tailwind blue scale, exposed both
        // in dash- and camel-cased form so existing className usage
        // (e.g. `bg-primary50`, `text-primary600`) keeps working
        // while new code can use the dash form.
        primary: '#2563EB',
        'primary-dark': '#1D4ED8',
        primaryDark: '#1D4ED8',
        'primary-light': '#EFF6FF',
        primaryLight: '#EFF6FF',
        'primary-muted': '#93C5FD',
        primaryMuted: '#93C5FD',
        'primary-soft': '#DBEAFE',
        primarySoft: '#DBEAFE',
        'primary-50': '#EFF6FF',
        primary50: '#EFF6FF',
        'primary-100': '#DBEAFE',
        primary100: '#DBEAFE',
        'primary-200': '#BFDBFE',
        primary200: '#BFDBFE',
        'primary-300': '#93C5FD',
        primary300: '#93C5FD',
        'primary-400': '#60A5FA',
        primary400: '#60A5FA',
        'primary-500': '#3B82F6',
        primary500: '#3B82F6',
        'primary-600': '#2563EB',
        primary600: '#2563EB',
        'primary-700': '#1D4ED8',
        primary700: '#1D4ED8',
        'primary-800': '#1E40AF',
        primary800: '#1E40AF',
        'primary-900': '#1E3A8A',
        primary900: '#1E3A8A',

        // Surfaces — neutral near-white canvas; muted fill for inputs
        // and chips, faint blue tint reserved for selected states.
        surface: '#FFFFFF',
        'surface-muted': '#F4F6F8',
        surfaceMuted: '#F4F6F8',
        'surface-tinted': '#EFF4FF',
        surfaceTinted: '#EFF4FF',
        background: '#F7F8FA',

        // Ink / text.
        ink: '#0B1220',
        'text-primary': '#0F172A',
        textPrimary: '#0F172A',
        'text-secondary': '#475569',
        textSecondary: '#475569',
        'text-tertiary': '#64748B',
        textTertiary: '#64748B',
        textMuted: '#94A3B8',
        textInverse: '#FFFFFF',

        // Lines.
        divider: '#ECEFF3',
        'divider-strong': '#CBD5E1',
        dividerStrong: '#CBD5E1',

        // Status — soft-bg variants paired with full-strength fg.
        danger: '#EF4444',
        'danger-dark': '#B91C1C',
        dangerDark: '#B91C1C',
        'danger-soft': '#FEE2E2',
        dangerSoft: '#FEE2E2',
        success: '#16A34A',
        // Dark text rung for small status text on the soft/light washes
        // (mirrors danger-dark; base tones fail 4.5:1 there).
        'success-dark': '#15803D',
        successDark: '#15803D',
        'success-soft': '#DCFCE7',
        successSoft: '#DCFCE7',
        'success-light': '#F0FDF4',
        successLight: '#F0FDF4',
        warning: '#F59E0B',
        'warning-dark': '#B45309',
        warningDark: '#B45309',
        'warning-soft': '#FEF3C7',
        warningSoft: '#FEF3C7',
        'warning-light': '#FFFBEB',
        warningLight: '#FFFBEB',
        info: '#0EA5E9',
        'info-soft': '#E0F2FE',
        infoSoft: '#E0F2FE',

        // Dark mode.
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
        // Main UI face — Google Sans. The `montserrat*` / `inter*` class
        // names and the Quicksand_*/Inter_* family strings are historical;
        // those family names are aliased to the loaded Google Sans TTFs at
        // load time (see _layout.tsx useFonts), so every class below renders
        // in Google Sans without renaming 400+ usages.
        montserrat: ['Quicksand_400Regular'],
        'montserrat-semi': ['Quicksand_500Medium'],
        'montserrat-bold': ['Quicksand_700Bold'],
        inter: ['Inter_400Regular'],
        'inter-medium': ['Inter_500Medium'],
        'inter-semi': ['Inter_600SemiBold'],
        'inter-bold': ['Inter_700Bold'],
        // Light-weight accent role — actual Montserrat Light (the one true
        // Montserrat in the app). Use `font-light` for oversized, airy
        // display text where a thin weight reads as premium.
        light: ['Montserrat_300Light'],
      },
      borderRadius: {
        // "Modern soft" scale (July 2026) — subtler corners app-wide.
        // Mirrors src/constants/radius.ts. `full` stays round for
        // avatars / icon circles / count badges only; pill-shaped
        // controls (chips, CTAs) opt into a finite radius instead.
        sm: '8px',
        md: '10px',
        lg: '12px',
        xl: '14px',
        '2xl': '16px',
        '3xl': '20px',
        full: '9999px',
      },
      fontSize: {
        xs: '12px',
        sm: '13px',
        base: '15px',
        lg: '17px',
        xl: '19px',
        '2xl': '22px',
        '3xl': '30px',
        // Display size for screen heroes (home headline, earnings
        // total, fare on review).
        '4xl': '34px',
      },
    },
  },
  plugins: [],
};

