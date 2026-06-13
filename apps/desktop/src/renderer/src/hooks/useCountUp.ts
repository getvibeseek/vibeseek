import { useEffect, useRef, useState } from 'react'

/**
 * Animate a number toward its target whenever the target changes (ease-out
 * cubic). Used by the hero amount — paired with tabular-nums so digits don't
 * jitter. Respects prefers-reduced-motion (jumps straight to the target).
 */
export function useCountUp(target: number, ms = 450): number {
  const [value, setValue] = useState(0)
  const fromRef = useRef(0)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      fromRef.current = target
      setValue(target)
      return
    }
    const from = fromRef.current
    if (from === target) return
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number): void => {
      const p = Math.min(1, (now - t0) / ms)
      const eased = 1 - Math.pow(1 - p, 3)
      setValue(from + (target - from) * eased)
      if (p < 1) {
        raf = requestAnimationFrame(tick)
      } else {
        fromRef.current = target
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])

  return value
}
