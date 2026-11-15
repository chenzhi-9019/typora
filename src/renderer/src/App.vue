<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { EditorSettings } from '@shared/types'
import { runCommand, type CommandContext } from '@renderer/commands'
import { createEditor, type EditorHandle } from '@renderer/editor'
import MegaMenu from '@renderer/components/MegaMenu.vue'
import QuickOpen from '@renderer/components/QuickOpen.vue'
import Sidebar from '@renderer/components/Sidebar.vue'
import StatusBar from '@renderer/components/StatusBar.vue'
import WordCountPopover from '@renderer/components/WordCountPopover.vue'
import {
  activeTabId,
  closeTab,
  cycleTab,
  displayTitle,
  doc,
  isDirty,
  newFile,
  openFile,
  openFileDialog,
  save,
  saveAs,
  setContent,
  snapshotActiveTab
} from '@renderer/stores/document'
import TabBar from '@renderer/components/TabBar.vue'
import { charCount, nonSpaceCharCount, outline, wordCount } from '@renderer/stores/outline'
import { installSettingsEffects } from '@renderer/settings'
import {
  beginRename,
  createFileIn,
  createFolderIn,
  duplicateEntry,
  moveEntryTo,
  workspace
} from '@renderer/stores/workspace'
import { loadSettings, patchSettings, settings } from '@renderer/stores/settings'
import {
  installWorkspaceListeners,
  openFolder,
  revealInSidebar,
  setFolder,
  setSidebarTab,
  toggleSidebar
} from '@renderer/stores/workspace'

const writeHost = ref<HTMLElement | null>(null)
const editor = ref<EditorHandle | null>(null)
const menuOpen = ref(false)
const dialog = ref<'none' | 'quickOpen' | 'wordCount'>('none')
const zoom = ref(1)

let disposeMenu: (() => void) | null = null
let disposeClose: (() => void) | null = null
let disposeSettings: (() => void) | null = null

/** Every rendering setting the editor engine exposes through exec(). */
const EDITOR_SETTING_COMMANDS: { [K in keyof EditorSettings]?: string } = {
  strictMode: 'strictMode',
  inlineMath: 'inlineMathEnabled',
  subscript: 'subscriptEnabled',
  superscript: 'superscriptEnabled',
  highlight: 'highlightEnabled',
  diagrams: 'diagramsEnabled',
  headingStyle: 'headingStyle',
  unorderedMarker: 'unorderedMarker',
  orderedMarker: 'orderedMarker',
  codeLineNumbers: 'codeLineNumbers',
  codeWrap: 'codeWrap',
  autoNumber: 'autoNumber',
  autoPairBracket: 'autoPairBracket',
  autoPairMarkdown: 'autoPairMarkdown',
  autoCorrect: 'autoCorrect',
  showBr: 'showBr',
  indentFirstLine: 'indentFirstLine',
  smartPunctuation: 'smartPunctuation',
  remapPunctuation: 'remapPunctuation',
  preserveLineBreak: 'preserveLineBreak'
}

/** File-tree operations live in the workspace store; the menu just forwards. */
async function runFileTreeCommand(command: string): Promise<void> {
  const folder = workspace.root?.path ?? null
  const target = doc.path
  if (command === 'file.newFile' && folder) await createFileIn(folder)
  else if (command === 'file.newFolder' && folder) await createFolderIn(folder)
  else if (command === 'file.rename' && target) beginRename(target)
  else if (command === 'file.duplicate' && target) await duplicateEntry(target)
  else if (command === 'file.moveTo' && target) {
    const destination = await window.api.dialog.openFolder()
    if (destination) await moveEntryTo(target, destination)
  }
}

function syncEditorSettings(): void {
  const handle = editor.value
  if (!handle) return
  for (const [key, command] of Object.entries(EDITOR_SETTING_COMMANDS)) {
    const value = settings[key as keyof EditorSettings]
    if (command === undefined) continue
    if (typeof value === 'boolean') handle.exec(command as never, value ? 1 : 0)
    else if (typeof value === 'string') handle.exec(command as never, value)
  }
}

