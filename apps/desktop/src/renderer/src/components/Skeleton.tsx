import { useTranslation } from 'react-i18next'

/** Shimmering placeholder block for loading states. */
export function Skeleton({ h = 14, w = '100%' }: { h?: number; w?: number | string }): JSX.Element {
  return <span className="skel" style={{ height: h, width: w }} />
}

/** A stat-card-shaped group of skeletons (grid of n cards). */
export function SkeletonCards({ n = 4 }: { n?: number }): JSX.Element {
  return (
    <div className="ach-stats">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="ach-stat">
          <Skeleton h={18} w={56} />
          <Skeleton h={10} w={40} />
        </div>
      ))}
    </div>
  )
}

/** Load-failure block with a retry button. */
export function LoadError({ onRetry }: { onRetry: () => void }): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="load-error">
      <span>{t('common.loadFailed')}</span>
      <button className="btn-ghost" onClick={onRetry}>
        {t('common.retry')}
      </button>
    </div>
  )
}

/** Friendly empty state for data surfaces with zero usage yet. */
export function EmptyData(): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="empty-state">
      <div className="empty-state-icon">🧾</div>
      <div className="empty-state-title">{t('dash.emptyTitle')}</div>
      <div className="empty-state-hint">{t('dash.emptyHint')}</div>
    </div>
  )
}
