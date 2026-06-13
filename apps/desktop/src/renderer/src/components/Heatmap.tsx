import { useTranslation } from 'react-i18next'
import type { DashboardStats } from '../../../shared/ipc'

/** UTC 'YYYY-MM-DD' for a Date — matches the day keys the main process emits. */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

const WEEKS = 17
const DAYS = WEEKS * 7 // 119 trailing days

/** Intensity bucket 0..4 from a day's request count. */
function level(requests: number): number {
  if (requests <= 0) return 0
  if (requests <= 2) return 1
  if (requests <= 5) return 2
  if (requests <= 10) return 3
  return 4
}

export function Heatmap({ data }: { data: DashboardStats['heatmap'] }): JSX.Element {
  const { t } = useTranslation()
  const counts = new Map(data.map((d) => [d.day, d.requests]))
  // Build the trailing-DAYS grid ending today, oldest first, as week columns.
  const today = new Date()
  const cells: Array<{ day: string; n: number }> = []
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setUTCDate(today.getUTCDate() - i)
    const day = isoDay(d)
    cells.push({ day, n: counts.get(day) ?? 0 })
  }
  const weeks: Array<typeof cells> = []
  for (let w = 0; w < WEEKS; w++) weeks.push(cells.slice(w * 7, w * 7 + 7))

  return (
    <div className="ach-heat">
      <div className="ach-heat-head">
        <span className="ach-card-label">{t('ach.heatTitle')}</span>
        <span className="ach-heat-legend">
          <span className="ach-card-label">{t('ach.heatLess')}</span>
          {[0, 1, 2, 3, 4].map((l) => (
            <i key={l} className={`ach-cell lvl${l}`} />
          ))}
          <span className="ach-card-label">{t('ach.heatMore')}</span>
        </span>
      </div>
      <div className="ach-heat-grid">
        {weeks.map((week, wi) => (
          <div key={wi} className="ach-heat-col">
            {week.map((c) => (
              <i
                key={c.day}
                className={`ach-cell lvl${level(c.n)} tip`}
                data-tip={`${new Date(c.day).toLocaleDateString()} · ${t('ach.heatCell', { n: c.n })}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
