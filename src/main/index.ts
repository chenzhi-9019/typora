import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { quitRequestedByUser, registerAppCommandHandlers } from './app-commands'
import { registerAppHandlers } from './app-ipc'
import { registerConvertHandlers } from './convert'
import { applyDebugMode } from './debug'
import { registerDialogHandlers } from './dialogs'
import { registerExportHandlers } from './exporter'
import { registerFileHandlers } from './files'
import { buildApplicationMenu } from './menu'
import { currentSettings, loadSettings } from './settings'
import { pushStartupPlan } from './startup'
import { createWindow, registerWindowHandlers } from './window'

/** Wires the main process up once the app is ready. */
function bootstrap(): void {
  const settings = currentSettings()
  buildApplicationMenu(settings)
  registerAppHandlers()
  registerWindowHandlers()
  registerDialogHandlers()
  registerFileHandlers()
  registerExportHandlers()
  registerConvertHandlers()
  registerAppCommandHandlers()

  const mainWindow = createWindow()
  if (settings.debugMode) applyDebugMode(mainWindow)
  pushStartupPlan(mainWindow)
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.typora.desktop')
  app.on('browser-window-created', (_event, window) => {
    optimizer.watchWindowShortcuts(window)
  })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  await loadSettings()
  bootstrap()
})

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return
  // autoQuit = false keeps the process (and its settings) alive for the task bar,
  // but an explicit "quit" from the renderer must always win
  if (!currentSettings().autoQuit && !quitRequestedByUser()) return
  app.quit()
})
