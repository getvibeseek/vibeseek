import { Notification, BrowserWindow } from 'electron'

/**
 * System notifications: fired ONLY when the app is in the background —
 * in the foreground the in-app UI already tells the story. Clicking focuses
 * the main window (and thereby the conversation that raised it).
 */
export function notifyBackground(title: string, body: string, onClick?: () => void): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed() || win.isFocused()) return
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body: body.slice(0, 200) })
  n.on('click', () => {
    if (!win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
    onClick?.()
  })
  n.show()
}
