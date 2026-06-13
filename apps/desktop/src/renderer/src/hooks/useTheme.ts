import { useEffect, useState } from 'react'
import type { Settings } from '../../../shared/settings'

type Theme = Settings['theme']

const mq = window.matchMedia('(prefers-color-scheme: dark)')

// The active PREFERENCE ('system' included); the resolved value lands on
// <html data-theme> which all CSS and canvas colors read.
let currentPref: Theme = 'dark'

// Subscribers to the active preference. One source of truth keeps the title-bar
// toggle and the settings panel in sync — without this the toggle reads a stale
// two-state value and clobbers 'system' (the "stuck button" bug).
const listeners = new Set<() => void>()

/** Resolve + apply a theme preference ('system' follows the OS). */
export function applyTheme(pref: Theme): void {
  currentPref = pref
  document.documentElement.dataset.theme =
    pref === 'system' ? (mq.matches ? 'dark' : 'light') : pref
  listeners.forEach((fn) => fn())
}

// OS theme flips re-resolve only while in 'system' mode (module-level: the
// listener must outlive any one component).
mq.addEventListener('change', () => {
  if (currentPref === 'system') applyTheme('system')
})

/** Subscribe to the active theme PREFERENCE (incl. 'system'), reactively. */
export function useThemePref(): Theme {
  const [pref, setPref] = useState<Theme>(currentPref)
  useEffect(() => {
    const sync = (): void => setPref(currentPref)
    listeners.add(sync)
    sync()
    return () => {
      listeners.delete(sync)
    }
  }, [])
  return pref
}

/**
 * Loads the persisted theme and applies it to <html data-theme>. Default (dark)
 * is already the CSS :root, so the initial paint matches and there's no flash.
 */
export function useTheme(): { theme: Theme; setTheme: (t: Theme) => void } {
  const theme = useThemePref()

  useEffect(() => {
    window.api.settings.getAll().then((s) => applyTheme(s.theme))
  }, [])

  const setTheme = (t: Theme): void => {
    applyTheme(t)
    window.api.settings.set('theme', t)
  }

  return { theme, setTheme }
}
