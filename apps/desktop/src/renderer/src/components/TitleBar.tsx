import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Moon, Sun, Monitor } from 'lucide-react'
import { applyTheme, useThemePref } from '../hooks/useTheme'

export function TitleBar(): JSX.Element {
  const { t } = useTranslation()
  const [maximized, setMaximized] = useState(false)
  const pref = useThemePref()

  useEffect(() => {
    window.api.window.isMaximized().then(setMaximized)
    return window.api.window.onMaximizeChange(setMaximized)
  }, [])

  // Cycle the real preference (dark → system → light → …) so the button always
  // reflects the current mode and never silently clobbers 'auto'.
  const cycleTheme = (): void => {
    const next: typeof pref = pref === 'dark' ? 'system' : pref === 'system' ? 'light' : 'dark'
    applyTheme(next)
    void window.api.settings.set('theme', next)
  }

  const ThemeIcon = pref === 'system' ? Monitor : pref === 'light' ? Sun : Moon

  return (
    <div className="titlebar">
      <div className="titlebar-drag">
        <span className="titlebar-title">VibeSeek</span>
      </div>
      <div className="titlebar-controls">
        <button
          className="titlebar-btn"
          aria-label="theme"
          title={t('titlebar.theme')}
          onClick={cycleTheme}
        >
          <ThemeIcon size={12} />
        </button>
        <button
          className="titlebar-btn"
          aria-label="minimize"
          onClick={() => window.api.window.minimize()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button
          className="titlebar-btn"
          aria-label="maximize"
          onClick={() => window.api.window.maximize()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            {maximized ? (
              <path
                d="M2.5 3.5V2h5.5v5.5H6.5M1 4h5.5v5.5H1z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
              />
            ) : (
              <rect
                x="1.5"
                y="1.5"
                width="7"
                height="7"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
              />
            )}
          </svg>
        </button>
        <button
          className="titlebar-btn titlebar-btn-close"
          aria-label="close"
          onClick={() => window.api.window.close()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1" />
            <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
      </div>
    </div>
  )
}
