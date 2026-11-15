import { reactive } from 'vue'
import { DEFAULT_SETTINGS, type EditorSettings } from '@shared/types'

export const settings = reactive<EditorSettings>({ ...DEFAULT_SETTINGS })

export async function loadSettings(): Promise<void> {
  Object.assign(settings, await window.api.settings.get())
  // the preferences window writes through IPC, so follow along when it does
  window.api.settings.onChanged((next) => Object.assign(settings, next))
}

export async function patchSettings(patch: Partial<EditorSettings>): Promise<void> {
  Object.assign(settings, await window.api.settings.patch(patch))
}

export function toggleSetting(key: 'focusMode' | 'typewriterMode' | 'sourceCodeMode' | 'wordWrap'): void {
  void patchSettings({ [key]: !settings[key] })
}
