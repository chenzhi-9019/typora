import { reactive } from 'vue'
import type { TyporaApi } from '@shared/api'
import { DEFAULT_SETTINGS, type EditorSettings } from '@shared/types'

/**
 * The auxiliary windows (preferences, welcome) talk to the preload bridge
 * directly instead of going through stores/, so each entry stays self-contained.
 *
 * The bridge is typed as always present, but a page opened outside Electron
 * (plain `vite dev`) has none: every call below degrades to local state so the
 * window still renders.
 */
const bridge: TyporaApi | undefined = window.api

export const settings = reactive<EditorSettings>({ ...DEFAULT_SETTINGS })

/** windows.css keys its night palette off `body[data-theme='night']`. */
function applyTheme(): void {
  document.body.dataset.theme = settings.theme
}

export async function loadSettings(): Promise<void> {
  if (bridge) Object.assign(settings, await bridge.settings.get())
  applyTheme()
}

export async function patchSettings(patch: Partial<EditorSettings>): Promise<void> {
  Object.assign(settings, bridge ? await bridge.settings.patch(patch) : patch)
  applyTheme()
}

export async function resetSettings(): Promise<void> {
  Object.assign(settings, bridge ? await bridge.settings.reset() : DEFAULT_SETTINGS)
  applyTheme()
}

export async function closeWindow(): Promise<void> {
  if (bridge) await bridge.window.close()
}

export async function openExternalUrl(url: string): Promise<void> {
  if (bridge) await bridge.app.openExternal(url)
}

export async function revealPath(path: string): Promise<void> {
  if (bridge) await bridge.fs.reveal(path)
}

export async function appVersion(): Promise<string> {
  return bridge ? bridge.app.version() : ''
}
