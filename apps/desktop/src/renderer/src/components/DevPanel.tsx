import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DevInfo } from '../../../shared/ipc'

function fpShort(fp: string | null): string {
  return fp ? fp.slice(0, 16) : '—'
}

/** Per-turn hit-rate polyline, 0–100%. */
function RateCurve({ rates }: { rates: number[] }): JSX.Element | null {
  const { t } = useTranslation()
  if (rates.length === 0) return <div className="dev-empty">{t('dev.noTurns')}</div>
  const W = 360
  const H = 80
  const PAD = 4
  const step = rates.length > 1 ? (W - PAD * 2) / (rates.length - 1) : 0
  const x = (i: number): number => PAD + i * step
  const y = (r: number): number => PAD + (1 - r) * (H - PAD * 2)
  const points = rates.map((r, i) => `${x(i).toFixed(1)},${y(r).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="dev-curve" role="img">
      {[0, 0.5, 1].map((g) => (
        <line key={g} x1={PAD} x2={W - PAD} y1={y(g)} y2={y(g)} className="dev-grid" />
      ))}
      <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
      {rates.map((r, i) => (
        <circle key={i} cx={x(i)} cy={y(r)} r="2" fill="var(--accent)">
          <title>{`#${i + 1} · ${(r * 100).toFixed(1)}%`}</title>
        </circle>
      ))}
    </svg>
  )
}

/**
 * Developer panel (Ctrl+Shift+D): locked stable-layer fingerprints,
 * per-turn hit-rate curve, and prefix-drift incidents — the cache debugging
 * surface behind the plain-words notices.
 */
export function DevPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const { t } = useTranslation()
  const [info, setInfo] = useState<DevInfo | null>(null)

  useEffect(() => {
    void window.api.dev.info().then(setInfo)
    // Refresh as turns complete; usage events arrive once per model turn.
    return window.api.agent.onEvent(({ event }) => {
      if (event.type === 'usage' || event.type === 'drift' || event.type === 'done') {
        void window.api.dev.info().then(setInfo)
      }
    })
  }, [])

  return (
    <div className="dev-panel mono">
      <div className="dev-head">
        <span className="dev-title">{t('dev.title')}</span>
        <button className="dev-close" onClick={onClose} aria-label="close">
          ✕
        </button>
      </div>

      {!info?.sessionId ? (
        <div className="dev-empty">{t('dev.noSession')}</div>
      ) : (
        <>
          <div className="dev-section-label">{t('dev.fingerprints')}</div>
          <div className="dev-fp-row">
            <span className="dev-fp-key">system</span>
            <span className="dev-fp-val" title={info.systemFp ?? ''}>
              {fpShort(info.systemFp)}
            </span>
          </div>
          <div className="dev-fp-row">
            <span className="dev-fp-key">tools</span>
            <span className="dev-fp-val" title={info.toolsFp ?? ''}>
              {fpShort(info.toolsFp)}
            </span>
          </div>

          <div className="dev-section-label">
            {t('dev.curve')} <span className="dev-dim">({info.turns.length})</span>
          </div>
          <RateCurve rates={info.turns.map((x) => x.rate)} />

          <div className="dev-section-label">{t('dev.drifts')}</div>
          {info.drifts.length === 0 ? (
            <div className="dev-empty">{t('dev.noDrift')}</div>
          ) : (
            info.drifts.map((d, i) => (
              <div key={i} className="dev-drift-row">
                <span className="dev-drift-layer">{d.layer}</span>
                <span>{t('dev.driftAt', { at: d.at })}</span>
                <span className="dev-dim">{d.ts.slice(11, 19)}</span>
              </div>
            ))
          )}

          <div className="dev-section-label">{t('dev.turns')}</div>
          <div className="dev-turns">
            {info.turns
              .slice(-30)
              .reverse()
              .map((x, i) => (
                <div key={i} className="dev-turn-row">
                  <span className="dev-dim">{x.ts.slice(11, 19)}</span>
                  <span>{x.model.replace('deepseek-', '')}</span>
                  <span>
                    {x.hit}/{x.hit + x.miss}
                  </span>
                  <span className={x.rate < 0.5 ? 'dev-rate-low' : ''}>
                    {(x.rate * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
          </div>
        </>
      )}
    </div>
  )
}
