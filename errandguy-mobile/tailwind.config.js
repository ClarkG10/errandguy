/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './App.tsx',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#2563EB',
        'primary-dark': '#3B82F6',
        'primary-light': '#DBEAFE',
        'primary-muted': '#93C5FD',
        surface: '#FFFFFF',
        background: '#F8FAFC',
        'text-primary': '#0F172A',
        'text-secondary': '#475569',
        divider: '#E2E8F0',
        danger: '#EF4444',
        'danger-dark': '#F87171',
        // Dark mode colors
        'surface-dark': '#0F172A',
        'background-dark': '#0A0F1E',
        'text-primary-dark': '#F1F5F9',
        'text-secondary-dark': '#94A3B8',
        'divider-dark': '#1E293B',
      },
      fontFamily: {
        montserrat: ['Montserrat_400Regular'],
        'montserrat-bold': ['Montserrat_700Bold'],
      },
      borderRadius: {
        sm: '6px',
        md: '10px',
        lg: '14px',
        xl: '20px',
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
