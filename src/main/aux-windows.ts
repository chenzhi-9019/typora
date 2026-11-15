import { BrowserWindow, nativeTheme } from 'electron'
import { join } from 'path'
import { loadRendererPage } from './renderer-entry'

const LIGHT_BACKGROUND = '#ffffff'
const DARK_BACKGROUND = '#363b40'

interface AuxWindowOptions {
  page: string
  title: string
  width: number
  height: number
  minWidth?: number
  minHeight?: number
  parent?: BrowserWindow
}

let preferencesWindow: BrowserWindow | null = null
let welcomeWindow: BrowserWindow | null = null

/** Every window follows the theme through nativeTheme, which settings:patch keeps in sync. */
export function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? DARK_BACKGROUND : LIGHT_BACKGROUND
}

function createAuxWindow(options: AuxWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: options.width,
    height: options.height,
    minWidth: options.minWidth,
    minHeight: options.minHeight,
    parent: options.parent,
    title: options.title,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: windowBackground(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  window.setMenuBarVisibility(false)
  // keep the window title we were asked for, whatever the page calls itself
  window.on('page-title-updated', (event) => {
    event.preventDefault()
  })
  window.once('ready-to-show', () => {
    window.show()
  })
  loadRendererPage(window, options.page)
  return window
}

function focusExisting(window: BrowserWindow | null): BrowserWindow | null {
  if (!window || window.isDestroyed()) return null
  if (window.isMinimized()) window.restore()
  window.focus()
  return window
}

export function openPreferencesWindow(parent?: BrowserWindow): BrowserWindow {
  const existing = focusExisting(preferencesWindow)
  if (existing) return existing

  const window = createAuxWindow({
    page: 'preferences.html',
    title: '偏好设置',
    width: 900,
    height: 620,
    minWidth: 720,
    minHeight: 480,
    parent
  })
  preferencesWindow = window
  window.on('closed', () => {
    if (preferencesWindow === window) preferencesWindow = null
  })
  return window
}

export function openWelcomeWindow(parent?: BrowserWindow): BrowserWindow {
  const existing = focusExisting(welcomeWindow)
  if (existing) return existing

  const window = createAuxWindow({
    page: 'welcome.html',
    title: '欢迎',
    width: 760,
    height: 520,
    minWidth: 640,
    minHeight: 420,
    parent
  })
  welcomeWindow = window
  window.on('closed', () => {
    if (welcomeWindow === window) welcomeWindow = null
  })
  return window
}

/**
 * Aux windows are part of an editor session: once no editor window is left they
 * must go too, otherwise `window-all-closed` would never fire again.
 */
export function closeAuxWindowsIfOrphaned(): void {
  const aux = [preferencesWindow, welcomeWindow].filter(
    (window): window is BrowserWindow => window !== null && !window.isDestroyed()
  )
  if (aux.length === 0) return
  const editors = BrowserWindow.getAllWindows().filter((window) => !aux.includes(window))
  if (editors.length > 0) return
  for (const window of aux) window.close()
}
