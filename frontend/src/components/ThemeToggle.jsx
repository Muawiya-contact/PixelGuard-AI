import { Moon, Sun } from 'lucide-react'

/** Two-state switch. The icon shows the current theme, the label says what a click does. */
export default function ThemeToggle({ isDark, onToggle }) {
  return (
    <button
      onClick={onToggle}
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-raised text-muted transition-colors hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {isDark ? <Moon size={15} /> : <Sun size={15} />}
    </button>
  )
}
