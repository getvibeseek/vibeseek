import { WebContentsView, type BrowserWindow } from 'electron'
import { request as httpRequest } from 'node:http'

/** Common local dev-server ports, most likely first (Vite, CRA/Next, generic). */
const DEV_PORTS = [5173, 3000, 5174, 8080, 4321, 8000, 1420, 4200, 5500]

/** In dev, OUR own renderer runs on one of these ports — never offer it. */
const SELF_PORT = (() => {
  try {
    const self = process.env['ELECTRON_RENDERER_URL']
    return self ? Number(new URL(self).port) : null
  } catch {
    return null
  }
})()

/** Only ever load local dev servers — the preview is not a general browser. */
function isAllowed(url: string): boolean {
  try {
    const u = new URL(url)
    return (
      (u.protocol === 'http:' || u.protocol === 'https:') &&
      (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]')
    )
  } catch {
    return false
  }
}

export interface PreviewBounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 预览浏览器: one embedded WebContentsView overlaid on the right-panel
 * area, showing the project's dev server. The renderer reports the panel rect
 * (CSS px); we convert by the window zoom factor and pin the view there.
 */
export class PreviewService {
  private view: WebContentsView | null = null
  private win: BrowserWindow | null = null
  private lastBounds: PreviewBounds | null = null

  attach(win: BrowserWindow): void {
    this.win = win
  }

  /** Show (creating if needed) at the given renderer-rect, optionally navigating. */
  show(bounds: PreviewBounds, url?: string): void {
    const win = this.win
    if (!win || win.isDestroyed()) return
    if (!this.view) {
      this.view = new WebContentsView({
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      })
      // The preview stays a dev-server window: external links open nowhere.
      this.view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      this.view.webContents.on('will-navigate', (e, target) => {
        if (!isAllowed(target)) e.preventDefault()
      })
      win.contentView.addChildView(this.view)
    }
    this.setBounds(bounds)
    if (url && isAllowed(url)) void this.view.webContents.loadURL(url)
  }

  /** Reposition to track the renderer panel (zoom-aware). */
  setBounds(bounds: PreviewBounds): void {
    const win = this.win
    if (!win || win.isDestroyed() || !this.view) return
    const z = win.webContents.getZoomFactor()
    this.lastBounds = bounds
    this.view.setBounds({
      x: Math.round(bounds.x * z),
      y: Math.round(bounds.y * z),
      width: Math.round(bounds.width * z),
      height: Math.round(bounds.height * z),
    })
  }

  navigate(url: string): void {
    if (this.view && isAllowed(url)) void this.view.webContents.loadURL(url)
  }

  reload(): void {
    this.view?.webContents.reload()
  }

  currentUrl(): string {
    return this.view?.webContents.getURL() ?? ''
  }

  /** Remove the view from the window (tab switched away / panel closed). */
  hide(): void {
    if (this.win && !this.win.isDestroyed() && this.view) {
      this.win.contentView.removeChildView(this.view)
    }
    this.view?.webContents.close()
    this.view = null
    this.lastBounds = null
  }

  /** Probe common dev ports; resolves the first URL that answers, else null. */
  async detect(): Promise<string | null> {
    for (const port of DEV_PORTS) {
      if (port === SELF_PORT) continue
      const ok = await new Promise<boolean>((resolve) => {
        const req = httpRequest(
          { host: '127.0.0.1', port, path: '/', method: 'GET', timeout: 350 },
          (res) => {
            res.resume()
            resolve(true)
          }
        )
        req.on('timeout', () => {
          req.destroy()
          resolve(false)
        })
        req.on('error', () => resolve(false))
        req.end()
      })
      if (ok) return `http://localhost:${port}`
    }
    return null
  }
}