const context: CommandContext = {
  editor: () => editor.value,
  settings: () => settings as EditorSettings,
  patchSettings: (patch) => patchSettings(patch),
  api: window.api,
  setSidebarTab,
  setDialog: (next) => {
    dialog.value = next
  },
  replaceDocument: async (content) => {
    if (!(await confirmDiscard())) return
    await newFile()
    setContent(content)
    editor.value?.setValue(content)
    await resetScroll()
  },
  newTab: async () => {
    await newFile()
    editor.value?.setValue(doc.content)
    await resetScroll()
  },
  closeTab: async () => {
    await closeTab(activeTabId.value)
    editor.value?.setValue(doc.content)
    await resetScroll()
  },
  currentPath: () => doc.path,
  currentFolder: () => workspace.root?.path ?? null,
  moveBlock: (direction) => editor.value?.exec(direction === 'up' ? 'moveBlockUp' : 'moveBlockDown'),
  createFileIn: async (folder) => {
    await createFileIn(folder)
  },
  createFolderIn: async (folder) => {
    await createFolderIn(folder)
  },
  renameEntry: async (path) => beginRename(path),
  duplicateEntry: async (path) => {
    await duplicateEntry(path)
  },
  moveEntryTo: async (path) => {
    const destination = await window.api.dialog.openFolder()
    if (destination) await moveEntryTo(path, destination)
  },
  adoptSaveAs: (path) => {
    doc.path = path
    doc.title = path.split(/[\\/]/).pop() ?? path
    doc.saved = doc.content
    // the tab bar tracks dirtiness per tab, so the active tab needs the new baseline
    snapshotActiveTab()
  }
}

function run(id: string, arg?: string | number): void {
  void runCommand(arg === undefined ? id : `${id}:${arg}`, context)
}

async function confirmDiscard(): Promise<boolean> {
  if (!isDirty.value) return true
  const index = await window.api.dialog.message({
    type: 'warning',
    message: '当前文档有未保存的修改',
    detail: '是否先保存？',
    buttons: ['保存', '放弃', '取消']
  })
  if (index === 0) return save()
  return index === 1
}

const CONVERT_FORMATS = new Set([
  'docx',
  'epub',
  'latex',
  'rst',
  'textile',
  'opml',
  'rtf',
  'mediawiki',
  'org'
])

async function exportDocument(kind: string): Promise<void> {
  const element = writeHost.value?.querySelector('#write')
  if (!(element instanceof HTMLElement)) return
  const payload = {
    title: displayTitle.value,
    html: element.innerHTML,
    defaultPath: doc.path ?? undefined
  }
  try {
    if (kind === 'pdf') await window.api.export.pdf(payload)
    else if (kind === 'image') await window.api.export.image(payload)
    else if (kind === 'html') await window.api.export.html(payload)
    else if (CONVERT_FORMATS.has(kind)) await window.api.export.convert({ ...payload, format: kind })
  } catch (error) {
    await window.api.dialog.message({
      type: 'error',
      message: '导出失败',
      detail: error instanceof Error ? error.message : String(error),
      buttons: ['好']
    })
  }
}

async function importDocument(): Promise<void> {
  try {
    const imported = await window.api.importDoc.markdown()
    if (!imported) return
    if (!(await confirmDiscard())) return
    await newFile()
    setContent(imported.content)
    editor.value?.setValue(imported.content)
    await resetScroll()
  } catch (error) {
    await window.api.dialog.message({
      type: 'error',
      message: '导入失败',
      detail: error instanceof Error ? error.message : String(error),
      buttons: ['好']
    })
  }
}

/**
 * Document-level commands talk to the real document store, so they are handled
 * here; everything else is owned by commands.ts.
 */
async function applyStartupPlan(raw: unknown): Promise<void> {
  if (typeof raw !== 'string') return
  try {
    const plan = JSON.parse(raw) as { mode: string; target: string; path: string | null }
    if (!plan.path) return
    if (plan.target === 'file') {
      await openFile(plan.path)
      editor.value?.setValue(doc.content)
      await resetScroll()
    } else if (plan.target === 'folder') {
      await setFolder(plan.path)
    }
  } catch {
    // a malformed plan just means "start empty"
  }
}

