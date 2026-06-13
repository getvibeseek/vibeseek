import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SessionSearchResult } from '../../../shared/ipc'

function baseName(dir: string): string {
  const parts = dir.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? dir
}

/** Cmd-K style conversation finder: searches titles + message content across all
 *  projects (FTS5), opens the picked conversation. */
export function SearchModal({
  onClose,
  onPick,
  nameOf,
}: {
  onClose: () => void
  onPick: (sessionId: string) => void
  nameOf: (dir: string) => string
}): JSX.Element {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SessionSearchResult[]>([])
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void window.api.session.search(q).then((r) => {
        if (!cancelled) {
          setResults(r)
          setActive(0)
        }
      })
    }, 150) // debounce
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  const pick = (r?: SessionSearchResult): void => {
    if (!r) return
    onPick(r.id)
    onClose()
  }

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="search-modal" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="search-input"
          placeholder={t('search.placeholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => Math.min(a + 1, results.length - 1))
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(a - 1, 0))
            }
            if (e.key === 'Enter') pick(results[active])
          }}
        />
        <div className="search-results">
          {query.trim().length >= 2 && results.length === 0 && (
            <div className="search-empty prose dim">{t('search.noResults')}</div>
          )}
          {results.map((r, i) => (
            <button
              key={r.id}
              className={i === active ? 'search-row active' : 'search-row'}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(r)}
            >
              <div className="search-row-head">
                <span className="search-row-title">{r.title || t('sidebar.untitled')}</span>
                <span className="search-row-project mono">
                  {nameOf(r.projectDir) || baseName(r.projectDir)}
                </span>
              </div>
              {r.snippet && <div className="search-row-snip dim">{r.snippet}</div>}
            </button>
          ))}
        </div>
        <div className="search-hint dim">{t('search.hint')}</div>
      </div>
    </div>
  )
}
