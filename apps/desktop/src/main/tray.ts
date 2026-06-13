import { Tray, Menu, nativeImage, app, type BrowserWindow, type NativeImage } from 'electron'
import type { BalanceState } from '@vibeseek/core'
import { tr } from './i18n'

/**
 * 托盘常驻余额 (idea credit: DeepSeekMonitorWindows, MIT): the tray
 * tooltip always carries the live API balance, so a glance at the taskbar
 * answers "还剩多少钱" without opening the window. Click restores the window.
 *
 * The icon is GENERATED — a neutral monochrome dot (R=G=B survives any
 * RGBA/BGRA channel-order difference in createFromBitmap across platforms).
 */
function trayIcon(): NativeImage {
  const size = 16
  const buf = Buffer.alloc(size * size * 4)
  const cx = (size - 1) / 2
  const r = size / 2 - 1.5
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx, y - cx)
      const alpha = d <= r ? 255 : d <= r + 1 ? Math.round(255 * (r + 1 - d)) : 0
      const i = (y * size + x) * 4
      buf[i] = 230 // identical channels — channel order can't bite
      buf[i + 1] = 230
      buf[i + 2] = 230
      buf[i + 3] = alpha
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size })
}

export class TrayService {
  private tray: Tray | null = null

  attach(win: BrowserWindow): void {
    this.tray = new Tray(trayIcon())
    this.tray.setToolTip('VibeSeek')
    const show = (): void => {
      if (win.isDestroyed()) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
    this.tray.on('click', show)
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: tr('tray.open'), click: show },
        { type: 'separator' },
        { label: tr('tray.quit'), click: () => app.quit() },
      ])
    )
  }

  /** Refresh the tooltip with the latest balance. */
  update(state: BalanceState): void {
    if (!this.tray) return
    const text =
      state.status === 'ok' && state.data.infos[0]
        ? tr('tray.balance', { n: Number(state.data.infos[0].totalBalance).toFixed(2) })
        : 'VibeSeek'
    this.tray.setToolTip(text)
  }

  /** Rebuild menu labels after a locale switch. */
  relabel(win: BrowserWindow): void {
    if (!this.tray) return
    this.tray.destroy()
    this.attach(win)
  }

  dispose(): void {
    this.tray?.destroy()
    this.tray = null
  }
}
