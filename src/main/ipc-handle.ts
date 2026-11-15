import { app, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'

type InvokeHandler<Args extends unknown[], Result> = (
  event: IpcMainInvokeEvent,
  ...args: Args
) => Result | Promise<Result>

/** Registers an invokable channel; every handler waits for the app to be ready first. */
export function onInvoke<Args extends unknown[], Result>(
  channel: string,
  handler: InvokeHandler<Args, Result>
): void {
  ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    await app.whenReady()
    return handler(event, ...(args as Args))
  })
}
