import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PermissionRequest, PermitGrant } from '../../../shared/ipc'

/** Modal that surfaces tool confirmations. One at a time. */
export function PermissionDialog(): JSX.Element | null {
  const { t } = useTranslation()
  const [req, setReq] = useState<PermissionRequest | null>(null)

  useEffect(() => window.api.permission.onRequest(setReq), [])

  if (!req) return null
  const respond = (grant: PermitGrant): void => {
    window.api.permission.respond(req.id, grant)
    setReq(null)
  }

  return (
    <div className="modal-overlay">
      <div className={`modal ${req.dangerous ? 'modal-danger' : ''}`}>
        <div className="modal-title">{req.dangerous ? t('perm.dangerTitle') : t('perm.title')}</div>
        <div className="modal-tool mono">{req.tool}</div>
        <pre className="modal-summary mono">{req.summary}</pre>
        <div className="modal-actions">
          <button className="btn-ghost" onClick={() => respond('deny')}>
            {t('perm.deny')}
          </button>
          <button className="btn-ghost" onClick={() => respond('once')}>
            {t('perm.once')}
          </button>
          <button className="btn-ghost" onClick={() => respond('session')}>
            {t('perm.session')}
          </button>
          <button className="btn" onClick={() => respond('project')}>
            {t('perm.project')}
          </button>
        </div>
      </div>
    </div>
  )
}
