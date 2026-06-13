import { ipcMain, shell } from 'electron'
import { IPC } from '../../shared/ipc'
import type { Logger } from '../logging/logger'

export function registerLogsIpc(logger: Logger, logsDir: string): void {
  ipcMain.on(IPC.logsOpenDir, () => {
    shell.openPath(logsDir)
  })

  ipcMain.on(IPC.logsReportError, (_e, message: string, meta?: unknown) => {
    logger.appError(`[renderer] ${message}`, meta)
  })
}
