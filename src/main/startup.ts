import { statSync } from 'fs'
import type { BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc'
import type { EditorSettings, MenuCommandPayload, StartupMode } from '../shared/types'
import { currentSettings } from './settings'

export const STARTUP_COMMAND = 'app.startup'

export interface StartupPlan {
  /** effective mode; 'new' when the configured one has nothing to open */
  mode: StartupMode
  target: 'folder' | 'file' | 'none'
  path: string | null
}

function targetOf(path: string | null): 'folder' | 'file' | 'none' {
  if (!path) return 'none'
  try {
    return statSync(path).isDirectory() ? 'folder' : 'file'
  } catch {
    return 'none'
  }
}

function planFor(mode: StartupMode, path: string | null): StartupPlan {
  const target = targetOf(path)
  if (target === 'none') return { mode: 'new', target: 'none', path: null }
  return { mode, target, path }
}

/** Turns the startup settings into the plan the renderer has to carry out. */
export function startupPlan(settings: EditorSettings): StartupPlan {
  switch (settings.startupMode) {
    case 'folder':
      return planFor('folder', settings.lastOpenedFolder)
    case 'recent':
      return planFor('recent', settings.recentFiles[0] ?? null)
    case 'custom':
      return planFor('custom', settings.startupFolder || null)
    default:
      return { mode: 'new', target: 'none', path: null }
  }
}

/**
 * Hands the startup plan to a freshly created window. The renderer is normally
 * still loading, so the message waits for the first finished load.
 */
export function pushStartupPlan(window: BrowserWindow): void {
  const payload: MenuCommandPayload = {
    command: STARTUP_COMMAND,
    arg: JSON.stringify(startupPlan(currentSettings()))
  }
  const send = (): void => {
    if (window.isDestroyed()) return
    window.webContents.send(IPC.menuCommand, payload)
  }
  if (window.webContents.isLoadingMainFrame()) window.webContents.once('did-finish-load', send)
  else send()
}
