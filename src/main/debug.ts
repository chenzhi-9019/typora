import { app, BrowserWindow } from 'electron'
import { appendFileSync } from 'fs'
import { join } from 'path'
import { inspect } from 'util'

const LOG_FILE = 'typora-debug.log'

let installed = false

function logPath(): string {
  return join(app.getPath('userData'), LOG_FILE)
}

function formatArgs(args: unknown[]): string {
  return args
    .map((value) =>
      typeof value === 'string' ? value : inspect(value, { depth: 3, breakLength: Infinity })
    )
    .join(' ')
}

/** Mirrors main-process console output into userData/typora-debug.log. */
export function enableDebugLog(): void {
  if (installed) return
  installed = true
  const original = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console)
  }
  const write = (level: string, args: unknown[]): void => {
    try {
      appendFileSync(logPath(), `[${new Date().toISOString()}] [${level}] ${formatArgs(args)}\n`)
    } catch {
      // a failing log file must never break the app
    }
  }
  console.log = (...args: unknown[]): void => {
    write('log', args)
    original.log(...args)
  }
  console.warn = (...args: unknown[]): void => {
    write('warn', args)
    original.warn(...args)
  }
  console.error = (...args: unknown[]): void => {
    write('error', args)
    original.error(...args)
  }
  // create the file eagerly so the feature is observable before anything logs
  write('debug', ['调试日志已启用'])
}

/** Debug mode: persistent log plus detached devtools on the editor window. */
export function applyDebugMode(window: BrowserWindow): void {
  enableDebugLog()
  if (window.isDestroyed()) return
  window.webContents.openDevTools({ mode: 'detach' })
}
