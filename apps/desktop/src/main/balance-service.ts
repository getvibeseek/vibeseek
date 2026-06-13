import { BrowserWindow } from 'electron'
import { fetchBalance, type BalanceState } from '@vibeseek/core'
import { IPC } from '../shared/ipc'
import { notifyBackground } from './notifications'
import { tr } from './i18n'
import type { KeyStore } from './security/key-store'
import type { SettingsStore } from './store/settings-store'
import type { Logger } from './logging/logger'

const POLL_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes (throttled idle refresh)

/**
 * Owns balance fetching and fan-out to the renderer. Refreshes on demand (key
 * change, app start) and on a 5-minute idle poll. Each result is cached so the
 * titlebar can render immediately and logged to the api channel.
 */
export class BalanceService {
  private last: BalanceState = { status: 'no-key' }
  private timer: ReturnType<typeof setInterval> | undefined
  private inFlight = false
  // Low-balance alert fires once per threshold crossing, not on every poll.
  private alertedLow = false
  // Main-process listeners (e.g. the tray tooltip) besides the renderer.
  private readonly listeners: Array<(state: BalanceState) => void> = []

  constructor(
    private readonly keys: KeyStore,
    private readonly settings: SettingsStore,
    private readonly logger: Logger
  ) {}

  current(): BalanceState {
    return this.last
  }

  /** Subscribe a main-process listener to balance updates (tray etc.). */
  subscribe(cb: (state: BalanceState) => void): void {
    this.listeners.push(cb)
  }

  async refresh(): Promise<BalanceState> {
    if (this.inFlight) return this.last
    this.inFlight = true
    try {
      const apiKey = this.keys.get() ?? ''
      const state = await fetchBalance({ apiKey, baseUrl: this.settings.get('baseUrl') })
      this.last = state
      this.logger.api({ kind: 'balance', status: state.status })
      this.broadcast(state)
      this.checkLowBalance(state)
      return state
    } finally {
      this.inFlight = false
    }
  }

  startPolling(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.refresh(), POLL_INTERVAL_MS)
  }

  stopPolling(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  private broadcast(state: BalanceState): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IPC.balanceUpdate, state)
    }
    for (const cb of this.listeners) cb(state)
  }

  /** 余额预警: notify once when the balance crosses below the threshold. */
  private checkLowBalance(state: BalanceState): void {
    const threshold = this.settings.get('balanceAlertYuan')
    if (threshold === null || state.status !== 'ok') return
    const total = Number(state.data.infos[0]?.totalBalance ?? NaN)
    if (Number.isNaN(total)) return
    if (total < threshold && !this.alertedLow) {
      this.alertedLow = true
      notifyBackground(
        tr('notify.lowBalanceTitle'),
        tr('notify.lowBalanceBody', { n: total.toFixed(2) })
      )
    } else if (total >= threshold) {
      this.alertedLow = false
    }
  }
}
