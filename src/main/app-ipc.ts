import { app, BrowserWindow, nativeTheme } from 'electron'
import { existsSync, statSync } from 'fs'
import { IPC } from '../shared/ipc'
import type { EditorSettings } from '../shared/types'
import { onInvoke } from './ipc-handle'
import { loadSettings, patchSettings, resetSettings } from './settings'
import { applyAlwaysOnTop, applyAutoHideMenuBar } from './window'
import { syncMenuState } from './menu'
import { openExternalUrl } from './external'
import { enableDebugLog } from './debug'
import { promptRestartIfNeeded } from './window-style'

const DARK_THEMES: ReadonlySet<string> = new Set(['night'])

/** Pushes a settings snapshot into the parts of the shell that mirror it. */
function applySettings(settings: EditorSettings): EditorSettings {
  applyAutoHideMenuBar(settings.autoHideMenuBar)
  applyAlwaysOnTop(settings.alwaysOnTop)
  // the native title bar and menus follow the theme, exactly like Typora does
  nativeTheme.themeSource = DARK_THEMES.has(settings.theme) ? 'dark' : 'light'
  syncMenuState(settings)
  if (settings.debugMode) enableDebugLog()
  // window chrome cannot change in place, so a style switch asks for a restart
  promptRestartIfNeeded(settings.windowStyle, BrowserWindow.getFocusedWindow() ?? undefined)
  return settings
}

/**
 * Resolves the Markdown file handed to the process, e.g. `typora notes.md` or
 * "Open with Typora" from Explorer. Flags are skipped; only existing files count.
 */
function initialFile(): string | null {
  const args = process.argv.slice(1)
  for (const arg of args) {
    if (arg.startsWith('-') || arg.startsWith('--')) continue
    if (!/\.(md|markdown|mdown|mkd|txt)$/i.test(arg)) continue
    const resolved = arg.replace(/^"|"$/g, '')
    if (!existsSync(resolved)) continue
    try {
      if (statSync(resolved).isDirectory()) continue
    } catch {
      continue
    }
    return resolved
  }
  return null
}

/**
 * Tells every window about a settings change. The originating window is included:
 * anything that writes through IPC directly (not via the renderer store) still needs
 * its reactive copy updated.
 */
function broadcastSettings(origin: number, settings: EditorSettings): void {
  void origin
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    window.webContents.send(IPC.settingsChanged, settings)
  }
}

export function registerAppHandlers(): void {
  onInvoke(IPC.settingsGet, () => loadSettings())
  onInvoke(IPC.settingsPatch, async (event, patch: Partial<EditorSettings>) => {
    const next = await patchSettings(patch)
    applySettings(next)
    broadcastSettings(event.sender.id, next)
    return next
  })
  onInvoke(IPC.settingsReset, async (event) => {
    const next = await resetSettings()
    applySettings(next)
    broadcastSettings(event.sender.id, next)
    return next
  })

  onInvoke(IPC.appVersion, () => app.getVersion())
  onInvoke(IPC.appInitialFile, () => initialFile())
  onInvoke(IPC.appOpenExternal, (_event, url: string) => openExternalUrl(url))
}
