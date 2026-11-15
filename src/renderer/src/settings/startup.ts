import { settings } from '@renderer/stores/settings'
import type { StartupMode } from '@shared/types'

export interface StartupPlan {
  mode: StartupMode
  /** Folder the main process should open; '' when the plan opens no folder. */
  folder: string
}

/**
 * `startupMode` / `startupFolder` / `autoQuit`: these are MAIN-PROCESS settings — the
 * renderer cannot open a window or quit the app. This function only publishes the decision
 * so the main process can act on it (read the persisted settings, then
 * `startupPlan()` before creating the first window; `autoQuit` closes the app once the last
 * window is gone).
 */
export function startupPlan(): StartupPlan {
  const mode = settings.startupMode
  if (mode === 'folder' || mode === 'custom') {
    return { mode, folder: settings.startupFolder.trim() }
  }
  if (mode === 'recent') return { mode, folder: (settings.lastOpenedFolder ?? '').trim() }
  return { mode: 'new', folder: '' }
}
