import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, FolderTree, GitCompareArrows, ListTodo, Globe } from 'lucide-react'
import { OverviewPanel } from './OverviewPanel'
import { ChangesBody } from './ChangesPanel'
import { FilePanel } from './FilePanel'
import { PreviewPanel } from './PreviewPanel'
import { PlanPanel } from './PlanPanel'

export type PanelTab = 'overview' | 'files' | 'changes' | 'preview' | 'plan'

// Wide enough for the five ENGLISH labels in one row; user-resizable beyond.
// Below the label breakpoint (CSS container query) tabs fall back to icons.
const DEFAULT_WIDTH = 440
const MIN_WIDTH = 320
const MAX_WIDTH = 760

/**
 * Right-side panel host: tabbed 概览 / 文件 / 变更 / 任务 / 预览,
 * toggled from the status-bar icons. Width is drag-resizable on the left edge
 * and remembered across sessions (user feedback).
 */
export function SidePanel({
  tab,
  changeCount,
  onTab,
  onClose,
}: {
  tab: PanelTab
  changeCount: number
  onTab: (tab: PanelTab) => void
  onClose: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem('sidePanelWidth'))
    return saved >= MIN_WIDTH && saved <= MAX_WIDTH ? saved : DEFAULT_WIDTH
  })

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    let latest = 0
    const onMove = (ev: MouseEvent): void => {
      latest = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - ev.clientX))
      setWidth(latest)
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      if (latest) localStorage.setItem('sidePanelWidth', String(latest))
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'ew-resize'
  }, [])

  return (
    <aside className="side-panel" style={{ width }}>
      <div className="side-resizer" onMouseDown={startResize} />
      <div className="side-panel-tabs">
        <button
          className={tab === 'overview' ? 'side-tab active' : 'side-tab'}
          title={t('panel.overview')}
          onClick={() => onTab('overview')}
        >
          <Activity size={13} /> <span className="side-tab-label">{t('panel.overview')}</span>
        </button>
        <button
          className={tab === 'files' ? 'side-tab active' : 'side-tab'}
          title={t('panel.files')}
          onClick={() => onTab('files')}
        >
          <FolderTree size={13} /> <span className="side-tab-label">{t('panel.files')}</span>
        </button>
        <button
          className={tab === 'changes' ? 'side-tab active' : 'side-tab'}
          title={t('panel.changes')}
          onClick={() => onTab('changes')}
        >
          <GitCompareArrows size={13} />{' '}
          <span className="side-tab-label">{t('panel.changes')}</span>
          {changeCount > 0 && <span className="side-tab-badge tnum">{changeCount}</span>}
        </button>
        <button
          className={tab === 'plan' ? 'side-tab active' : 'side-tab'}
          title={t('panel.plan')}
          onClick={() => onTab('plan')}
        >
          <ListTodo size={13} /> <span className="side-tab-label">{t('panel.plan')}</span>
        </button>
        <button
          className={tab === 'preview' ? 'side-tab active' : 'side-tab'}
          title={t('panel.preview')}
          onClick={() => onTab('preview')}
        >
          <Globe size={13} /> <span className="side-tab-label">{t('panel.preview')}</span>
        </button>
        <button className="dev-close side-panel-close" aria-label="close" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="side-panel-body">
        {tab === 'overview' ? (
          <OverviewPanel />
        ) : tab === 'files' ? (
          <FilePanel />
        ) : tab === 'preview' ? (
          <PreviewPanel />
        ) : tab === 'plan' ? (
          <PlanPanel />
        ) : (
          <ChangesBody />
        )}
      </div>
    </aside>
  )
}
