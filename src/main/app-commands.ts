import { app, BrowserWindow, dialog } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { IPC } from '../shared/ipc'
import { googleSearch } from './external'
import { onInvoke } from './ipc-handle'

let quitRequested = false

/** True once the user asked to quit, so `autoQuit = false` stops holding the app open. */
export function quitRequestedByUser(): boolean {
  return quitRequested
}

function windowFrom(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
}

/** Electron prints through a callback; a user cancel is not an error. */
function printWindow(event: IpcMainInvokeEvent): Promise<void> {
  const window = windowFrom(event)
  if (!window) throw new Error('找不到需要打印的窗口')
  return new Promise<void>((resolve, reject) => {
    window.webContents.print({ silent: false, printBackground: true }, (success, failureReason) => {
      if (success || /cancel/i.test(failureReason ?? '')) {
        resolve()
        return
      }
      reject(new Error(`打印未完成：${failureReason || '未知原因'}`))
    })
  })
}

function inspectElement(event: IpcMainInvokeEvent): void {
  const window = windowFrom(event)
  if (!window) return
  // the frozen channel carries no coordinates, so the element picker is the best we can do
  window.webContents.openDevTools({ mode: 'detach' })
}

async function checkUpdates(event: IpcMainInvokeEvent): Promise<void> {
  const version = app.getVersion()
  const options = {
    type: 'info' as const,
    message: `当前版本 ${version}，已是最新版本`,
    detail: '本应用没有更新服务端，此检查只确认当前版本。',
    buttons: ['确定']
  }
  const window = windowFrom(event)
  if (window) await dialog.showMessageBox(window, options)
  else await dialog.showMessageBox(options)
}

export function registerAppCommandHandlers(): void {
  onInvoke(IPC.appQuit, () => {
    quitRequested = true
    app.quit()
  })
  onInvoke(IPC.appPrint, (event) => printWindow(event))
  onInvoke(IPC.appPageSetup, (event) => printWindow(event))
  onInvoke(IPC.appInspectElement, (event) => inspectElement(event))
  onInvoke(IPC.appCheckUpdates, (event) => checkUpdates(event))
  onInvoke(IPC.appGoogleSearch, (_event, query: string) => googleSearch(query))
}
