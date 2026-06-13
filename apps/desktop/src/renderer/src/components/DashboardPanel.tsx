import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { yuan } from '../money'
import { Heatmap } from './Heatmap'
import { EmptyData, LoadError, SkeletonCards } from './Skeleton'
import { ReceiptText } from 'lucide-react'
import { spotlightMove } from './fx/spotlight'
import type { DashboardData, RequestCostPoint } from '../../../shared/ipc'
import type { ReceiptTarget } from './ReceiptPopover'

const MODEL_COLORS = ['#5d8bff', '#3ecf8e', '#e6a23c', '#ff6b6b', '#b58bff']
const SHORT_MODEL: Record<string, string> = {
  'deepseek-v4-flash': 'V4 Flash',
  'deepseek-v4-pro': 'V4 Pro',
}
const short = (m: string): string => SHORT_MODEL[m] ?? m

function compact(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + 'k'
  return (n / 1_000_000).toFixed(1) + 'M'
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: boolean
}): JSX.Element {
  return (
    <div className="dash-stat spotlight" onMouseMove={spotlightMove}>
      <div className={accent ? 'dash-stat-value tnum dash-accent' : 'dash-stat-value tnum'}>
        {value}
      </div>
      <div className="ach-card-label">{label}</div>
    </div>
  )
}

/** Stacked per-day token bars (SVG), one color per model. */
function DailyChart({
  data,
  colorOf,
}: {
  data: DashboardData['daily']
  colorOf: (m: string) => string
}): JSX.Element | null {
  const days = [...new Set(data.map((d) => d.day))].sort()
  if (days.length === 0) return null
  const byDay = new Map<string, Array<{ model: string; tokens: number }>>()
  for (const d of data) {
    const list = byDay.get(d.day) ?? []
    list.push({ model: d.model, tokens: d.tokens })
    byDay.set(d.day, list)
  }
  const maxDay = Math.max(
    ...days.map((d) => (byDay.get(d) ?? []).reduce((s, x) => s + x.tokens, 0))
  )
  const W = 640
  const H = 150
  const PAD = 4
  const bw = Math.max(3, Math.min(28, (W - PAD * 2) / days.length - 3))
  const step = (W - PAD * 2) / days.length

  return (
    <svg viewBox={`0 0 ${W} ${H + 18}`} width="100%" className="dash-chart" role="img">
      {days.map((day, i) => {
        const stack = byDay.get(day) ?? []
        let y = H
        return (
          <g key={day}>
            {stack.map((s) => {
              const h = maxDay ? (s.tokens / maxDay) * (H - 8) : 0
              y -= h
              return (
                <rect
                  key={s.model}
                  x={PAD + i * step + (step - bw) / 2}
                  y={y}
                  width={bw}
                  height={Math.max(h, s.tokens > 0 ? 1.5 : 0)}
                  rx="1.5"
                  fill={colorOf(s.model)}
                >
                  <title>{`${day} · ${short(s.model)} · ${compact(s.tokens)} tokens`}</title>
                </rect>
              )
            })}
          </g>
        )
      })}
      <text x={PAD} y={H + 14} className="dash-axis">
        {days[0]?.slice(5)}
      </text>
      <text x={W - PAD} y={H + 14} textAnchor="end" className="dash-axis">
        {days[days.length - 1]?.slice(5)}
      </text>
    </svg>
  )
}

/** Per-request stacked bars: hit / miss / output — "哪一轮破坏了缓存"一眼可见. */
function SessionTimeline({ points }: { points: RequestCostPoint[] }): JSX.Element {
  const { t } = useTranslation()
  if (points.length === 0) return <div className="dash-empty">{t('dash.noData')}</div>
  const max = Math.max(...points.map((p) => p.hit + p.miss + p.output))
  const H = 72
  const W = Math.max(160, points.length * 10)
  return (
    <div className="dash-timeline">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img">
        {points.map((p, i) => {
          const total = p.hit + p.miss + p.output
          const scale = max ? (H - 4) / max : 0
          const hHit = p.hit * scale
          const hMiss = p.miss * scale
          const hOut = p.output * scale
          const x = i * 10 + 1
          let y = H
          const seg = (h: number, fill: string, label: string): JSX.Element | null => {
            if (h <= 0) return null
            y -= h
            return (
              <rect x={x} y={y} width={7} height={h} fill={fill} rx="1">
                <title>{`#${i + 1} ${label}`}</title>
              </rect>
            )
          }
          const tip = `hit ${compact(p.hit)} · miss ${compact(p.miss)} · out ${compact(p.output)}`
          return (
            <g key={i}>
              {seg(hHit, 'var(--accent)', tip)}
              {seg(hMiss, 'var(--warning)', tip)}
              {seg(hOut, 'var(--success)', tip)}
              {total === 0 && <rect x={x} y={H - 1} width={7} height={1} fill="var(--border)" />}
            </g>
          )
        })}
      </svg>
      <div className="dash-timeline-legend">
        <i style={{ background: 'var(--accent)' }} /> {t('dash.hit')}
        <i style={{ background: 'var(--warning)' }} /> {t('dash.miss')}
        <i style={{ background: 'var(--success)' }} /> {t('dash.output')}
      </div>
    </div>
  )
}

const RANGES: Array<{ key: string; days: number | null }> = [
  { key: 'dash.rangeAll', days: null },
  { key: 'dash.range90', days: 90 },
  { key: 'dash.range30', days: 30 },
  { key: 'dash.range7', days: 7 },
]

