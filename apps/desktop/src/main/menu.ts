import { Menu, shell, app, type MenuItemConstructorOptions } from 'electron'
import { tr } from './i18n'

/**
 * Minimal application menu. The Help → Open Logs Directory entry gives
 * users a one-click path to logs for bug reports. Rebuilt when the locale
 * changes (settings-ipc callback) so labels follow the UI language.
 */
export function buildMenu(logsDir: string): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: tr('menu.help'),
      submenu: [
        {
          label: tr('menu.openLogs'),
          click: () => shell.openPath(logsDir),
        },
        { type: 'separator' },
        {
          label: tr('menu.about', { name: app.getName() }),
          click: () => shell.openExternal('https://github.com/qjg23/vibeseek'),
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
