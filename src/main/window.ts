import { BrowserWindow } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import { IPC } from '../shared/ipc'
import { onInvoke } from './ipc-handle'
import { currentSettings } from './settings'
import { openExternalUrl } from './external'
import { closeAuxWindowsIfOrphaned, windowBackground } from './aux-windows'
import { loadRendererPage } from './renderer-entry'
import { noteAppliedStyle, windowChromeOptions } from './window-style'

function windowFrom(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
}

function notifyMaximized(window: BrowserWindow, maximized: boolean): void {
  if (window.isDestroyed()) return
  window.webContents.send(IPC.windowMaximizedChanged, maximized)
}

/**
 * Close handshake, tracked per window instance: a close is held back until the
 * renderer answers with `window:close-confirmed`, and only the asking window is released.
 */
const closeRequested = new WeakSet<BrowserWindow>()
const closeConfirmed = new WeakSet<BrowserWindow>()

export function createWindow(): BrowserWindow {
  const settings = currentSettings()
  const window = new BrowserWindow({
    width: 1000,
    height: 760,
    minWidth: 400,
    minHeight: 300,
    show: false,
    autoHideMenuBar: settings.autoHideMenuBar,
    backgroundColor: windowBackground(),
    ...windowChromeOptions(settings.windowStyle),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  noteAppliedStyle(settings.windowStyle)
  window.on('ready-to-show', () => {
    window.show()
  })
  window.on('maximize', () => notifyMaximized(window, true))
  window.on('unmaximize', () => notifyMaximized(window, false))
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url).catch(() => undefined)
    return { action: 'deny' }
  })

  window.on('close', (event) => {
    if (closeConfirmed.has(window)) return
    event.preventDefault()
    if (closeRequested.has(window)) return
    closeRequested.add(window)
    window.webContents.send(IPC.windowCloseRequested)
    // an unresponsive renderer must never make the window impossible to close
    setTimeout(() => {
      if (!window.isDestroyed() && !closeConfirmed.has(window)) {
        closeConfirmed.add(window)
        window.close()
      }
    }, 5000)
  })
  window.on('closed', () => {
    closeAuxWindowsIfOrphaned()
  })

  loadRendererPage(window, 'index.html')
  return window
}

export function applyAutoHideMenuBar(autoHide: boolean): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.setAutoHideMenuBar(autoHide)
  }
}

export function applyAlwaysOnTop(alwaysOnTop: boolean): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.setAlwaysOnTop(alwaysOnTop)
  }
}

export function registerWindowHandlers(): void {
  onInvoke(IPC.windowMinimize, (event) => {
    windowFrom(event)?.minimize()
  })
  onInvoke(IPC.windowToggleMaximize, (event) => {
    const window = windowFrom(event)
    if (!window) return false
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
    return window.isMaximized()
  })
  onInvoke(IPC.windowClose, (event) => {
    windowFrom(event)?.close()
  })
  onInvoke(IPC.windowIsMaximized, (event) => windowFrom(event)?.isMaximized() ?? false)
  onInvoke(IPC.windowOpenNew, () => {
    createWindow()
  })
  onInvoke(IPC.windowCloseConfirmed, (event) => {
    const window = windowFrom(event)
    if (!window) return
    closeConfirmed.add(window)
    window.close()
  })
}
