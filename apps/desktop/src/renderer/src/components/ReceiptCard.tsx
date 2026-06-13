import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { yuan } from '../money'
import type { TaskReceipt } from '../../../shared/ipc'

const W = 340
const BASE_H = 500
/** Extra height per model row in the per-model split section. */
const MODEL_ROW_H = 34

function modelLines(r: TaskReceipt): NonNullable<TaskReceipt['byModel']> {
  return r.byModel && r.byModel.length > 1 ? r.byModel : []
}

function heightFor(r: TaskReceipt): number {
  const n = modelLines(r).length
  return BASE_H + (n ? n * MODEL_ROW_H + 14 : 0)
}

interface Palette {
  paper: string
  ink: string
  faint: string
  rule: string
  accent: string
  stamp: string
}

const DARK: Palette = {
  paper: '#1b1b1d',
  ink: '#ededed',
  faint: '#8a8a90',
  rule: '#3a3a3e',
  accent: '#5d8bff',
  stamp: '#3ecf8e',
}
const LIGHT: Palette = {
  paper: '#fbfbf8',
  ink: '#1a1a1a',
  faint: '#8a8a86',
  rule: '#d9d9d2',
  accent: '#3b6df0',
  stamp: '#1aa06d',
}

const fmt = (n: number): string => n.toLocaleString('en-US')

/** Width-aware title truncation: CJK glyphs are ~2× latin width at this size,
 *  so a plain char count overflows the 340px card on Chinese titles. */
function fitTitle(s: string, maxUnits = 44): string {
  let units = 0
  for (let i = 0; i < s.length; i++) {
    units += s.charCodeAt(i) > 0x2e7f ? 2 : 1
    if (units > maxUnits) return `${s.slice(0, i)}…`
  }
  return s
}
const SHORT_MODEL: Record<string, string> = {
  'deepseek-v4-flash': 'V4 Flash',
  'deepseek-v4-pro': 'V4 Pro',
}

/** Deterministic barcode bar widths from the receipt timestamp. */
function bars(seed: string): number[] {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const out: number[] = []
  for (let i = 0; i < 44; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822519)
    out.push((h >>> 28) & 3) // 0..3
  }
  return out
}

/** Full paper outline with zigzag torn top and bottom edges. */
function paperPath(h: number): string {
  const step = 12
  const amp = 5
  const top = 8
  const bot = h - 8
  let d = `M 0 ${top}`
  for (let x = 0; x < W; x += step) d += ` L ${x + step / 2} ${top - amp} L ${x + step} ${top}`
  d += ` L ${W} ${bot}`
  for (let x = W; x > 0; x -= step) d += ` L ${x - step / 2} ${bot + amp} L ${x - step} ${bot}`
  d += ' Z'
  return d
}

function leader(x1: number, x2: number, y: number, color: string): JSX.Element {
  return <line x1={x1} y1={y} x2={x2} y2={y} stroke={color} strokeWidth="1" strokeDasharray="1 3" />
}

