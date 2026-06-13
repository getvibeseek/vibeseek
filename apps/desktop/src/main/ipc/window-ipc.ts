import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc'

export function registerWindowIpc(): void {
  const sender = (e: Electron.IpcMainEvent): BrowserWindow | null =>
    BrowserWindow.fromWebContents(e.sender)

  ipcMain.on(IPC.windowMinimize, (e) => sender(e)?.minimize())
  ipcMain.on(IPC.windowMaximize, (e) => {
    const win = sender(e)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on(IPC.windowClose, (e) => sender(e)?.close())
  ipcMain.handle(IPC.windowIsMaximized, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    return win?.isMaximized() ?? false
  })
}
