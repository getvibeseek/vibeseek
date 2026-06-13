import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { createMainWindow } from './window'
import { installCsp } from './security'
import { SettingsStore } from './store/settings-store'
import { KeyStore } from './security/key-store'
import { Logger } from './logging/logger'
import { openDatabase } from './db/database'
import { UsageStore } from './db/usage-store'
import { SessionStore } from './db/session-store'
import { BalanceService } from './balance-service'
import { AgentService } from './agent/agent-service'
import { buildMenu } from './menu'
import { registerWindowIpc } from './ipc/window-ipc'
import { registerSettingsIpc } from './ipc/settings-ipc'
import { registerApiKeyIpc } from './ipc/apikey-ipc'
import { registerBalanceIpc } from './ipc/balance-ipc'
import { registerAgentIpc } from './ipc/agent-ipc'
import { registerLogsIpc } from './ipc/logs-ipc'
import { registerDiagnosticsIpc } from './ipc/diagnostics-ipc'
import { PreviewService } from './preview-service'
import { registerPreviewIpc } from './ipc/preview-ipc'
import { TrayService } from './tray'
import { setMainLocale } from './i18n'

// Set a clean app name BEFORE anything touches userData. requestSingleInstanceLock
// and getPath('userData') both resolve the userData path from the app name and
// cache it, so the name must be set first or data lands in a scoped-package
// folder like "@vibeseek/desktop".
app.setName('VibeSeek')

// appUserModelId is required on Windows for notifications to display and group
// correctly (depended on by Stage 2).
app.setAppUserModelId('dev.vibeseek.app')

// Single-instance lock: focus the existing window instead of opening a second.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  let mainWindow: BrowserWindow | null = null

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    const logsDir = app.getPath('logs')
    const logger = new Logger(logsDir)

    // Main-process uncaught errors land in the app log.
    process.on('uncaughtException', (err) => {
      logger.appError('uncaughtException', { message: err.message, stack: err.stack })
    })
    process.on('unhandledRejection', (reason) => {
      logger.appError('unhandledRejection', { reason: String(reason) })
    })

    const userData = app.getPath('userData')
    const settings = new SettingsStore(join(userData, 'settings.json'))
    // A project folder deleted while the app was closed must not stay active —
    // every shell call would fail with a misleading ENOENT (user-hit case).
    // Recents are kept: a folder may just live on an unplugged drive.
    const lastDir = settings.get('projectDir')
    if (lastDir && !existsSync(lastDir)) {
      settings.set('projectDir', null)
      logger.appWarn('project dir vanished, deselected', { dir: lastDir })
    }
    const keys = new KeyStore(join(userData, 'apikey.enc'))
    const balance = new BalanceService(keys, settings, logger)

    let usage: UsageStore | null = null
    let sessionStore: SessionStore | null = null
    try {
      const db = openDatabase(join(userData, 'vibeseek.db'))
      usage = new UsageStore(db)
      sessionStore = new SessionStore(db)
      logger.appInfo('database ready')
    } catch (err) {
      logger.appError('database init failed', { message: String(err) })
    }

    const agent = new AgentService(settings, keys, logger, balance, usage, sessionStore)

    setMainLocale(settings.get('locale'))
    installCsp()
    buildMenu(logsDir)
    registerWindowIpc()
    const tray = new TrayService()
    registerSettingsIpc(settings, () => {
      buildMenu(logsDir)
      if (mainWindow) tray.relabel(mainWindow)
      tray.update(balance.current())
    })
    registerApiKeyIpc(keys, () => void balance.refresh())
    registerBalanceIpc(balance)
    registerAgentIpc(agent, settings)
    registerLogsIpc(logger, logsDir)
    registerDiagnosticsIpc({ logsDir, settings, usage })

    logger.appInfo('app ready', { version: app.getVersion() })
    mainWindow = createMainWindow(settings)

    // 预览浏览器: embedded dev-server view over the right panel.
    const preview = new PreviewService()
    preview.attach(mainWindow)
    registerPreviewIpc(preview)

    // 托盘常驻余额: tooltip carries the live balance.
    tray.attach(mainWindow)
    balance.subscribe((state) => tray.update(state))
    app.on('before-quit', () => tray.dispose())

    // Initial balance fetch + idle polling once the window is up.
    void balance.refresh()
    balance.startPolling()

    // Kill MCP child processes on quit so no server is left running.
    app.on('before-quit', () => agent.disposeMcp())

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow(settings)
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
