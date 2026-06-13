import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import type { SettingsStore } from './store/settings-store'
import { IPC } from '../shared/ipc'

const isDev = !!process.env['ELECTRON_RENDERER_URL']

export function createMainWindow(settings: SettingsStore): BrowserWindow {
  const saved = settings.get('window')

  // Clamp the saved position to currently-visible displays so a window saved on
  // a now-disconnected monitor doesn't open off-screen.
  const bounds = sanitizeBounds(saved.x, saved.y, saved.width, saved.height)

  const win = new BrowserWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    show: false,
    backgroundColor: '#0e1015', // matches --bg-0 so the reveal doesn't flash
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (saved.maximized) win.maximize()

  win.once('ready-to-show', () => {
    win.webContents.setZoomFactor(settings.get('zoomFactor'))
    win.show()
  })

  persistWindowState(win, settings)
  forwardMaximizeState(win)

  if (isDev) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']!)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

function sanitizeBounds(
  x: number | null,
  y: number | null,
  width: number,
  height: number
): { x?: number; y?: number; width: number; height: number } {
  if (x === null || y === null) return { width, height }
  const visible = screen.getAllDisplays().some((d) => {
    const wa = d.workArea
    return x >= wa.x && y >= wa.y && x < wa.x + wa.width && y < wa.y + wa.height
  })
  return visible ? { x, y, width, height } : { width, height }
}

function persistWindowState(win: BrowserWindow, settings: SettingsStore): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const save = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      if (win.isDestroyed()) return
      const maximized = win.isMaximized()
      const b = win.getNormalBounds()
      settings.set('window', { width: b.width, height: b.height, x: b.x, y: b.y, maximized })
    }, 300)
  }
  win.on('resize', save)
  win.on('move', save)
  win.on('maximize', save)
  win.on('unmaximize', save)
  // Save synchronously on close so the final bounds always survive a restart.
  win.on('close', () => {
    if (timer) clearTimeout(timer)
    if (win.isDestroyed()) return
    const maximized = win.isMaximized()
    const b = win.getNormalBounds()
    settings.set('window', { width: b.width, height: b.height, x: b.x, y: b.y, maximized })
  })
}

function forwardMaximizeState(win: BrowserWindow): void {
  const emit = (): void => {
    if (!win.isDestroyed()) win.webContents.send(IPC.windowMaximizeChange, win.isMaximized())
  }
  win.on('maximize', emit)
  win.on('unmaximize', emit)
}
