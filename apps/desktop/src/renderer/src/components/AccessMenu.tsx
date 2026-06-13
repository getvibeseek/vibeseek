import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

type AccessLevel = 'standard' | 'yolo'

interface AccessMenuProps {
  value: AccessLevel
  onChange: (v: AccessLevel) => void
}

/**
 * Codex-style access-level picker (二轮修订): a pill that opens an
 * upward menu where每档带一句说明 — the user picks the level up front instead
 * of decoding terse jargon. Plan is NOT here (it's a collaboration toggle).
 */
export function AccessMenu({ value, onChange }: AccessMenuProps): JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const options: Array<{ id: AccessLevel; icon: string; title: string; desc: string }> = [
    { id: 'standard', icon: '✋', title: t('access.ask'), desc: t('access.askDesc') },
    { id: 'yolo', icon: '⚡', title: t('access.full'), desc: t('access.fullDesc') },
  ]
  const current = options.find((o) => o.id === value) ?? options[0]

  return (
    <div className="access-wrap" ref={wrapRef}>
      <button
        className={value === 'yolo' ? 'capsule access-pill access-yolo' : 'capsule access-pill'}
        onClick={() => setOpen((v) => !v)}
      >
        {current.icon} {current.title} <span className="access-caret">{open ? '▾' : '▴'}</span>
      </button>
      {open && (
        <div className="access-menu">
          <div className="access-menu-head">{t('access.question')}</div>
          {options.map((o) => (
            <button
              key={o.id}
              className={o.id === value ? 'access-option selected' : 'access-option'}
              onClick={() => {
                onChange(o.id)
                setOpen(false)
              }}
            >
              <span className="access-icon">{o.icon}</span>
              <span className="access-text">
                <span className="access-title">{o.title}</span>
                <span className="access-desc">{o.desc}</span>
              </span>
              {o.id === value && <span className="access-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
