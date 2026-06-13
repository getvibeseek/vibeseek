import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PlanItemInfo } from '../../../shared/ipc'

const ICON: Record<PlanItemInfo['status'], string> = {
  pending: '○',
  in_progress: '◐',
  done: '✓',
}

/** 任务清单 tab: the agent's own plan, kept in sync via update_plan. */
export function PlanPanel(): JSX.Element {
  const { t } = useTranslation()
  const [items, setItems] = useState<PlanItemInfo[]>([])

  useEffect(() => {
    const refresh = (): void => void window.api.plan.get().then(setItems)
    refresh()
    const offPlan = window.api.plan.onUpdate(refresh)
    const offSession = window.api.session.onChange(refresh)
    return () => {
      offPlan()
      offSession()
    }
  }, [])

  const done = items.filter((i) => i.status === 'done').length

  return (
    <div className="plan-panel">
      <div className="panel-head">
        {t('plan.panelTitle')}
        {items.length > 0 && (
          <span className="sidebar-item-meta tnum">
            {done}/{items.length}
          </span>
        )}
      </div>
      {items.length === 0 && <div className="panel-empty prose dim">{t('plan.empty')}</div>}
      {items.map((item, i) => (
        <div key={`${i}-${item.text}`} className={`plan-row plan-${item.status}`}>
          <span className="plan-icon">{ICON[item.status]}</span>
          <span className="plan-text">{item.text}</span>
        </div>
      ))}
    </div>
  )
}
