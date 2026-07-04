/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        reader: {
          bg: '#f5f1e8',
          dark: '#1a1a2e',
          night: '#0f0f14',
          text: '#2c2c2a',
        }
      },
      fontFamily: {
        serif: ['Georgia', 'Noto Serif SC', 'serif'],
        sans: ['Inter', 'Noto Sans SC', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      }
    },
  },
  plugins: [],
}
