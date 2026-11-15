import { computed, reactive, ref } from 'vue'
import { patchSettings, settings } from './settings'

export interface DocumentState {
  path: string | null
  content: string
  saved: string
  title: string
  mtime: number
}

interface TabState extends DocumentState {
  id: string
}

/**
 * `doc` always holds the document being edited; `tabs` keeps the other open
 * documents. Switching copies one into the other, so every consumer keeps talking
 * to a single reactive object.
 */
export const doc = reactive<DocumentState>({
  path: null,
  content: '',
  saved: '',
  title: '',
  mtime: 0
})

export const tabs = reactive<TabState[]>([])
export const activeTabId = ref<string>('')
export const showTabs = computed(() => tabs.length > 1)

export const isDirty = computed(() => doc.content !== doc.saved)

/**
 * Keeps the open document — and any tab pointing at the same file — pointing at a
 * renamed or moved path. Without this a later save would resurrect the old name.
 */
export function syncDocumentPath(from: string, to: string): void {
  const title = to.split(/[\\/]/).pop() ?? to
  if (doc.path === from) {
    doc.path = to
    doc.title = title
  }
  for (const tab of tabs) {
    if (tab.path === from) {
      tab.path = to
      tab.title = title
    }
  }
}

export const displayTitle = computed(() => doc.title || 'Typora')

let sequence = 0

function nextId(): string {
  sequence += 1
  return 'tab-' + sequence
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? ''
}

function syncWindowTitle(): void {
  document.title = doc.title ? `${doc.title} - Typora` : 'Typora'
}

export function snapshotActiveTab(): void {
  snapshot()
}

function snapshot(): void {
  const tab = tabs.find((entry) => entry.id === activeTabId.value)
  if (!tab) return
  tab.path = doc.path
  tab.content = doc.content
  tab.saved = doc.saved
  tab.title = doc.title
  tab.mtime = doc.mtime
}

function openTab(state: DocumentState): void {
  snapshot()
  const tab: TabState = { id: nextId(), ...state }
  tabs.push(tab)
  activeTabId.value = tab.id
  Object.assign(doc, state)
  syncWindowTitle()
}

export function switchTo(id: string): void {
  if (id === activeTabId.value) return
  const tab = tabs.find((entry) => entry.id === id)
  if (!tab) return
  snapshot()
  activeTabId.value = id
  Object.assign(doc, {
    path: tab.path,
    content: tab.content,
    saved: tab.saved,
    title: tab.title,
    mtime: tab.mtime
  })
  syncWindowTitle()
}

export function cycleTab(step: number): void {
  if (tabs.length < 2) return
  const index = tabs.findIndex((entry) => entry.id === activeTabId.value)
  const next = (index + step + tabs.length) % tabs.length
  switchTo(tabs[next].id)
}

export async function closeTab(id: string): Promise<void> {
  const index = tabs.findIndex((entry) => entry.id === id)
  if (index < 0) return
  const wasActive = id === activeTabId.value
  tabs.splice(index, 1)
  if (!wasActive) return
  const fallback = tabs[Math.min(index, tabs.length - 1)]
  if (fallback) {
    activeTabId.value = ''
    switchTo(fallback.id)
  } else {
    await newFile()
  }
}

export function setContent(content: string): void {
  doc.content = content
  snapshot()
}

function remember(path: string): void {
  const recent = [path, ...settings.recentFiles.filter((p) => p !== path)].slice(0, 12)
  void patchSettings({ recentFiles: recent })
}

export async function openFile(path: string): Promise<void> {
  const existing = tabs.find((entry) => entry.path === path)
  if (existing) {
    switchTo(existing.id)
    return
  }
  const file = await window.api.fs.readFile(path)
  const state: DocumentState = {
    path: file.path,
    content: file.content,
    saved: file.content,
    title: basename(path),
    mtime: file.mtime
  }
  // a pristine untitled document is replaced rather than kept as an empty tab
  const current = tabs.find((entry) => entry.id === activeTabId.value)
  if (current && current.path === null && current.content === current.saved) {
    Object.assign(current, state)
    Object.assign(doc, state)
    syncWindowTitle()
  } else {
    openTab(state)
  }
  remember(path)
}

export async function newFile(): Promise<void> {
  openTab({ path: null, content: '', saved: '', title: '', mtime: 0 })
}

export async function save(): Promise<boolean> {
  if (!doc.path) return saveAs()
  const result = await window.api.fs.writeFile(doc.path, doc.content)
  doc.saved = doc.content
  doc.mtime = result.mtime
  snapshot()
  return true
}

export async function saveAs(): Promise<boolean> {
  const target = await window.api.dialog.saveAs(doc.path ?? undefined)
  if (!target) return false
  const result = await window.api.fs.writeFile(target, doc.content)
  doc.path = result.path
  doc.saved = doc.content
  doc.mtime = result.mtime
  doc.title = basename(target)
  syncWindowTitle()
  snapshot()
  remember(target)
  return true
}

export async function openFileDialog(): Promise<void> {
  const path = await window.api.dialog.openFile()
  if (path) await openFile(path)
}