/** Full statistics panel — lives inside the home page's「详细统计」expansion. */
export function DashboardPanel({
  onShowReceipt,
}: {
  onShowReceipt: (target: ReceiptTarget) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [tab, setTab] = useState<'overview' | 'models'>('overview')
  const [range, setRange] = useState<number | null>(null)
  const [data, setData] = useState<DashboardData | null>(null)
  const [failed, setFailed] = useState(false)
  const [openSession, setOpenSession] = useState<string | null>(null)
  const [timeline, setTimeline] = useState<RequestCostPoint[]>([])

  useEffect(() => {
    setFailed(false)
    window.api.usage
      .dashboard(range)
      .then(setData)
      .catch(() => setFailed(true))
  }, [range])

  const colorOf = (m: string): string => {
    const order = data?.models.map((x) => x.model) ?? []
    const i = order.indexOf(m)
    return MODEL_COLORS[(i >= 0 ? i : 0) % MODEL_COLORS.length]
  }

  const toggleSession = async (id: string): Promise<void> => {
    if (openSession === id) {
      setOpenSession(null)
      return
    }
    setOpenSession(id)
    setTimeline(await window.api.usage.timeline(id))
  }

  const monthReceipt = (): void => {
    const ym = new Date().toISOString().slice(0, 7)
    onShowReceipt({
      scope: 'month',
      id: ym,
      label: t('dash.monthBillLabel', { m: Number(ym.slice(5, 7)) }),
    })
  }

  return (
    <div className="dash">
      <div className="dash-head">
        <div className="dash-tabs">
          <button
            className={tab === 'overview' ? 'dash-tab active' : 'dash-tab'}
            onClick={() => setTab('overview')}
          >
            {t('dash.overview')}
          </button>
          <button
            className={tab === 'models' ? 'dash-tab active' : 'dash-tab'}
            onClick={() => setTab('models')}
          >
            {t('dash.models')}
          </button>
        </div>
        <div className="dash-ranges">
          {RANGES.map((r) => (
            <button
              key={r.key}
              className={range === r.days ? 'dash-range active' : 'dash-range'}
              onClick={() => setRange(r.days)}
            >
              {t(r.key)}
            </button>
          ))}
          <button className="btn-ghost dash-bill" onClick={monthReceipt}>
            <ReceiptText size={13} /> {t('dash.monthBill')}
          </button>
        </div>
      </div>

      {failed ? (
        <LoadError
          onRetry={() => {
            setFailed(false)
            window.api.usage
              .dashboard(range)
              .then(setData)
              .catch(() => setFailed(true))
          }}
        />
      ) : !data ? (
        <SkeletonCards n={8} />
      ) : data.requests === 0 ? (
        <EmptyData />
      ) : tab === 'overview' ? (
        <>
          <div className="dash-grid">
            <Stat label={t('dash.sessions')} value={compact(data.sessions)} />
            <Stat label={t('dash.messages')} value={compact(data.messages)} />
            <Stat label={t('dash.tokens')} value={compact(data.tokens)} />
            <Stat label={t('dash.requests')} value={compact(data.requests)} />
            <Stat label={t('dash.cost')} value={yuan(data.cost, 2)} />
            <Stat label={t('dash.saved')} value={yuan(data.saved, 2)} accent />
            <Stat label={t('dash.hitRate')} value={`${Math.round(data.hitRate * 100)}%`} accent />
            <Stat label={t('dash.activeDays')} value={`${data.activeDays}`} />
            <Stat label={t('dash.streak')} value={`${data.streak}`} />
            <Stat label={t('dash.longestStreak')} value={`${data.longestStreak}`} />
          </div>
          <Heatmap data={data.heatmap} />
        </>
      ) : (
        <>
          <div className="dash-token-line">
            <span className="ach-card-label">Token</span>
            <span className="dash-token-big tnum">{data.tokens.toLocaleString('en-US')}</span>
          </div>
          <DailyChart data={data.daily} colorOf={colorOf} />

          <div className="dash-models">
            {data.models.map((m) => {
              const denom = m.hitTokens + m.missTokens
              const rate = denom ? Math.round((m.hitTokens / denom) * 100) : 0
              return (
                <div key={m.model} className="dash-model-row">
                  <span className="dash-dot" style={{ background: colorOf(m.model) }} />
                  <span className="dash-model-name">{short(m.model)}</span>
                  <span className="dash-model-meta mono">
                    {compact(denom)} {t('dash.in')} · {compact(m.outputTokens)} {t('dash.out')} ·{' '}
                    {compact(m.hitTokens)} {t('dash.hit')} · {compact(m.missTokens)}{' '}
                    {t('dash.miss')} · {rate}%
                  </span>
                  <span className="dash-model-cost mono">{yuan(m.cost)}</span>
                </div>
              )
            })}
          </div>

          <div className="dash-rank">
            <div className="ach-card-label">{t('dash.rankTitle')}</div>
            {data.topSessions.length === 0 && <div className="dash-empty">{t('dash.noData')}</div>}
            {data.topSessions.map((s, i) => (
              <div key={s.id} className="dash-rank-item">
                <button className="dash-rank-row" onClick={() => void toggleSession(s.id)}>
                  <span className="dash-rank-no tnum">{i + 1}</span>
                  <span className="dash-rank-title">{s.title}</span>
                  <span className="dash-rank-meta mono">{s.requests} req</span>
                  <span className="dash-rank-cost mono">{yuan(s.cost)}</span>
                  <span className="dash-rank-caret">{openSession === s.id ? '▾' : '▸'}</span>
                </button>
                {openSession === s.id && <SessionTimeline points={timeline} />}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
