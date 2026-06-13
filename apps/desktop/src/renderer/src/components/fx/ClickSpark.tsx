/**
 * Global click feedback: a small burst of accent-colored lines at every click
 * (idea: React Bits ClickSpark; this is an original minimal implementation).
 * Zero idle cost — the RAF loop only runs while sparks are alive.
 */
import { useEffect, useRef } from 'react'

interface Spark {
  x: number
  y: number
  start: number
}

const DURATION = 380
const LINES = 8
const RADIUS = 18
const LENGTH = 7

export function ClickSpark(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const resize = (): void => {
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
      canvas.style.width = `${window.innerWidth}px`
      canvas.style.height = `${window.innerHeight}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const sparks: Spark[] = []
    let rafId = 0
    let running = false

    const draw = (now: number): void => {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
      const color = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]
        const t = (now - s.start) / DURATION
        if (t >= 1) {
          sparks.splice(i, 1)
          continue
        }
        const eased = 1 - Math.pow(1 - t, 3) // ease-out cubic
        ctx.strokeStyle = color
        ctx.globalAlpha = 1 - eased
        ctx.lineWidth = 1.5
        for (let k = 0; k < LINES; k++) {
          const angle = (k / LINES) * Math.PI * 2
          const d0 = eased * RADIUS
          const d1 = d0 + LENGTH * (1 - eased)
          ctx.beginPath()
          ctx.moveTo(s.x + Math.cos(angle) * d0, s.y + Math.sin(angle) * d0)
          ctx.lineTo(s.x + Math.cos(angle) * d1, s.y + Math.sin(angle) * d1)
          ctx.stroke()
        }
      }
      ctx.globalAlpha = 1
      if (sparks.length > 0) {
        rafId = requestAnimationFrame(draw)
      } else {
        running = false
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
      }
    }

    const onClick = (e: MouseEvent): void => {
      sparks.push({ x: e.clientX, y: e.clientY, start: performance.now() })
      if (!running) {
        running = true
        rafId = requestAnimationFrame(draw)
      }
    }
    window.addEventListener('click', onClick)

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('click', onClick)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return <canvas ref={canvasRef} className="click-spark" aria-hidden />
}
