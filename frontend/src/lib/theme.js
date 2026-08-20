import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'pixelguard-theme'

export function resolveInitialTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // localStorage can throw in private mode or a sandboxed frame; fall through.
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function apply(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

/**
 * Theme state, persisted per browser.
 *
 * Until the user makes an explicit choice the OS preference wins and keeps
 * winning — someone whose machine flips to dark at sunset should see the app
 * follow. The moment they pick a side, that choice sticks and the OS listener
 * stops overriding it.
 */
export function useTheme() {
  const [theme, setTheme] = useState(resolveInitialTheme)

  useEffect(() => {
    apply(theme)
  }, [theme])

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return
    const onChange = (e) => {
      let explicit = null
      try {
        explicit = localStorage.getItem(STORAGE_KEY)
      } catch {
        explicit = null
      }
      if (explicit !== 'light' && explicit !== 'dark') setTheme(e.matches ? 'dark' : 'light')
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark'
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {
        // Persistence is a nicety; the toggle must still work without it.
      }
      return next
    })
  }, [])

  return { theme, toggle, isDark: theme === 'dark' }
}
