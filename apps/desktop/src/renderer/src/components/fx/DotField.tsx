/**
 * Ported from React Bits <DotField /> (https://reactbits.dev, MIT + Commons
 * Clause) — see THIRD-PARTY-NOTICES.md. Adaptations for VibeSeek: TypeScript,
 * paused while hidden, sparkle/wave/physics dropped. The big SVG cursor glow
 * was REMOVED after review (read as an ugly blob) — feedback now lives in the
 * DOTS themselves: near the cursor they brighten toward the accent color,
 * grow slightly and bulge away (DotGrid-style proximity highlight).
 */
import { useEffect, useRef, memo } from 'react'

const TWO_PI = Math.PI * 2

interface Dot {
  ax: number
  ay: number
  sx: number
  sy: number
}

interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

/** Parse #rrggbb or rgba(r,g,b,a) into channels. */
function parseColor(input: string): Rgba {
  const hex = /^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(input)
  if (hex) {
    return {
      r: parseInt(hex[1], 16),
      g: parseInt(hex[2], 16),
      b: parseInt(hex[3], 16),
      a: 1,
    }
  }
  const rgba = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\)/.exec(input)
  if (rgba) {
    return {
      r: Number(rgba[1]),
      g: Number(rgba[2]),
      b: Number(rgba[3]),
      a: rgba[4] !== undefined ? Number(rgba[4]) : 1,
    }
  }
  return { r: 128, g: 128, b: 128, a: 0.3 }
}

export const DotField = memo(function DotField({
  dotRadius = 2,
  dotSpacing = 14,
  cursorRadius = 150,
  bulgeStrength = 12,
  baseColor = 'rgba(150, 165, 220, 0.22)',
  activeColor = '#4a7dff',
}: {
  dotRadius?: number
  dotSpacing?: number
  cursorRadius?: number
  bulgeStrength?: number
  /** Resting dot color (keep it quiet). */
  baseColor?: string
  /** What dots become right under the cursor. */
  activeColor?: string
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const base = parseColor(baseColor)
    const active = parseColor(activeColor)

    let dots: Dot[] = []
    const size = { w: 0, h: 0, offsetX: 0, offsetY: 0 }
    const mouse = { x: -9999, y: -9999 }
    // The effect only lives while the mouse MOVES: after ~0.3s idle it eases
    // back to rest, so a parked or departed cursor leaves nothing behind.
    let lastMove = -1e9
    let activity = 0
    let resizeTimer: ReturnType<typeof setTimeout> | undefined

    function buildDots(w: number, h: number): void {
      const step = dotRadius + dotSpacing
      const cols = Math.floor(w / step)
      const rows = Math.floor(h / step)
      const padX = (w % step) / 2
      const padY = (h % step) / 2
      dots = new Array<Dot>(rows * cols)
      let idx = 0
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const ax = padX + col * step + step / 2
          const ay = padY + row * step + step / 2
          dots[idx++] = { ax, ay, sx: ax, sy: ay }
        }
      }
    }

    function doResize(): void {
      const parent = canvas!.parentElement
      if (!parent) return
      const rect = parent.getBoundingClientRect()
      canvas!.width = rect.width * dpr
      canvas!.height = rect.height * dpr
      canvas!.style.width = `${rect.width}px`
      canvas!.style.height = `${rect.height}px`
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
      size.w = rect.width
      size.h = rect.height
      size.offsetX = rect.left + window.scrollX
      size.offsetY = rect.top + window.scrollY
      buildDots(rect.width, rect.height)
    }

    function resize(): void {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(doResize, 100)
    }

    function onMouseMove(e: MouseEvent): void {
      mouse.x = e.pageX - size.offsetX
      mouse.y = e.pageY - size.offsetY
      lastMove = performance.now()
    }

    let rafId = 0
    function tick(): void {
      rafId = requestAnimationFrame(tick)
      if (document.hidden) return

      // Activity ramps up quickly with movement and GLIDES out after idle:
      // the target itself fades 1→0 across the 200–900ms idle window (no
      // binary flip), and the follow rates are gentle — silky, not abrupt.
      const idle = performance.now() - lastMove
      const target = Math.min(1, Math.max(0, 1 - (idle - 200) / 700))
      activity += (target - activity) * (target > activity ? 0.18 : 0.035)
      if (activity < 0.003) activity = 0

      ctx!.clearRect(0, 0, size.w, size.h)
      const crSq = cursorRadius * cursorRadius
      const rad = dotRadius / 2

      // Two passes: far dots batch into ONE path (cheap); only the few dots
      // near the cursor get individual color/size treatment.
      ctx!.beginPath()
      ctx!.fillStyle = `rgba(${base.r},${base.g},${base.b},${base.a})`
      const near: Array<{ d: Dot; t: number }> = []
      for (const d of dots) {
        const dx = mouse.x - d.ax
        const dy = mouse.y - d.ay
        const distSq = dx * dx + dy * dy
        if (distSq < crSq && activity > 0) {
          const dist = Math.sqrt(distSq)
          const t = (1 - dist / cursorRadius) * activity
          const push = t * t * bulgeStrength
          const angle = Math.atan2(dy, dx)
          d.sx += (d.ax - Math.cos(angle) * push - d.sx) * 0.18
          d.sy += (d.ay - Math.sin(angle) * push - d.sy) * 0.18
          near.push({ d, t })
          continue
        }
        d.sx += (d.ax - d.sx) * 0.08
        d.sy += (d.ay - d.sy) * 0.08
        ctx!.moveTo(d.sx + rad, d.sy)
        ctx!.arc(d.sx, d.sy, rad, 0, TWO_PI)
      }
      ctx!.fill()

      // Near dots: lerp color toward the accent, fade alpha up, grow a touch.
      for (const { d, t } of near) {
        const r = Math.round(base.r + (active.r - base.r) * t)
        const g = Math.round(base.g + (active.g - base.g) * t)
        const b = Math.round(base.b + (active.b - base.b) * t)
        const a = base.a + (1 - base.a) * t
        ctx!.fillStyle = `rgba(${r},${g},${b},${a})`
        ctx!.beginPath()
        ctx!.arc(d.sx, d.sy, rad * (1 + t * 0.45), 0, TWO_PI)
        ctx!.fill()
      }
    }

    doResize()
    window.addEventListener('resize', resize)
    window.addEventListener('mousemove', onMouseMove, { passive: true })
    rafId = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(rafId)
      clearTimeout(resizeTimer)
      window.removeEventListener('resize', resize)
      window.removeEventListener('mousemove', onMouseMove)
    }
  }, [dotRadius, dotSpacing, cursorRadius, bulgeStrength, baseColor, activeColor])

  return (
    <div className="fx-fill" style={{ position: 'relative' }}>
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0 }} />
    </div>
  )
})
