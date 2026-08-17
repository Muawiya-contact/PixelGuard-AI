/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          950: '#07090f',
          900: '#0b0e17',
          800: '#111527',
          700: '#1a2038',
        },
        accent: {
          DEFAULT: '#22d3ee',
          dim: '#0e7490',
        },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
}
