import { app } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { DEFAULT_SETTINGS } from '../shared/types'
import type { EditorSettings } from '../shared/types'

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof EditorSettings)[]

let cache: EditorSettings | null = null

function settingsFile(): string {
  return join(app.getPath('userData'), 'conf.user.json')
}

function parse(text: string): Partial<EditorSettings> {
  try {
    // hand-edited files routinely carry a BOM, which JSON.parse rejects
    const parsed: unknown = JSON.parse(text.replace(/^\uFEFF/, ''))
    return typeof parsed === 'object' && parsed !== null ? (parsed as Partial<EditorSettings>) : {}
  } catch {
    return {}
  }
}

function merge(base: EditorSettings, patch: Partial<EditorSettings>): EditorSettings {
  const merged: EditorSettings = { ...base }
  for (const key of SETTING_KEYS) {
    const value = patch[key]
    if (value !== undefined) Object.assign(merged, { [key]: value })
  }
  return merged
}

async function persist(settings: EditorSettings): Promise<void> {
  await writeFile(settingsFile(), JSON.stringify(settings, null, 2), 'utf-8')
}

export async function loadSettings(): Promise<EditorSettings> {
  if (!cache) {
    try {
      cache = merge(DEFAULT_SETTINGS, parse(await readFile(settingsFile(), 'utf-8')))
    } catch {
      cache = { ...DEFAULT_SETTINGS }
    }
  }
  return cache
}

export function currentSettings(): EditorSettings {
  return cache ?? { ...DEFAULT_SETTINGS }
}

export async function patchSettings(patch: Partial<EditorSettings>): Promise<EditorSettings> {
  cache = merge(await loadSettings(), patch)
  await persist(cache)
  return cache
}

export async function resetSettings(): Promise<EditorSettings> {
  cache = { ...DEFAULT_SETTINGS }
  await persist(cache)
  return cache
}
