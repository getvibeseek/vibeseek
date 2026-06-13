import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, FolderTree, GitCompareArrows, ListTodo, Globe, ReceiptText } from 'lucide-react'
import { useBalance } from '../hooks/useBalance'
import { yuan } from '../money'
import type { MeterUpdate } from '../../../shared/ipc'
import type { Workspace } from '../hooks/useWorkspace'
import type { ReceiptTarget } from './ReceiptPopover'
import type { PanelTab } from './SidePanel'

const ZERO: MeterUpdate = {
  scope: 'none',
  sessionCost: 0,
  saved: 0,
  sessionHitRate: 0,
  contextPercent: 0,
  sessionTokens: 0,
}

interface StatusBarProps {
  ws: Workspace
  onShowReceipt: (target: ReceiptTarget) => void
  /** Which right-side panel tab is open, if any. */
  panel: PanelTab | null
  changeCount: number
  onTogglePanel: (tab: PanelTab) => void
}

export function StatusBar({
  ws,
  onShowReceipt,
  panel,
  changeCount,
  onTogglePanel,
}: StatusBarProps): JSX.Element {
  const { t } = useTranslation()
  const { state } = useBalance()
  const [meter, setMeter] = useState<MeterUpdate>(ZERO)
  const [scopeOpen, setScopeOpen] = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)

  useEffect(() => window.api.meter.onUpdate(setMeter), [])

  useEffect(() => {
    if (!scopeOpen) return
    const onDown = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setScopeOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [scopeOpen])

  const currentTitle = (): string => {
    if (!ws.project || !ws.currentId) return ''
    const s = (ws.sessionsByProject[ws.project] ?? []).find((x) => x.id === ws.currentId)
    return s?.title || t('sidebar.untitled')
  }

  const pick = (scope: 'session' | 'project'): void => {
    setScopeOpen(false)
    if (scope === 'session' && ws.currentId) {
      onShowReceipt({ scope, id: ws.currentId, label: currentTitle() })
    } else if (scope === 'project' && ws.project) {
      onShowReceipt({ scope, id: ws.project, label: ws.nameOf(ws.project) })
    }
  }

  const balanceText =
    state.status === 'ok' && state.data.infos[0]
      ? `¥${Number(state.data.infos[0].totalBalance).toFixed(2)}`
      : '—'

  return (
    <footer className="statusbar mono">
      <span className="status-item">
        {t('status.balance')} {balanceText}
      </span>
      <span className="status-sep">·</span>
      <span className="status-item">
        {meter.scope === 'project' ? t('status.project') : t('status.session')}{' '}
        {yuan(meter.sessionCost)}
      </span>
      <span className="status-sep">·</span>
      <span className="status-item" title={t('status.hitRateFull')}>
        {t('status.hitRate')} {(meter.sessionHitRate * 100).toFixed(0)}%
      </span>
      <span className="status-sep">·</span>
      <span className="status-item">
        {t('status.context')} {(meter.contextPercent * 100).toFixed(0)}%
      </span>
      <span className="status-spacer" />
      <span className="status-item status-saved" title={t('status.savedFull')}>
        {t('status.saved')} {yuan(meter.saved)}
      </span>
      <span className="status-sep">·</span>
      <span className="status-receipt-wrap" ref={wrapRef}>
        <button
          className="status-receipt-btn star-border"
          title={t('receipt.barLabel')}
          onClick={() => setScopeOpen((v) => !v)}
        >
          <ReceiptText size={13} /> {t('receipt.open')}
        </button>
        {scopeOpen && (
          <div className="receipt-scope-menu">
            <button className="ctx-item" disabled={!ws.currentId} onClick={() => pick('session')}>
              {t('receipt.scopeSession')}
            </button>
            <button className="ctx-item" disabled={!ws.project} onClick={() => pick('project')}>
              {t('receipt.scopeProject')}
            </button>
          </div>
        )}
      </span>
      <span className="status-sep">·</span>
      <button
        className={panel === 'overview' ? 'status-panel-btn active' : 'status-panel-btn'}
        title={t('panel.overview')}
        onClick={() => onTogglePanel('overview')}
      >
        <Activity size={14} />
      </button>
      <button
        className={panel === 'files' ? 'status-panel-btn active' : 'status-panel-btn'}
        title={t('panel.files')}
        onClick={() => onTogglePanel('files')}
      >
        <FolderTree size={14} />
      </button>
      <button
        className={panel === 'changes' ? 'status-panel-btn active' : 'status-panel-btn'}
        title={t('panel.changes')}
        onClick={() => onTogglePanel('changes')}
      >
        <GitCompareArrows size={14} />
        {changeCount > 0 && <span className="status-badge tnum">{changeCount}</span>}
      </button>
      <button
        className={panel === 'plan' ? 'status-panel-btn active' : 'status-panel-btn'}
        title={t('panel.plan')}
        onClick={() => onTogglePanel('plan')}
      >
        <ListTodo size={14} />
      </button>
      <button
        className={panel === 'preview' ? 'status-panel-btn active' : 'status-panel-btn'}
        title={t('panel.preview')}
        onClick={() => onTogglePanel('preview')}
      >
        <Globe size={14} />
      </button>
    </footer>
  )
}
