import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { yuan } from '../money'
import type { OverviewInfo } from '../../../shared/ipc'

function compact(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + 'k'
  return (n / 1_000_000).toFixed(2) + 'M'
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`
}

/** Context-occupancy ring: percent in the middle, window size beneath. */
function ContextRing({ used, total }: { used: number; total: number }): JSX.Element {
  const pct = total ? Math.min(1, used / total) : 0
  const R = 52
  const C = 2 * Math.PI * R
  return (
    <div className="ov-ring-wrap">
      <svg viewBox="0 0 140 140" width="140" height="140" role="img">
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--bg-3)" strokeWidth="10" />
        <circle
          cx="70"
          cy="70"
          r={R}
          fill="none"
          stroke={pct > 0.6 ? 'var(--warning)' : 'var(--accent)'}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${C * pct} ${C}`}
          transform="rotate(-90 70 70)"
          className="ov-ring-arc"
        />
        <text x="70" y="66" textAnchor="middle" className="ov-ring-big tnum">
          {compact(used)}
        </text>
        <text x="70" y="86" textAnchor="middle" className="ov-ring-sub tnum">
          / {compact(total)} tokens
        </text>
      </svg>
      <div className="ov-ring-pct tnum">{Math.round(pct * 100)}%</div>
    </div>
  )
}

function Row({
  color,
  label,
  value,
}: {
  color: string
  label: string
  value: string
}): JSX.Element {
  return (
    <div className="ov-row">
      <i className="ov-dot" style={{ background: color }} />
      <span className="ov-row-label">{label}</span>
      <span className="ov-row-val tnum">{value}</span>
    </div>
  )
}

function Cell({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="ov-cell">
      <div className="ach-card-label">{label}</div>
      <div className="ov-cell-val tnum">{value}</div>
    </div>
  )
}

/**
 * 概览 panel (吸收 Reasonix ContextPanel): context-window ring + token
 * breakdown + run metrics + cost + compaction/checkpoint state, live.
 */
export function OverviewPanel(): JSX.Element {
  const { t } = useTranslation()
  const [info, setInfo] = useState<OverviewInfo | null>(null)

  useEffect(() => {
    const fetchInfo = (): void => void window.api.overview.info().then(setInfo)
    fetchInfo()
    const offMeter = window.api.meter.onUpdate(fetchInfo)
    const offSession = window.api.session.onChange(fetchInfo)
    return () => {
      offMeter()
      offSession()
    }
  }, [])

  if (!info) return <div className="panel-empty prose dim">{t('common.loading')}</div>
  if (!info.sessionId) return <div className="panel-empty prose dim">{t('ov.noSession')}</div>

  const fmtTime = (iso: string | null): string =>
    iso ? new Date(iso).toLocaleTimeString('en-GB', { hour12: false }) : '—'

  return (
    <div className="ov">
      <div className="ov-section">
        <div className="panel-head">{t('ov.context')}</div>
        <ContextRing used={info.contextTokens} total={info.contextWindow} />
        <Row color="var(--accent)" label="Prompt" value={compact(info.promptTokens)} />
        <Row color="var(--success)" label="Completion" value={compact(info.completionTokens)} />
        <Row color="var(--warning)" label="Reasoning" value={compact(info.reasoningTokens)} />
      </div>

      <div className="ov-section">
        <div className="panel-head">{t('ov.run')}</div>
        <div className="ov-grid">
          <Cell
            label={t('ov.sessionTokens')}
            value={compact(info.promptTokens + info.completionTokens)}
          />
          <Cell label={t('ov.requests')} value={String(info.requests)} />
          <Cell
            label={t('ov.lastTask')}
            value={info.running ? t('ov.running') : info.lastTaskMs ? fmtMs(info.lastTaskMs) : '—'}
          />
        </div>
      </div>

      <div className="ov-section">
        <div className="panel-head">{t('ov.cost')}</div>
        <div className="ov-grid">
          <Cell label={t('ov.hitRate')} value={`${Math.round(info.hitRate * 100)}%`} />
          <Cell label={t('ov.spent')} value={yuan(info.cost)} />
          <Cell label={t('ov.saved')} value={yuan(info.saved)} />
        </div>
      </div>

      <div className="ov-section">
        <div className="panel-head">{t('ov.state')}</div>
        <div className="ov-grid">
          <Cell
            label={t('ov.compacted')}
            value={info.compactedAt ? fmtTime(info.compactedAt) : t('ov.notCompacted')}
          />
          <Cell
            label={t('ov.checkpoint')}
            value={info.checkpointAt ? fmtTime(info.checkpointAt) : t('ov.noCheckpoint')}
          />
        </div>
      </div>
    </div>
  )
}
