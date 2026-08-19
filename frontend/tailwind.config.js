/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      // Semantic tokens backed by CSS variables (see index.css). Components
      // reference roles, not shades, so a theme swap is a variable change
      // rather than an edit to every element.
      colors: {
        bg: 'rgb(var(--pg-bg) / <alpha-value>)',
        card: 'rgb(var(--pg-card) / <alpha-value>)',
        raised: 'rgb(var(--pg-raised) / <alpha-value>)',
        line: 'rgb(var(--pg-line) / <alpha-value>)',
        fg: 'rgb(var(--pg-fg) / <alpha-value>)',
        muted: 'rgb(var(--pg-muted) / <alpha-value>)',
        faint: 'rgb(var(--pg-faint) / <alpha-value>)',
        accent: {
          DEFAULT: 'rgb(var(--pg-accent) / <alpha-value>)',
          on: 'rgb(var(--pg-accent-on) / <alpha-value>)',
        },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
}
