import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Settings } from '../views/Settings'

/**
 * Settings live in a modal overlay (修订) — the workspace stays put
 * behind it instead of being replaced. Esc / backdrop / × all close.
 */
export function SettingsModal({ onClose }: { onClose: () => void }): JSX.Element {
  const { t } = useTranslation()

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal settings-modal">
        <div className="settings-modal-head">
          <span className="settings-modal-title">{t('settings.title')}</span>
          <button className="settings-modal-close" aria-label="close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="settings-modal-body">
          <Settings />
        </div>
      </div>
    </div>
  )
}
