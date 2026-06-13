import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc'
import type { Settings } from '../../shared/settings'
import type { SettingsStore } from '../store/settings-store'
import { setMainLocale } from '../i18n'

export function registerSettingsIpc(store: SettingsStore, onLocaleChange?: () => void): void {
  ipcMain.handle(IPC.settingsGetAll, () => store.getAll())

  ipcMain.handle(
    IPC.settingsSet,
    <K extends keyof Settings>(e: Electron.IpcMainInvokeEvent, key: K, value: Settings[K]) => {
      store.set(key, value)
      // Apply zoom immediately so Ctrl+=/− feedback is instant.
      if (key === 'zoomFactor') {
        BrowserWindow.fromWebContents(e.sender)?.webContents.setZoomFactor(value as number)
      }
      // Main-process strings (notices, menu) follow the UI language.
      if (key === 'locale') {
        setMainLocale(String(value))
        onLocaleChange?.()
      }
    }
  )
}
