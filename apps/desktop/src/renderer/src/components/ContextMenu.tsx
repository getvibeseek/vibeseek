import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface MenuItem {
  label: string
  danger?: boolean
  separator?: boolean
  /** Renders a leading ✓ (used by picker-style menus, e.g. the project chip). */
  checked?: boolean
  onClick?: () => void
}

interface ContextMenuProps {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

/** Cursor-anchored context menu; flips near window edges, closes on outside/Esc. */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { innerWidth, innerHeight } = window
    const r = el.getBoundingClientRect()
    setPos({
      x: x + r.width > innerWidth - 8 ? Math.max(8, x - r.width) : x,
      y: y + r.height > innerHeight - 8 ? Math.max(8, y - r.height) : y,
    })
  }, [x, y])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    // Register on the NEXT tick. The contextmenu event that opened this menu is
    // still bubbling toward document when React flushes this effect; a listener
    // added now would catch that same event and close the menu instantly
    // (open-then-close within one event — looks like "the menu never appears").
    // mousedown also covers right-clicks elsewhere, so no contextmenu listener.
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', onDown)
      document.addEventListener('keydown', onKey)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return createPortal(
    <div className="ctx-menu" ref={ref} style={{ left: pos.x, top: pos.y }}>
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className="ctx-sep" />
        ) : (
          <button
            key={i}
            className={item.danger ? 'ctx-item ctx-danger' : 'ctx-item'}
            onClick={() => {
              item.onClick?.()
              onClose()
            }}
          >
            {item.checked !== undefined && (
              <span className="ctx-check">{item.checked ? '✓' : ''}</span>
            )}
            {item.label}
          </button>
        )
      )}
    </div>,
    document.body
  )
}
