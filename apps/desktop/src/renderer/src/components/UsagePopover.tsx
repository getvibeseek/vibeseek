import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBalance } from '../hooks/useBalance'
import { yuan } from '../money'
import type { UsageSummary } from '../../../shared/ipc'

const SHORT_MODEL: Record<string, string> = {
  'deepseek-v4-flash': 'Flash',
  'deepseek-v4-pro': 'Pro',
}

/**
 * Usage popover anchored to the sidebar footer (修订: VibeSeek is an
 * API tool — there is no "account"; the bottom entry is usage & cost). Shows
 * balance detail, today's spend, all-time savings, and per-model lines.
 */
export function UsagePopover({ onClose }: { onClose: () => void }): JSX.Element {
  const { t } = useTranslation()
  const { state } = useBalance()
  const [summary, setSummary] = useState<UsageSummary | null>(null)

  useEffect(() => {
    void window.api.usage.summary().then(setSummary)
  }, [])

  // Outside-click closing lives in the Sidebar footer (owner of the open state)
  // so the trigger button cleanly toggles. Escape closes here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const info = state.status === 'ok' ? state.data.infos[0] : null

  return (
    <div className="usage-popover">
      <div className="usage-section">
        <div className="usage-row usage-headline">
          <span>{t('usage.balance')}</span>
          <span className="mono">{info ? `¥${Number(info.totalBalance).toFixed(2)}` : '—'}</span>
        </div>
        {info && (
          <div className="usage-row dim">
            <span>
              {t('balance.toppedUp')} ¥{Number(info.toppedUpBalance).toFixed(2)} ·{' '}
              {t('balance.granted')} ¥{Number(info.grantedBalance).toFixed(2)}
            </span>
          </div>
        )}
      </div>

      <div className="usage-divider" />

      <div className="usage-section">
        <div className="usage-row">
          <span>{t('usage.today')}</span>
          <span className="mono">{yuan(summary?.todayCost ?? 0)}</span>
        </div>
        <div className="usage-row">
          <span>{t('usage.total')}</span>
          <span className="mono">{yuan(summary?.totalCost ?? 0)}</span>
        </div>
        <div className="usage-row usage-saved">
          <span>{t('usage.saved')}</span>
          <span className="mono">{yuan(summary?.totalSaved ?? 0)}</span>
        </div>
      </div>

      {summary && summary.byModel.length > 0 && (
        <>
          <div className="usage-divider" />
          <div className="usage-section">
            {summary.byModel.map((m) => {
              const denom = m.hitTokens + m.missTokens
              const rateStr = denom ? ((m.hitTokens / denom) * 100).toFixed(0) : '—'
              return (
                <div key={m.model} className="usage-row dim">
                  <span className="mono">{SHORT_MODEL[m.model] ?? m.model}</span>
                  <span className="mono">
                    {t('usage.hit')} {rateStr}% · {yuan(m.cost)}
                  </span>
                </div>
              )
            })}
          </div>
        </>
      )}

      <div className="usage-divider" />
      <div className="usage-actions">
        <button className="btn-ghost" onClick={() => window.api.logs.openDir()}>
          {t('usage.openLogs')}
        </button>
      </div>
    </div>
  )
}
