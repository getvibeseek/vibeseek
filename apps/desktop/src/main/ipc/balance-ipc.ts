import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type { BalanceService } from '../balance-service'

export function registerBalanceIpc(balance: BalanceService): void {
  // A get triggers a fresh fetch and returns the result.
  ipcMain.handle(IPC.balanceGet, () => balance.refresh())
}
