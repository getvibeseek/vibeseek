import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type { KeyStore } from '../security/key-store'

/**
 * @param onChange invoked after the stored key changes (set or clear) so the
 * balance can be re-fetched immediately — the paste-and-see-balance feedback.
 */
export function registerApiKeyIpc(keys: KeyStore, onChange: () => void): void {
  // set returns only the masked status — plaintext never crosses IPC.
  ipcMain.handle(IPC.apiKeySet, (_e, key: string) => {
    const status = keys.set(key)
    onChange()
    return status
  })
  ipcMain.handle(IPC.apiKeyStatus, () => keys.status())
  ipcMain.handle(IPC.apiKeyClear, () => {
    keys.clear()
    onChange()
  })
}
