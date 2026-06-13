import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * 预览 tab: an address bar plus a placeholder box. The real page is a
 * native WebContentsView pinned by the main process exactly over the box —
 * we report the box's rect (and any resize/move) so it tracks the panel.
 */
export function PreviewPanel(): JSX.Element {
  const { t } = useTranslation()
  const [url, setUrl] = useState('')
  const [detecting, setDetecting] = useState(false)
  const [noServer, setNoServer] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const shownRef = useRef(false)

  const rectOf = (): { x: number; y: number; width: number; height: number } | null => {
    const el = boxRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height }
  }

  const open = (target: string): void => {
    const rect = rectOf()
    if (!rect || !target) return
    setNoServer(false)
    if (shownRef.current) window.api.preview.navigate(target)
    else {
      window.api.preview.show(rect, target)
      shownRef.current = true
    }
  }

  // Mount: restore a previously-loaded page or auto-detect a dev server.
  useEffect(() => {
    let cancelled = false
    void window.api.preview.currentUrl().then((cur) => {
      if (cancelled) return
      if (cur) {
        setUrl(cur)
        const rect = rectOf()
        if (rect) {
          window.api.preview.show(rect)
          shownRef.current = true
        }
        return
      }
      setDetecting(true)
      void window.api.preview.detect().then((found) => {
        if (cancelled) return
        setDetecting(false)
        if (found) {
          setUrl(found)
          open(found)
        } else {
          setNoServer(true)
        }
      })
    })
    return () => {
      cancelled = true
      shownRef.current = false
      window.api.preview.hide()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Track the box: panel resizes, window resizes, layout shifts.
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const report = (): void => {
      const rect = rectOf()
      if (rect && shownRef.current) window.api.preview.setBounds(rect)
    }
    const ro = new ResizeObserver(report)
    ro.observe(el)
    window.addEventListener('resize', report)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', report)
    }
  }, [])

  return (
    <div className="preview-panel">
      <div className="preview-bar">
        <input
          className="input mono preview-url"
          placeholder={t('preview.placeholder')}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') open(url.startsWith('http') ? url : `http://${url}`)
          }}
        />
        {/* Native title tooltips: the embedded WebContentsView paints ABOVE
            all DOM, so CSS tooltips next to it get covered (user report). */}
        <button
          className="icon-btn"
          title={t('preview.reload')}
          onClick={() => window.api.preview.reload()}
        >
          ⟳
        </button>
        <button
          className="icon-btn"
          title={t('preview.detect')}
          onClick={() => {
            setDetecting(true)
            setNoServer(false)
            void window.api.preview.detect().then((found) => {
              setDetecting(false)
              if (found) {
                setUrl(found)
                open(found)
              } else setNoServer(true)
            })
          }}
        >
          ◎
        </button>
      </div>
      <div ref={boxRef} className="preview-box">
        {detecting && <div className="panel-empty prose dim">{t('preview.detecting')}</div>}
        {noServer && <div className="panel-empty prose dim">{t('preview.noServer')}</div>}
      </div>
    </div>
  )
}
