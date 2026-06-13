import { createContext, useCallback, useContext, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ConfirmOptions {
  message: string
  title?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Style the confirm button as destructive. */
  danger?: boolean
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

/** App-styled replacement for window.confirm — call `useConfirm()` to get an
 *  async confirm(opts) that resolves true/false (no more OS dialogs). */
export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext)
  if (!fn) throw new Error('useConfirm must be used within ConfirmProvider')
  return fn
}

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void
}

export function ConfirmProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const { t } = useTranslation()
  const [pending, setPending] = useState<Pending | null>(null)

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => setPending({ ...opts, resolve }))
  }, [])

  const close = (ok: boolean): void => {
    pending?.resolve(ok)
    setPending(null)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <div className="modal-overlay" onMouseDown={() => close(false)}>
          <div
            className={pending.danger ? 'modal modal-danger' : 'modal'}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {pending.title && <div className="modal-title">{pending.title}</div>}
            <div className="confirm-message">{pending.message}</div>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => close(false)}>
                {pending.cancelLabel ?? t('common.cancel')}
              </button>
              <button
                className={pending.danger ? 'btn btn-stop' : 'btn'}
                autoFocus
                onClick={() => close(true)}
              >
                {pending.confirmLabel ?? t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}