function ReceiptSvg({ r, p }: { r: TaskReceipt; p: Palette }): JSX.Element {
  const date = new Date(r.ts)
  const stamp = up(r.savedPct * 100)
  const items: Array<[string, number]> = [
    ['命中 hit', r.hitTokens],
    ['未命中 miss', r.missTokens],
    ['输出 output', r.outputTokens],
    ['思考 thinking', r.thinkingTokens],
  ]
  const models = modelLines(r)
  // Everything below the token block shifts down by the model-section height.
  const off = models.length ? models.length * MODEL_ROW_H + 14 : 0
  const H = heightFor(r)
  const barSet = bars(r.ts)
  let bx = 28
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      xmlns="http://www.w3.org/2000/svg"
      fontFamily="'Cascadia Code','Consolas',monospace"
    >
      <path d={paperPath(H)} fill={p.paper} stroke={p.rule} strokeWidth="1" />
      {/* header */}
      <text
        x={W / 2}
        y={42}
        textAnchor="middle"
        fill={p.ink}
        fontSize="20"
        fontWeight="700"
        letterSpacing="4"
        fontFamily="system-ui,sans-serif"
      >
        VIBESEEK
      </text>
      <text x={W / 2} y={60} textAnchor="middle" fill={p.faint} fontSize="10" letterSpacing="2">
        任务结算单 · RECEIPT
      </text>
      <line
        x1="20"
        y1="74"
        x2={W - 20}
        y2="74"
        stroke={p.rule}
        strokeWidth="1"
        strokeDasharray="4 3"
      />

      {/* task + meta */}
      <text x="20" y="98" fill={p.ink} fontSize="12" fontFamily="system-ui,sans-serif">
        {fitTitle(r.taskName)}
      </text>
      <text x="20" y="116" fill={p.faint} fontSize="10">
        {[
          SHORT_MODEL[r.model] ?? r.model,
          r.durationMs > 0 ? `${(r.durationMs / 1000).toFixed(1)}s` : '',
          `${r.requests} req`,
        ]
          .filter(Boolean)
          .join(' · ')}
      </text>
      <text x={W - 20} y="116" textAnchor="end" fill={p.faint} fontSize="10">
        {date.toLocaleDateString()} {date.toLocaleTimeString().slice(0, 5)}
      </text>
      <line x1="20" y1="130" x2={W - 20} y2="130" stroke={p.rule} strokeWidth="1" />

      {/* line items with dotted leaders */}
      {items.map(([label, val], i) => {
        const y = 156 + i * 26
        return (
          <g key={label}>
            <text x="20" y={y} fill={p.ink} fontSize="12">
              {label}
            </text>
            {leader(118, W - 70, y - 4, p.rule)}
            <text x={W - 20} y={y} textAnchor="end" fill={p.ink} fontSize="12">
              {fmt(val)}
            </text>
          </g>
        )
      })}

      {/* per-model split (only when 2+ models contributed) */}
      {models.length > 0 && (
        <g>
          <line
            x1="20"
            y1="250"
            x2={W - 20}
            y2="250"
            stroke={p.rule}
            strokeWidth="1"
            strokeDasharray="4 3"
          />
          {models.map((m, i) => {
            const nameY = 272 + i * MODEL_ROW_H
            const denom = m.hitTokens + m.missTokens
            const rate = denom ? Math.round((m.hitTokens / denom) * 100) : 0
            return (
              <g key={m.model}>
                <text x="28" y={nameY} fill={p.ink} fontSize="12" fontWeight="600">
                  {SHORT_MODEL[m.model] ?? m.model}
                </text>
                <text x={W - 20} y={nameY} textAnchor="end" fill={p.ink} fontSize="12">
                  {yuan(m.cost)}
                </text>
                <text x="28" y={nameY + 14} fill={p.faint} fontSize="9">
                  命中 {rate}% · {fmt(m.hitTokens + m.missTokens)} in · {fmt(m.outputTokens)} out ·{' '}
                  {m.requests} req
                </text>
              </g>
            )
          })}
        </g>
      )}

      <line x1="20" y1={276 + off} x2={W - 20} y2={276 + off} stroke={p.rule} strokeWidth="1" />

      {/* totals */}
      <text
        x="20"
        y={304 + off}
        fill={p.ink}
        fontSize="13"
        fontWeight="700"
        fontFamily="system-ui,sans-serif"
      >
        合计 TOTAL
      </text>
      <text x={W - 20} y={306 + off} textAnchor="end" fill={p.ink} fontSize="18" fontWeight="700">
        {yuan(r.cost)}
      </text>
      <text x="20" y={326 + off} fill={p.faint} fontSize="11">
        全价应付 list price
      </text>
      <text
        x={W - 20}
        y={326 + off}
        textAnchor="end"
        fill={p.faint}
        fontSize="12"
        textDecoration="line-through"
      >
        {yuan(r.fullPrice)}
      </text>

      {/* saved stamp */}
      <g transform={`translate(96 ${384 + off}) rotate(-9)`}>
        <rect
          x={-76}
          y={-26}
          width="152"
          height="52"
          rx="8"
          fill="none"
          stroke={p.stamp}
          strokeWidth="2.5"
        />
        <text x="0" y="-4" textAnchor="middle" fill={p.stamp} fontSize="11" letterSpacing="1">
          已省 SAVED
        </text>
        <text x="0" y="18" textAnchor="middle" fill={p.stamp} fontSize="20" fontWeight="700">
          {stamp}%
        </text>
      </g>

      {/* barcode */}
      <g>
        {barSet.map((w, i) => {
          const bw = w + 1
          const el = (
            <rect
              key={i}
              x={bx}
              y={430 + off}
              width={bw}
              height={28}
              fill={i % 2 ? 'none' : p.ink}
            />
          )
          bx += bw + 1
          return el
        })}
      </g>
      <text
        x={W / 2}
        y={480 + off}
        textAnchor="middle"
        fill={p.faint}
        fontSize="9"
        letterSpacing="1"
      >
        vibeseek.dev · DeepSeek-native
      </text>
    </svg>
  )
}

function up(n: number): string {
  return Math.round(n).toString()
}

async function svgToBlob(svg: SVGSVGElement, scale = 2): Promise<Blob> {
  const xml = new XMLSerializer().serializeToString(svg)
  const url = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)))
  const img = new Image()
  await new Promise<void>((res, rej) => {
    img.onload = () => res()
    img.onerror = () => rej(new Error('svg load failed'))
    img.src = url
  })
  const h = svg.viewBox.baseVal.height || BASE_H
  const canvas = document.createElement('canvas')
  canvas.width = W * scale
  canvas.height = h * scale
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  ctx.drawImage(img, 0, 0)
  return new Promise((res) => canvas.toBlob((b) => res(b!), 'image/png'))
}

export function ReceiptCard({
  receipt,
  onClose,
}: {
  receipt: TaskReceipt
  onClose?: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const [flash, setFlash] = useState('')
  const palette = document.documentElement.dataset.theme === 'light' ? LIGHT : DARK

  const getSvg = (): SVGSVGElement | null => ref.current?.querySelector('svg') ?? null

  const save = async (): Promise<void> => {
    const svg = getSvg()
    if (!svg) return
    const blob = await svgToBlob(svg)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `vibeseek-receipt-${receipt.ts.slice(0, 19).replace(/[:T]/g, '-')}.png`
    a.click()
    URL.revokeObjectURL(a.href)
    setFlash(t('receipt.saved'))
    setTimeout(() => setFlash(''), 1500)
  }

  const copy = async (): Promise<void> => {
    const svg = getSvg()
    if (!svg) return
    try {
      const blob = await svgToBlob(svg)
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      setFlash(t('receipt.copied'))
    } catch {
      setFlash(t('receipt.copyFailed'))
    }
    setTimeout(() => setFlash(''), 1500)
  }

  return (
    <div className="receipt">
      <div className="receipt-paper" ref={ref}>
        <ReceiptSvg r={receipt} p={palette} />
      </div>
      <div className="receipt-actions">
        {onClose && (
          <button className="btn-ghost" onClick={onClose}>
            {t('receipt.collapse')}
          </button>
        )}
        <button className="btn-ghost" onClick={copy}>
          {t('receipt.copy')}
        </button>
        <button className="btn" onClick={save}>
          {t('receipt.save')}
        </button>
        {flash && <span className="receipt-flash">{flash}</span>}
      </div>
    </div>
  )
}
