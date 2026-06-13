import { ipcMain, dialog, app, BrowserWindow } from 'electron'
import { mkdtempSync, readdirSync, copyFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { redactSecrets, createShell } from '@vibeseek/core'
import { IPC } from '../../shared/ipc'
import type { SettingsStore } from '../store/settings-store'
import type { UsageStore } from '../db/usage-store'

interface Deps {
  logsDir: string
  settings: SettingsStore
  usage: UsageStore | null
}

/**
 * Diagnostics bundle: logs (7-day retention already applied) + version/
 * OS + REDACTED settings + usage summary → one zip the user can drag into a
 * GitHub issue. Zipped via PowerShell Compress-Archive (no extra dependency).
 */
export function registerDiagnosticsIpc(deps: Deps): void {
  ipcMain.handle(IPC.diagnosticsExport, async (): Promise<string | null> => {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const staging = mkdtempSync(join(tmpdir(), 'vibeseek-diag-'))
    try {
      // 1) Logs (the Logger already enforces redaction + 7-day retention).
      if (existsSync(deps.logsDir)) {
        for (const f of readdirSync(deps.logsDir)) {
          try {
            copyFileSync(join(deps.logsDir, f), join(staging, f))
          } catch {
            // a file may be locked mid-write — skip it
          }
        }
      }
      // 2) Environment snapshot.
      writeFileSync(
        join(staging, 'meta.json'),
        JSON.stringify(
          {
            app: app.getVersion(),
            electron: process.versions.electron,
            node: process.versions.node,
            platform: process.platform,
            arch: process.arch,
            os: process.getSystemVersion(),
            exportedAt: new Date().toISOString(),
          },
          null,
          2
        )
      )
      // 3) Settings, redacted (no key lives here, but redact defensively).
      writeFileSync(
        join(staging, 'settings-redacted.json'),
        JSON.stringify(redactSecrets(deps.settings.getAll()), null, 2)
      )
      // 4) Usage summary (aggregates only — never message content).
      writeFileSync(
        join(staging, 'usage-summary.json'),
        JSON.stringify(
          { totals: deps.usage?.totals() ?? null, byModel: deps.usage?.byModel('') ?? [] },
          null,
          2
        )
      )

      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      const target = await dialog.showSaveDialog(win, {
        defaultPath: `vibeseek-diagnostics-${stamp}.zip`,
        filters: [{ name: 'Zip', extensions: ['zip'] }],
      })
      if (target.canceled || !target.filePath) return null

      const shell = createShell()
      const res = await shell.run(
        `Compress-Archive -Path "${staging}\\*" -DestinationPath "${target.filePath}" -Force`,
        { timeoutMs: 60_000 }
      )
      if (res.code !== 0) throw new Error(res.stderr || 'Compress-Archive failed')
      return target.filePath
    } finally {
      rmSync(staging, { recursive: true, force: true })
    }
  })
}
