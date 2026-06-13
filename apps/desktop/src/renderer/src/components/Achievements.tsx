import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { yuan } from '../money'
import { useCountUp } from '../hooks/useCountUp'
import { DashboardPanel } from './DashboardPanel'
import { Heatmap } from './Heatmap'
import { LoadError, Skeleton, SkeletonCards } from './Skeleton'
import type { ReceiptTarget } from './ReceiptPopover'
import type { DashboardStats } from '../../../shared/ipc'

import { spotlightMove } from './fx/spotlight'

/** Greeting i18n key by local hour. */
function greetKey(hour: number): string {
  if (hour < 6) return 'ach.night'
  if (hour < 12) return 'ach.morning'
  if (hour < 18) return 'ach.afternoon'
  return 'ach.evening'
}

/** Compact large counts: 1234 → 1.2k, 3_400_000 → 3.4M. */
function compact(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + 'k'
  return (n / 1_000_000).toFixed(1) + 'M'
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}): JSX.Element {
  return (
    <div className="ach-stat spotlight" onMouseMove={spotlightMove}>
      <div className="ach-stat-value tnum">{value}</div>
      <div className="ach-card-label">{label}</div>
      {hint && <div className="ach-stat-hint">{hint}</div>}
    </div>
  )
}

export function Achievements({
  onPick,
  statsOpen,
  onToggleStats,
  onShowReceipt,
}: {
  onPick: (text: string) => void
  /** Expanded =「详细统计」: the concise summary is replaced by the full dashboard. */
  statsOpen: boolean
  onToggleStats: () => void
  onShowReceipt: (target: ReceiptTarget) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [failed, setFailed] = useState(false)

  const load = (): void => {
    setFailed(false)
    window.api.usage
      .stats()
      .then(setStats)
      .catch(() => setFailed(true))
  }

  useEffect(load, [])

  const heroAmount = useCountUp(stats?.monthSaved ?? 0)
  const greeting = t(greetKey(new Date().getHours()))
  const quick = ['ach.q1', 'ach.q2', 'ach.q3', 'ach.q4']

  // Discount in 折: paid / list * 10 (saved 90% ⇒ paid 10% ⇒ 1 折).
  // `percent` is the same ratio for locales without the 折 concept (en).
  const monthFull = stats ? stats.monthSaved + stats.monthCost : 0
  const tenths = monthFull > 0 ? ((stats!.monthCost / monthFull) * 10).toFixed(1) : null
  const percent = monthFull > 0 ? ((stats!.monthCost / monthFull) * 100).toFixed(0) : null

  // Cumulative text volume in PLAIN terms (user feedback: comparisons like
  // 三体/奶茶 don't land — say the number directly). ~1.5 chars per token for
  // mixed zh/code content; rough by design.
  const chars = stats ? stats.totalTokens * 1.5 : 0
  const funLine =
    chars >= 10_000
      ? t('ach.totalText', {
          wan: Math.round(chars / 10_000).toLocaleString('en-US'),
          m: (chars / 1_000_000).toFixed(1),
          tokens: compact(stats!.totalTokens),
        })
      : null

  return (
    <div className="ach">
      <div className="ach-head">
        <h1 className="ach-greet">{greeting}</h1>
        <button className="btn-ghost ach-details" onClick={onToggleStats}>
          {statsOpen ? `${t('ach.collapseStats')} ▾` : `${t('ach.detailStats')} ▸`}
        </button>
      </div>

      {statsOpen ? (
        <DashboardPanel onShowReceipt={onShowReceipt} />
      ) : failed ? (
        <LoadError onRetry={load} />
      ) : !stats ? (
        <div className="ach-summary">
          <div className="ach-hero">
            <Skeleton h={14} w={130} />
            <div style={{ height: 8 }} />
            <Skeleton h={36} w={180} />
          </div>
          <SkeletonCards n={8} />
        </div>
      ) : (
        <div className="ach-summary">
          <div className="ach-hero glass">
            {stats.monthSaved > 0 ? (
              <>
                <div className="ach-hero-line">{t('ach.heroSaved')}</div>
                <div className="ach-hero-amount tnum shiny-text">{yuan(heroAmount, 2)}</div>
                {tenths && (
                  <div className="ach-hero-sub">{t('ach.heroDiscount', { tenths, percent })}</div>
                )}
              </>
            ) : (
              <div className="ach-hero-empty">{t('ach.heroNothing')}</div>
            )}
          </div>

          {stats && (
            <>
              <div className="ach-grid">
                <div className="ach-stats">
                  <Stat label={t('ach.statSessions')} value={compact(stats.sessions)} />
                  <Stat label={t('ach.statRequests')} value={compact(stats.requests)} />
                  <Stat label={t('ach.statTokens')} value={compact(stats.totalTokens)} />
                  <Stat
                    label={t('ach.statHitRate')}
                    value={`${Math.round(stats.hitRate * 100)}%`}
                  />
                  <Stat
                    label={t('ach.statStreak')}
                    value={`${stats.streak}`}
                    hint={t('ach.dayUnit')}
                  />
                  <Stat
                    label={t('ach.statActiveDays')}
                    value={`${stats.activeDays}`}
                    hint={t('ach.dayUnit')}
                  />
                  <Stat label={t('ach.statTotalSaved')} value={yuan(stats.totalSaved, 2)} />
                  <Stat label={t('ach.statTotalCost')} value={yuan(stats.totalCost, 2)} />
                  {stats.peakHour !== null && (
                    <Stat
                      label={t('ach.statPeakHour')}
                      value={`${String(stats.peakHour).padStart(2, '0')}:00`}
                    />
                  )}
                  {stats.topModel && (
                    <Stat
                      label={t('ach.statTopModel')}
                      value={stats.topModel.replace('deepseek-', '')}
                    />
                  )}
                </div>
                <Heatmap data={stats.heatmap} />
              </div>

              {funLine && <div className="ach-fun">{funLine}</div>}
            </>
          )}
        </div>
      )}

      {!statsOpen && (
        <div className="ach-quick">
          <span className="ach-card-label">{t('ach.quickTitle')}</span>
          <div className="ach-quick-chips">
            {quick.map((k) => (
              <button key={k} className="ach-chip" onClick={() => onPick(t(k))}>
                {t(k)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
