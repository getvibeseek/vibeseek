import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export type Thinking = 'off' | 'high' | 'max' | 'auto'

interface ModelPickerProps {
  model: string
  thinking: Thinking
  onChange: (model: string, thinking: Thinking) => void
}

const MODEL_LABEL: Record<string, string> = {
  auto: '', // filled from i18n below
  'deepseek-v4-flash': 'v4-flash',
  'deepseek-v4-pro': 'v4-pro',
}

/**
 * Two-segment bubble picker (两段式): model on top, thinking effort
 * below — replaces the two native <select>s. Selection is remembered per
 * project by the host (按项目记忆).
 */
export function ModelPicker({ model, thinking, onChange }: ModelPickerProps): JSX.Element {
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

  const models: Array<{ id: string; title: string; desc: string }> = [
    { id: 'auto', title: t('route.auto'), desc: t('picker.autoDesc') },
    { id: 'deepseek-v4-flash', title: 'v4-flash', desc: t('picker.flashDesc') },
    { id: 'deepseek-v4-pro', title: 'v4-pro', desc: t('picker.proDesc') },
  ]
  const thinkings: Array<{ id: Thinking; title: string }> = [
    { id: 'auto', title: t('picker.thinkAuto') },
    { id: 'off', title: t('picker.thinkOff') },
    { id: 'high', title: t('picker.thinkHigh') },
    { id: 'max', title: t('picker.thinkMax') },
  ]

  const modelLabel = model === 'auto' ? t('route.auto') : (MODEL_LABEL[model] ?? model)
  const thinkLabel = thinkings.find((x) => x.id === thinking)?.title ?? thinking

  return (
    <div className="access-wrap" ref={wrapRef}>
      <button className="capsule mono model-pill" onClick={() => setOpen((v) => !v)}>
        {modelLabel} · {thinkLabel} <span className="access-caret">{open ? '▾' : '▴'}</span>
      </button>
      {open && (
        <div className="access-menu model-menu">
          <div className="access-menu-head">{t('picker.modelHead')}</div>
          {models.map((m) => (
            <button
              key={m.id}
              className={m.id === model ? 'access-option selected' : 'access-option'}
              onClick={() => onChange(m.id, thinking)}
            >
              <span className="access-text">
                <span className="access-title mono">{m.title}</span>
                <span className="access-desc">{m.desc}</span>
              </span>
              {m.id === model && <span className="access-check">✓</span>}
            </button>
          ))}
          <div className="access-menu-head model-think-head">{t('picker.thinkHead')}</div>
          <div className="model-think-row">
            {thinkings.map((x) => (
              <button
                key={x.id}
                className={x.id === thinking ? 'model-think selected' : 'model-think'}
                onClick={() => onChange(model, x.id)}
              >
                {x.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
