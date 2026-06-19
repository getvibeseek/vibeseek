import { Menu, shell, app, type MenuItemConstructorOptions } from 'electron'
import { tr } from './i18n'

/**
 * Application menu. The Help → Open Logs Directory entry gives users a
 * one-click path to logs for bug reports. Rebuilt when the locale changes
 * (settings-ipc callback) so labels follow the UI language.
 *
 * macOS gets the standard App / Edit / Window menus on top. The Edit menu is
 * not cosmetic: ⌘C/⌘V/⌘X/⌘A in web inputs are bound to its cut/copy/paste/
 * selectAll roles, so WITHOUT it paste is dead in every text field (API-key
 * inputs, MCP form, memory editor…). Windows/Linux are frameless and keep the
 * minimal Help-only menu (its accelerators still work; no visible menu bar).
 */
export function buildMenu(logsDir: string): void {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = []

  if (isMac) {
    template.push({
      label: app.getName(),
      submenu: [
        { role: 'about', label: tr('menu.about', { name: app.getName() }) },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    })
    template.push({
      label: tr('menu.edit'),
      submenu: [
        { role: 'undo', label: tr('menu.undo') },
        { role: 'redo', label: tr('menu.redo') },
        { type: 'separator' },
        { role: 'cut', label: tr('menu.cut') },
        { role: 'copy', label: tr('menu.copy') },
        { role: 'paste', label: tr('menu.paste') },
        { role: 'selectAll', label: tr('menu.selectAll') },
      ],
    })
    template.push({ role: 'windowMenu', label: tr('menu.window') })
  }

  template.push({
    label: tr('menu.help'),
    submenu: [
      {
        label: tr('menu.openLogs'),
        click: () => shell.openPath(logsDir),
      },
      { type: 'separator' },
      {
        label: tr('menu.about', { name: app.getName() }),
        click: () => shell.openExternal('https://github.com/getvibeseek/vibeseek'),
      },
    ],
  })

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
