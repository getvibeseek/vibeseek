import { useEffect, useRef } from 'react'

const MIN = 0.5
const MAX = 2.0
const STEP = 0.1

/**
 * Ctrl/Cmd +/-/0 global zoom. Persists zoomFactor via settings; the main process
 * applies it to the window's webContents. Survives restart because the
 * window restores the persisted factor on ready-to-show.
 */
export function useZoom(): void {
  const zoom = useRef(1)

  useEffect(() => {
    window.api.settings.getAll().then((s) => (zoom.current = s.zoomFactor))

    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      let next: number | null = null
      if (e.key === '=' || e.key === '+') next = Math.min(MAX, zoom.current + STEP)
      else if (e.key === '-' || e.key === '_') next = Math.max(MIN, zoom.current - STEP)
      else if (e.key === '0') next = 1
      if (next === null) return
      e.preventDefault()
      zoom.current = Math.round(next * 100) / 100
      window.api.settings.set('zoomFactor', zoom.current)
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