async function dispatch(command: string, arg?: string | number): Promise<void> {
  if (command.startsWith('file.reopenEncoding')) {
    await window.api.dialog.message({
      type: 'info',
      message: '选择编码重新打开',
      detail: '当前版本只支持 UTF-8 文档。',
      buttons: ['好']
    })
    return
  }
  switch (command) {
    case 'view.zoomIn':
      zoom.value = Math.min(3, Number((zoom.value + 0.1).toFixed(2)))
      return
    case 'view.zoomOut':
      zoom.value = Math.max(0.4, Number((zoom.value - 0.1).toFixed(2)))
      return
    case 'view.actualSize':
      zoom.value = 1
      return
    case 'view.sidebar':
      toggleSidebar()
      return
    case 'file.new':
      if (!(await confirmDiscard())) return
      await newFile()
      editor.value?.setValue('')
      await resetScroll()
      return
    case 'file.open':
      if (!(await confirmDiscard())) return
      await openFileDialog()
      editor.value?.setValue(doc.content)
      await resetScroll()
      return
    case 'file.openFolder':
      await openFolder()
      return
    case 'file.quickOpen':
      dialog.value = 'quickOpen'
      return
    case 'file.newFile':
    case 'file.newFolder':
    case 'file.rename':
    case 'file.duplicate':
    case 'file.moveTo':
      await runFileTreeCommand(command)
      return
    case 'app.startup':
      await applyStartupPlan(arg)
      return
    case 'file.save':
      await save()
      return
    case 'file.saveAs':
      await saveAs()
      return
    case 'file.saveAll':
      await save()
      return
    case 'view.switchDocument':
      cycleTab(1)
      return
    case 'file.reloadFromDisk':
      if (doc.path) await openFile(doc.path)
      editor.value?.setValue(doc.content)
      return
    case 'file.openFileLocation':
      if (doc.path) await window.api.fs.reveal(doc.path)
      return
    case 'file.revealInSidebar':
      revealInSidebar(doc.path)
      return
    case 'file.clearRecent':
      await patchSettings({ recentFiles: [] })
      return
    case 'file.preferences':
      return
    case 'file.close':
      await window.api.window.close()
      return
    case 'file.import':
      await importDocument()
      return
    default:
      if (command.startsWith('export.')) {
        await exportDocument(command.slice('export.'.length))
        return
      }
      // main splits "theme.set:night" at the first colon; runCommand wants it whole
      await runCommand(arg === undefined ? command : `${command}:${String(arg)}`, context)
  }
}

function mountEditor(): void {
  if (!writeHost.value || editor.value) return
  editor.value = createEditor(writeHost.value, {
    value: doc.content,
    sourceCodeMode: settings.sourceCodeMode,
    focusMode: settings.focusMode,
    typewriterMode: settings.typewriterMode,
    wordWrap: settings.wordWrap,
    onChange: (value) => setContent(value),
    onOutline: (items) => {
      outline.value = items
    },
    onCount: (words, chars, nonSpace) => {
      wordCount.value = words
      charCount.value = chars
      nonSpaceCharCount.value = nonSpace
    }
  })
}

