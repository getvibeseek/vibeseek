import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { FileChange, FileDiff } from '../../../shared/ipc'

function DiffView({
  diff,
  onHunk,
}: {
  diff: FileDiff
  /** Hunk-level accept/reject; refreshes the panel afterwards. */
  onHunk: (action: 'accept' | 'reject', hunk: number) => void
}): JSX.Element {
  const { t } = useTranslation()
  // Unified diff: changed lines with surrounding context, long unchanged runs
  // collapsed into ⋯ gaps. Computed in main (LCS) — this just renders rows.
  // A thin action bar precedes the FIRST row of each hunk.
  const hunkCount = new Set(diff.rows.map((r) => r.hunk).filter((h) => h !== undefined)).size
  let lastHunk: number | undefined
  return (
    <pre className="diff mono">
      {diff.rows.map((r, i) => {
        const startsHunk = r.hunk !== undefined && r.hunk !== lastHunk
        if (r.hunk !== undefined) lastHunk = r.hunk
        return (
          <div key={i}>
            {startsHunk && hunkCount > 1 && (
              <div className="hunk-bar">
                <button className="hunk-btn" onClick={() => onHunk('reject', r.hunk!)}>
                  {t('changes.hunkReject')}
                </button>
                <button className="hunk-btn" onClick={() => onHunk('accept', r.hunk!)}>
                  {t('changes.hunkAccept')}
                </button>
              </div>
            )}
            {r.type === 'gap' ? (
              <div className="diff-gap">⋯</div>
            ) : (
              <div className={`diff-line diff-${r.type}`}>
                <span className="diff-no tnum">{r.oldNo ?? ''}</span>
                <span className="diff-no tnum">{r.newNo ?? ''}</span>
                <span className="diff-sign">
                  {r.type === 'add' ? '+' : r.type === 'del' ? '−' : ' '}
                </span>
                <span className="diff-text">{r.text}</span>
              </div>
            )}
          </div>
        )
      })}
    </pre>
  )
}

/** 变更 tab body — hosted inside the right SidePanel. */
export function ChangesBody(): JSX.Element {
  const { t } = useTranslation()
  const [changes, setChanges] = useState<FileChange[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [diff, setDiff] = useState<FileDiff | null>(null)

  const [canRedo, setCanRedo] = useState(false)
  const [rejected, setRejected] = useState<string | null>(null)
  // Rollback/redo ride on git shadow checkpoints — without a repo they'd be
  // dead buttons (user-reported). Per-file reject still works everywhere.
  const [isRepo, setIsRepo] = useState(false)

  const refresh = useCallback(() => {
    window.api.changes.list().then(setChanges)
    window.api.git.canRedo().then(setCanRedo)
    window.api.changes.rejectedPath().then(setRejected)
    window.api.git.isRepo().then(setIsRepo)
  }, [])

  useEffect(() => {
    refresh()
    return window.api.changes.onUpdate(refresh)
  }, [refresh])
  // Keep an OPEN diff live: if the agent (or a rollback) touches files while
  // a diff is expanded, stale hunk indices could hit the wrong hunk on click.
  useEffect(() => {
    if (!open) return
    return window.api.changes.onUpdate(() => {
      void window.api.changes.diff(open).then(setDiff)
    })
  }, [open])

  const toggle = async (path: string): Promise<void> => {
    if (open === path) {
      setOpen(null)
      setDiff(null)
      return
    }
    setOpen(path)
    setDiff(await window.api.changes.diff(path))
  }

  return (
    <div className="changes-body">
      <div className="panel-head">
        {t('changes.title')} <span className="sidebar-item-meta">{changes.length}</span>
        {isRepo && changes.length > 0 && (
          <button
            className="btn-ghost panel-rollback"
            title={t('changes.rollbackHint')}
            onClick={() => void window.api.git.rollbackTask().then(refresh)}
          >
            {t('changes.rollback')}
          </button>
        )}
        {/* Redo visibility depends ONLY on having a snapshot — in multi-task
            sessions the list may be non-empty after a rollback (earlier tasks'
            edits remain), and the button must not hide behind that. */}
        {isRepo && canRedo && (
          <button
            className="btn-ghost panel-rollback"
            title={t('changes.redoHint')}
            onClick={() => void window.api.git.redoRollback().then(refresh)}
          >
            {t('changes.redo')}
          </button>
        )}
      </div>
      {rejected && (
        <div className="reject-undo-bar">
          <span className="mono reject-undo-path">{rejected}</span>
          <span className="dim">{t('changes.rejected')}</span>
          <button
            className="btn-ghost"
            onClick={() => {
              void window.api.changes.undoReject().then(refresh)
            }}
          >
            {t('changes.undoReject')}
          </button>
        </div>
      )}
      {changes.length === 0 && <div className="panel-empty prose dim">{t('changes.none')}</div>}
      {changes.map((c) => (
        <div key={c.path} className="change">
          <button className="change-row" onClick={() => toggle(c.path)}>
            <span className="mono change-path">{c.path}</span>
            <span className="change-stat mono">
              <span className="diff-add">+{c.added}</span>{' '}
              <span className="diff-del">−{c.removed}</span>
            </span>
          </button>
          {open === c.path && diff && (
            <DiffView
              diff={diff}
              onHunk={(action, hunk) => {
                const call =
                  action === 'reject'
                    ? window.api.changes.rejectHunk
                    : window.api.changes.acceptHunk
                void call(c.path, hunk).then(async () => {
                  refresh()
                  setDiff(await window.api.changes.diff(c.path))
                })
              }}
            />
          )}
          {open === c.path && (
            <div className="change-actions">
              <button
                className="btn-ghost"
                onClick={() => {
                  void window.api.changes.reject(c.path).then(refresh)
                  setOpen(null)
                }}
              >
                {t('changes.reject')}
              </button>
              <button
                className="btn-ghost"
                onClick={() => {
                  void window.api.changes.accept(c.path).then(refresh)
                  setOpen(null)
                }}
              >
                {t('changes.accept')}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
