import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ReceiptCard } from './ReceiptCard'
import type { ReceiptScope, TaskReceipt } from '../../../shared/ipc'

export interface ReceiptTarget extends ReceiptScope {
  /** Display name: conversation title or project folder name. */
  label: string
}

/** Bottom-right settlement popover: aggregate receipt for a conversation/project. */
export function ReceiptPopover({
  target,
  onClose,
}: {
  target: ReceiptTarget
  onClose: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const [receipt, setReceipt] = useState<TaskReceipt | null | 'loading'>('loading')

  useEffect(() => {
    setReceipt('loading')
    void window.api.receipt.get({ scope: target.scope, id: target.id }).then(setReceipt)
  }, [target.scope, target.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="receipt-popover">
      <div className="receipt-popover-head">
        <span className="receipt-popover-title">
          {target.scope === 'session' ? t('receipt.scopeSession') : t('receipt.scopeProject')} ·{' '}
          {target.label}
        </span>
        <button className="settings-modal-close" aria-label="close" onClick={onClose}>
          ✕
        </button>
      </div>
      {receipt === 'loading' ? (
        <div className="receipt-empty prose dim">{t('common.loading')}</div>
      ) : receipt === null ? (
        <div className="receipt-empty prose dim">{t('receipt.empty')}</div>
      ) : (
        <ReceiptCard receipt={receipt} />
      )}
    </div>
  )
}