/** Outline clicks carry the 1-based line of the heading they point at. */
function onGotoLine(event: Event): void {
  const line = (event as CustomEvent<number>).detail
  if (typeof line !== 'number') return
  const article = writeHost.value?.querySelector('#write')
  if (!(article instanceof HTMLElement)) return
  const index = outline.value.findIndex((item) => item.line === line)
  if (index < 0) return
  const headings = article.querySelectorAll('h1, h2, h3, h4, h5, h6')
  const target = headings[index]
  if (!(target instanceof HTMLElement)) return
  target.scrollIntoView({ block: 'center' })
  const range = document.createRange()
  range.selectNodeContents(target)
  range.collapse(true)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

/** A freshly opened document always starts at the top of the page. */
async function resetScroll(): Promise<void> {
  await nextTick()
  const host = writeHost.value
  if (!host) return
  host.scrollTop = 0
  const article = host.querySelector('#write')
  if (article instanceof HTMLElement) article.scrollTop = 0
}

function onKeydown(event: KeyboardEvent): void {
  const mod = event.ctrlKey || event.metaKey
  if (!mod) return
  const key = event.key.toLowerCase()
  if (key === 's') {
    event.preventDefault()
    run(event.shiftKey ? 'file.saveAs' : 'file.save')
  } else if (key === 'o') {
    event.preventDefault()
    run(event.shiftKey ? 'file.openFolder' : 'file.open')
  } else if (key === 'n') {
    event.preventDefault()
    run(event.shiftKey ? 'file.newWindow' : 'file.new')
  } else if (key === 'f' || key === 'h') {
    event.preventDefault()
    run(event.shiftKey ? 'view.search' : 'edit.find')
  } else if (key === 'p') {
    event.preventDefault()
    run('file.quickOpen')
  }
}

watch(
  () => settings.theme,
  (theme) => {
    document.body.dataset.theme = theme
  },
  { immediate: true }
)

watch(
  () => [settings.sourceCodeMode, settings.focusMode, settings.typewriterMode, settings.wordWrap] as const,
  ([sourceCodeMode, focusMode, typewriterMode, wordWrap]) => {
    editor.value?.setOptions({ sourceCodeMode, focusMode, typewriterMode, wordWrap })
  }
)

watch(activeTabId, () => {
  // the editor keeps its own document; swap it when the active tab changes
  editor.value?.setValue(doc.content)
  void resetScroll()
})

onMounted(async () => {
  await loadSettings()
  document.body.dataset.theme = settings.theme
  mountEditor()
  installWorkspaceListeners()
  const initial = await window.api.app.initialFile().catch(() => null)
  if (initial) {
    await openFile(initial)
    editor.value?.setValue(doc.content)
    await resetScroll()
  }
  syncEditorSettings()
  disposeSettings = installSettingsEffects({
    root: document.querySelector<HTMLElement>('.typora-app'),
    getEditor: () => editor.value,
    setDialog: (next) => {
      dialog.value = next
    },
    patchSettings: (patch) => patchSettings(patch as Partial<EditorSettings>)
  })
  if (settings.lastOpenedFolder) await setFolder(settings.lastOpenedFolder).catch(() => undefined)
  disposeMenu = window.api.onMenuCommand((payload) => void dispatch(payload.command, payload.arg))
  disposeClose = window.api.window.onCloseRequested(() => {
    void confirmDiscard().then((ok) => {
      if (ok) void window.api.window.closeConfirmed()
    })
  })
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('typora:goto-line', onGotoLine)
})

onBeforeUnmount(() => {
  disposeMenu?.()
  disposeClose?.()
  disposeSettings?.()
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('typora:goto-line', onGotoLine)
  editor.value?.destroy()
})
</script>

<template>
  <div
    class="typora-app"
    :class="{
      'pin-outline': settings.sidebarVisible,
      'focus-mode': settings.focusMode,
      'readonly-mode': settings.readonlyMode
    }"
    :style="{ zoom: String(zoom) }"
  >
    <Sidebar v-if="settings.sidebarVisible" @menu="menuOpen = true" />
    <main class="typora-main" :class="{ 'with-sidebar': settings.sidebarVisible }">
      <TabBar />
      <div class="editor-scroll">
        <div ref="writeHost" class="editor-host" />
      </div>
      <StatusBar
        v-if="settings.showStatusBar"
        @word-count="dialog = dialog === 'wordCount' ? 'none' : 'wordCount'"
      />
    </main>
    <MegaMenu :open="menuOpen" @close="menuOpen = false" @command="(c, a) => run(c, a)" />
    <QuickOpen :open="dialog === 'quickOpen'" @close="dialog = 'none'" />
    <WordCountPopover
      :open="dialog === 'wordCount'"
      @close="dialog = 'none'"
    />
  </div>
</template>
