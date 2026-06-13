import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type { PreviewService, PreviewBounds } from '../preview-service'

export function registerPreviewIpc(preview: PreviewService): void {
  ipcMain.on(IPC.previewShow, (_e, bounds: PreviewBounds, url?: string) =>
    preview.show(bounds, url ? String(url) : undefined)
  )
  ipcMain.on(IPC.previewSetBounds, (_e, bounds: PreviewBounds) => preview.setBounds(bounds))
  ipcMain.on(IPC.previewNavigate, (_e, url: string) => preview.navigate(String(url)))
  ipcMain.on(IPC.previewReload, () => preview.reload())
  ipcMain.on(IPC.previewHide, () => preview.hide())
  ipcMain.handle(IPC.previewDetect, () => preview.detect())
  ipcMain.handle(IPC.previewCurrentUrl, () => preview.currentUrl())
}
