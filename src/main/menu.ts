import { app, BrowserWindow, Menu } from 'electron'
import type { BaseWindow, MenuItemConstructorOptions } from 'electron'
import { IPC } from '../shared/ipc'
import { resolveLocale } from '../shared/i18n'
import type { Locale } from '../shared/i18n'
import { MENU } from '../shared/menu'
import type { MenuItem as MenuTreeItem, TopMenu } from '../shared/menu'
import type { EditorSettings, MenuCommandPayload, ThemeName } from '../shared/types'
import { createWindow } from './window'
import { openPreferencesWindow, openWelcomeWindow } from './aux-windows'

/** Commands that carry a value are written `command:arg` in the menu tree ids. */
const ARG_SEPARATOR = ':'
const THEME_COMMAND = 'theme.set'

let builtTheme: ThemeName | null = null
let builtLocale: Locale | null = null

/** The OS languages, asked only while a menu is being built. */
function systemLanguages(): readonly string[] {
  try {
    return app.getPreferredSystemLanguages()
  } catch {
    return [app.getLocale()]
  }
}

/** Labels are baked into the template, so the tree carries one per shipped locale. */
function labelOf(item: MenuTreeItem | TopMenu, locale: Locale): string {
  return locale === 'en' ? item.labelEn : item.label
}

function resolveWindow(window: BaseWindow | undefined): BrowserWindow | undefined {
  if (window instanceof BrowserWindow) return window
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
}

/** `theme.set:night` becomes `{ command: 'theme.set', arg: 'night' }`; a bare id has no arg. */
function splitCommand(id: string): MenuCommandPayload {
  const index = id.indexOf(ARG_SEPARATOR)
  if (index < 0) return { command: id }
  return { command: id.slice(0, index), arg: id.slice(index + 1) }
}

function sendCommand(window: BaseWindow | undefined, id: string): void {
  const target = resolveWindow(window)
  if (!target || target.isDestroyed()) return
  target.webContents.send(IPC.menuCommand, splitCommand(id))
}

function isChecked(item: MenuTreeItem, settings: EditorSettings): boolean {
  if (item.kind === 'radio') return item.id === `${THEME_COMMAND}${ARG_SEPARATOR}${settings.theme}`
  if (item.setting) return Boolean(settings[item.setting])
  return false
}

/** Window changes the renderer cannot do on its own, so the main process also acts. */
function performWindowAction(id: string, window: BaseWindow | undefined): void {
  if (id === 'file.newWindow') {
    createWindow()
    return
  }
  const target = resolveWindow(window)
  if (id === 'file.preferences') {
    openPreferencesWindow(target)
    return
  }
  if (id === 'help.whatsNew') {
    openWelcomeWindow(target)
    return
  }
  if (!target || target.isDestroyed()) return
  if (id === 'view.fullscreen') target.setFullScreen(!target.isFullScreen())
  else if (id === 'file.close') target.close()
}

function buildItems(
  items: MenuTreeItem[],
  settings: EditorSettings,
  locale: Locale
): MenuItemConstructorOptions[] {
  return items.map((item) => buildItem(item, settings, locale))
}

function buildItem(
  item: MenuTreeItem,
  settings: EditorSettings,
  locale: Locale
): MenuItemConstructorOptions {
  if (item.kind === 'separator') return { type: 'separator' }
  if (item.submenu) {
    return {
      id: item.id,
      label: labelOf(item, locale),
      accelerator: item.accelerator,
      submenu: buildItems(item.submenu, settings, locale)
    }
  }
  if (item.role) {
    return {
      id: item.id,
      label: labelOf(item, locale),
      accelerator: item.accelerator,
      role: item.role
    }
  }

  const options: MenuItemConstructorOptions = {
    id: item.id,
    label: labelOf(item, locale),
    accelerator: item.accelerator,
    type: item.kind === 'checkbox' || item.kind === 'radio' ? item.kind : 'normal',
    // The renderer owns the settings for these items: it patches, the patch comes
    // back through settings:patch, and syncMenuState re-checks the tree. Toggling
    // here as well would flip every checkbox twice.
    click: (_menuItem, window) => {
      sendCommand(window, item.id)
      performWindowAction(item.id, window)
    }
  }
  if (item.kind === 'checkbox' || item.kind === 'radio') options.checked = isChecked(item, settings)
  return options
}

function menuTemplate(settings: EditorSettings, locale: Locale): MenuItemConstructorOptions[] {
  return MENU.map((top) => ({
    id: top.id,
    label: labelOf(top, locale),
    submenu: buildItems(top.items, settings, locale)
  }))
}

export function buildApplicationMenu(settings: EditorSettings): void {
  const locale = resolveLocale(settings.language, systemLanguages())
  builtTheme = settings.theme
  builtLocale = locale
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate(settings, locale)))
}

function syncItems(items: MenuTreeItem[], menu: Menu, settings: EditorSettings): void {
  for (const item of items) {
    if (item.submenu) syncItems(item.submenu, menu, settings)
    if (!item.setting) continue
    const target = menu.getMenuItemById(item.id)
    if (target) target.checked = Boolean(settings[item.setting])
  }
}

/** Re-aligns every checkable menu item with a settings snapshot. */
export function syncMenuState(settings: EditorSettings): void {
  const locale = resolveLocale(settings.language, systemLanguages())
  if (settings.theme !== builtTheme || locale !== builtLocale) {
    // Radio items (the theme list) only honour `checked` while the menu is built,
    // and labels are baked into the template, so a theme or language switch rebuilds.
    buildApplicationMenu(settings)
    return
  }
  const menu = Menu.getApplicationMenu()
  if (!menu) return
  syncItems(
    MENU.flatMap((top) => top.items),
    menu,
    settings
  )
}
