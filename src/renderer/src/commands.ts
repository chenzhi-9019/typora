import type { EditorCommand, EditorHandle } from './editor'
import type { EditorSettings } from '@shared/types'

/**
 * Single entry point for every menu command.
 *
 * `runCommand` answers for all ids in {@link MENU_COMMAND_IDS} (shared/menu.ts).
 * Commands that this renderer genuinely cannot perform are explicit no-ops with a
 * comment naming the missing capability, and they never fall through silently:
 * anything unrecognised logs `[commands] unhandled: <id>`, which the coverage
 * script asserts is empty.
 */

export interface CommandContext {
  editor: () => EditorHandle | null
  settings: () => EditorSettings
  patchSettings: (patch: Partial<EditorSettings>) => Promise<void>
  api: typeof window.api
  setSidebarTab: (tab: 'files' | 'outline' | 'search') => void
  setDialog: (dialog: 'none' | 'quickOpen' | 'wordCount') => void
  /** replaces the whole document, used by import */
  replaceDocument: (content: string) => Promise<void>
  /** opens a fresh tab holding an empty document */
  newTab: () => Promise<void>
  /** closes the active tab and loads whatever is left */
  closeTab: () => Promise<void>
  /** absolute path of the active document, null when untitled */
  currentPath: () => string | null
  /** folder the file tree is rooted at, null when the sidebar has no folder */
  currentFolder: () => string | null
  moveBlock: (direction: 'up' | 'down') => void
  createFileIn: (folder: string) => Promise<void>
  createFolderIn: (folder: string) => Promise<void>
  renameEntry: (path: string) => Promise<void>
  duplicateEntry: (path: string) => Promise<void>
  moveEntryTo: (path: string) => Promise<void>
  /** points the document layer at a path the user just picked in "save as" */
  adoptSaveAs: (path: string) => void
}

type BooleanSettingKey =
  | 'sidebarVisible'
  | 'focusMode'
  | 'typewriterMode'
  | 'sourceCodeMode'
  | 'readonlyMode'
  | 'showStatusBar'
  | 'showToolbar'
  | 'alwaysOnTop'
  | 'spellcheck'
  | 'showBr'
  | 'smartPunctuation'
  | 'remapPunctuation'
  | 'preserveLineBreak'
  | 'indentFirstLine'

/** Mirrors THEME_NAMES in shared/menu.ts (kept local so this module stays dependency-free). */
const THEMES = ['github', 'night', 'newsprint', 'pixyll', 'whitey']

const HELP_LINKS: Record<string, string> = {
  'help.quickStart': 'https://support.typora.io/Quick-Start/',
  'help.markdownReference': 'https://support.typora.io/Markdown-Reference/',
  'help.pandoc': 'https://support.typora.io/Install-and-Use-Pandoc/',
  'help.customThemes': 'https://theme.typora.io/',
  'help.images': 'https://support.typora.io/Images/',
  'help.recovery': 'https://support.typora.io/Backup-and-Version-Control/',
  'help.whatsNew': 'https://typora.io/releases/all',
  'help.credits': 'https://typora.io/',
  'help.changelog': 'https://typora.io/releases/all',
  'help.about': 'https://typora.io/'
}

/** Path of the document this session opened/saved, used by save/reload/reveal. */
let activePath: string | null = null
let zoomPercent = 100

function exec(ctx: CommandContext, command: EditorCommand, arg?: string | number): void {
  ctx.editor()?.exec(command, arg)
}

function syncEditorOptions(ctx: CommandContext, overrides: Partial<EditorSettings> = {}): void {
  const handle = ctx.editor()
  if (!handle) return
  const settings = { ...ctx.settings(), ...overrides }
  handle.setOptions({
    sourceCodeMode: settings.sourceCodeMode,
    focusMode: settings.focusMode,
    typewriterMode: settings.typewriterMode,
    wordWrap: settings.wordWrap
  })
  handle.exec('readonly', settings.readonlyMode ? 1 : 0)
  handle.exec('spellcheck', settings.spellcheck ? 1 : 0)
  handle.exec('showBr', settings.showBr ? 1 : 0)
  handle.exec('smartPunctuation', settings.smartPunctuation ? 1 : 0)
  handle.exec('remapPunctuation', settings.remapPunctuation ? 1 : 0)
  handle.exec('preserveLineBreak', settings.preserveLineBreak ? 1 : 0)
  handle.exec('indentFirstLine', settings.indentFirstLine ? 1 : 0)
}

async function applyBoolean(
  ctx: CommandContext,
  key: BooleanSettingKey,
  value?: boolean
): Promise<void> {
  const next = value ?? !ctx.settings()[key]
  await ctx.patchSettings({ [key]: next } as Partial<EditorSettings>)
  syncEditorOptions(ctx, { [key]: next } as Partial<EditorSettings>)
}

function applyZoom(percent: number): void {
  zoomPercent = Math.max(25, Math.min(400, percent))
  document.documentElement.style.zoom = String(zoomPercent / 100)
}

function currentAnchor(): HTMLAnchorElement | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const node = selection.getRangeAt(0).startContainer
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  return element?.closest('a') ?? null
}

async function saveActiveDocument(ctx: CommandContext): Promise<void> {
  const content = ctx.editor()?.getValue() ?? ''
  const path = activePath ?? ctx.currentPath()
  if (path === null) {
    // an untitled document has no target yet: ask for one instead of doing nothing
    const chosen = await ctx.api.dialog.saveAs()
    if (chosen === null) return
    await ctx.api.fs.writeFile(chosen, content)
    activePath = chosen
    ctx.adoptSaveAs(chosen)
    return
  }
  await ctx.api.fs.writeFile(path, content)
  activePath = path
}

function baseName(filePath: string): string {
  const parts = filePath.split(/[\\/]/)
  return parts[parts.length - 1] ?? filePath
}

function directoryOf(filePath: string): string {
  const index = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return index > 0 ? filePath.slice(0, index) : ''
}

function joinPath(directory: string, name: string): string {
  const separator = directory.includes('\\') && !directory.includes('/') ? '\\' : '/'
  return directory.replace(/[\\/]+$/, '') + separator + name
}

function isInside(directory: string, target: string): boolean {
  const rootPath = directory.replace(/\\/g, '/').replace(/\/+$/, '')
  const filePosix = target.replace(/\\/g, '/')
  return rootPath !== '' && filePosix.toLowerCase().startsWith(rootPath.toLowerCase() + '/')
}

/** Path of `target` relative to `fromDirectory`, or the absolute path when they differ at the root. */
function relativePath(fromDirectory: string, target: string): string {
  const split = (value: string): string[] =>
    value
      .replace(/\\/g, '/')
      .split('/')
      .filter((segment) => segment !== '')
  const from = split(fromDirectory)
  const to = split(target)
  if (from.length === 0 || to.length === 0) return target
  if ((from[0] ?? '').toLowerCase() !== (to[0] ?? '').toLowerCase()) return target
  let common = 0
  while (
    common < from.length &&
    common < to.length &&
    from[common].toLowerCase() === to[common].toLowerCase()
  ) {
    common += 1
  }
  const upwards = Array.from({ length: Math.max(0, from.length - common) }, () => '..')
  return [...upwards, ...to.slice(common)].join('/') || target
}

/** `photo.png` → `photo-1.png` while the destination is taken. */
async function uniqueDestination(
  ctx: CommandContext,
  directory: string,
  fileName: string
): Promise<string> {
  const dot = fileName.lastIndexOf('.')
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName
  const extension = dot > 0 ? fileName.slice(dot) : ''
  let candidate = joinPath(directory, fileName)
  let index = 1
  while (index <= 99 && (await ctx.api.fs.exists(candidate))) {
    candidate = joinPath(directory, stem + '-' + index + extension)
    index += 1
  }
  return candidate
}

/**
 * Inserts a local image. With settings.imageRoot set the file is copied there first
 * (binary copy through `fs.copyFile`) and the markdown gets a path relative to the
 * document folder; without imageRoot the picked path is inserted untouched.
 *
 * DEPENDS ON: `dialog.openFile('image')` — the main process narrows the filter to images
 * filter currently lists markdown/text only, so this branch lights up once that is widened.
 */
async function insertImageFromDialog(ctx: CommandContext): Promise<void> {
  const source = await ctx.api.dialog.openFile('image')
  if (source === null) {
    exec(ctx, 'image', '')
    return
  }
  const imageRoot = ctx.settings().imageRoot.trim()
  if (imageRoot === '') {
    exec(ctx, 'image', source)
    return
  }
  let finalPath = source
  if (!isInside(imageRoot, source)) {
    const destination = await uniqueDestination(ctx, imageRoot, baseName(source))
    try {
      finalPath = await ctx.api.fs.copyFile(source, destination)
    } catch (error) {
      console.warn('[commands] insertLocalImage: copy failed :: ' + String(error))
      finalPath = source
    }
  }
  const documentDirectory = activePath === null ? '' : directoryOf(activePath)
  exec(
    ctx,
    'image',
    documentDirectory === '' ? finalPath : relativePath(documentDirectory, finalPath)
  )
}

function imageUnderCaret(): HTMLImageElement | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const node = selection.getRangeAt(0).startContainer
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  const direct = element?.closest('img')
  if (direct) return direct as HTMLImageElement
  const block = element?.closest('p,h1,h2,h3,h4,h5,h6,li,td,th,blockquote,div')
  return (block?.querySelector('img') as HTMLImageElement | null) ?? null
}

function editorHtml(): string {
  return document.querySelector('#write')?.innerHTML ?? ''
}

function documentTitle(): string {
  const heading = document.querySelector('#write h1')?.textContent
  return heading !== undefined && heading !== '' ? heading : 'Typora'
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // clipboard permissions can be denied; the editor's own copy commands still work
  }
}

async function dispatch(id: string, ctx: CommandContext): Promise<void> {
  switch (id) {
    // ---------------------------------------------------------------- file
    case 'file.new':
      ctx.editor()?.setValue('')
      ctx.editor()?.focus()
      activePath = null
      return
    case 'file.newWindow':
      // no-op: window.api exposes minimize/toggleMaximize/close only; creating a second
      // BrowserWindow is a main-process capability that is not part of the frozen bridge.
      return
    case 'file.open': {
      const path = await ctx.api.dialog.openFile()
      if (path === null) return
      const file = await ctx.api.fs.readFile(path)
      activePath = path
      ctx.editor()?.setValue(file.content)
      ctx.editor()?.focus()
      return
    }
    case 'file.openFolder': {
      const folder = await ctx.api.dialog.openFolder()
      if (folder === null) return
      await ctx.api.fs.watchFolder(folder)
      await ctx.patchSettings({
        sidebarVisible: true,
        sidebarTab: 'files',
        lastOpenedFolder: folder
      })
      return
    }
    case 'file.quickOpen':
      ctx.setDialog('quickOpen')
      return
    case 'file.recentLocations': {
      const folder = ctx.settings().lastOpenedFolder
      if (folder === null) return
      await ctx.api.fs.watchFolder(folder)
      await ctx.patchSettings({ sidebarVisible: true, sidebarTab: 'files' })
      return
    }
    case 'file.clearRecent':
      await ctx.patchSettings({ recentFiles: [], lastOpenedFolder: null })
      return
    case 'file.reloadFromDisk': {
      if (activePath === null) {
        // no document path in CommandContext; App.vue owns the document store
        return
      }
      const file = await ctx.api.fs.readFile(activePath)
      ctx.editor()?.setValue(file.content)
      return
    }
    case 'file.save':
      await saveActiveDocument(ctx)
      return
    case 'file.saveAs': {
      const path = await ctx.api.dialog.saveAs(activePath ?? undefined)
      if (path === null) return
      await ctx.api.fs.writeFile(path, ctx.editor()?.getValue() ?? '')
      activePath = path
      return
    }
    case 'file.saveAll':
      // single-document shell: "save all" is "save"
      await saveActiveDocument(ctx)
      return
    case 'file.openFileLocation':
      if (activePath !== null) await ctx.api.fs.reveal(activePath)
      return
    case 'file.revealInSidebar':
      await ctx.patchSettings({ sidebarVisible: true, sidebarTab: 'files' })
      return
    case 'file.newTab':
      await ctx.newTab()
      return
    case 'view.closeTab':
      await ctx.closeTab()
      return
    case 'file.newFile': {
      const folder = ctx.currentFolder()
      if (folder) await ctx.createFileIn(folder)
      return
    }
    case 'file.newFolder': {
      const folder = ctx.currentFolder()
      if (folder) await ctx.createFolderIn(folder)
      return
    }
    case 'file.rename': {
      const path = ctx.currentPath()
      if (path) await ctx.renameEntry(path)
      return
    }
    case 'file.duplicate': {
      const path = ctx.currentPath()
      if (path) await ctx.duplicateEntry(path)
      return
    }
    case 'file.moveTo': {
      const path = ctx.currentPath()
      if (path) await ctx.moveEntryTo(path)
      return
    }
    case 'file.copyPath': {
      const path = ctx.currentPath()
      if (path) await navigator.clipboard.writeText(path)
      return
    }
    case 'file.openInNewWindow':
      await ctx.api.window.openNew()
      return
    case 'file.print':
      await ctx.api.app.print()
      return
    case 'file.pageSetup':
      await ctx.api.app.pageSetup()
      return
    case 'app.quit':
      await ctx.api.app.quit()
      return
    case 'view.inspectElement':
      await ctx.api.app.inspectElement()
      return
    case 'help.checkUpdates':
      await ctx.api.app.checkUpdates()
      return
    case 'help.website':
      await ctx.api.shell.openExternal('https://typora.io')
      return
    case 'help.feedback':
      await ctx.api.shell.openExternal('https://github.com/typora/typora-issues/issues')
      return
    case 'help.privacy':
      await ctx.api.shell.openExternal('https://typora.io/privacy-policy')
      return
    case 'edit.googleSearch':
      await ctx.api.shell.googleSearch(window.getSelection()?.toString().trim() || documentTitle())
      return
    case 'edit.spellCheck':
      await ctx.patchSettings({ spellcheck: !ctx.settings().spellcheck })
      return
    case 'edit.autoCorrect':
      await ctx.patchSettings({ autoCorrect: !ctx.settings().autoCorrect })
      return
    case 'paragraph.moveUp':
      ctx.moveBlock('up')
      return
    case 'paragraph.moveDown':
      ctx.moveBlock('down')
      return
    case 'file.import': {
      const imported = await ctx.api.importDoc.markdown()
      if (imported) await ctx.replaceDocument(imported.content)
      return
    }
    case 'export.html':
      await ctx.api.export.html({ title: documentTitle(), html: editorHtml() })
      return
    case 'export.pdf':
      await ctx.api.export.pdf({ title: documentTitle(), html: editorHtml() })
      return
    case 'export.image':
      await ctx.api.export.image({ title: documentTitle(), html: editorHtml() })
      return
    case 'export.docx':
    case 'export.epub':
    case 'export.latex':
    case 'export.rst':
    case 'export.textile':
    case 'export.opml':
    case 'export.rtf':
    case 'export.mediawiki':
    case 'export.org':
      await ctx.api.export.convert({
        title: documentTitle(),
        html: editorHtml(),
        format: id.slice('export.'.length)
      })
      return
    case 'file.preferences':
      // no-op: the Preferences window belongs to App.vue/main; CommandContext has no hook
      return
    case 'file.close':
      await ctx.api.window.close()
      return

    // ---------------------------------------------------------------- edit
    case 'edit.undo':
      exec(ctx, 'undo')
      return
    case 'edit.redo':
      exec(ctx, 'redo')
      return
    case 'edit.cut':
      document.execCommand('cut')
      return
    case 'edit.copy':
      document.execCommand('copy')
      return
    case 'edit.paste':
      exec(ctx, 'pastePlain')
      return
    case 'edit.copyImage':
      if (ctx.settings().sourceCodeMode) {
        exec(ctx, 'copyImage')
        return
      }
      if (imageUnderCaret() === null) {
        console.warn('[commands] edit.copyImage: no image under the caret')
        return
      }
      exec(ctx, 'copyImage')
      return
    case 'edit.copyPlain':
      exec(ctx, 'copyPlain')
      return
    case 'edit.copyMarkdown':
      exec(ctx, 'copyMarkdown')
      return
    case 'edit.copyHtml':
      exec(ctx, 'copyHtml')
      return
    case 'edit.copySemantic':
      exec(ctx, 'copySemantic')
      return
    case 'edit.pastePlain':
      exec(ctx, 'pastePlain')
      return
    case 'edit.selectAll':
      exec(ctx, 'selectAll')
      return
    case 'edit.selectBlock':
      exec(ctx, 'selectBlock')
      return
    case 'edit.selectLine':
      exec(ctx, 'selectLine')
      return
    case 'edit.selectPhrase':
      exec(ctx, 'selectPhrase')
      return
    case 'edit.selectWord':
      exec(ctx, 'selectWord')
      return
    case 'edit.jumpTop':
      exec(ctx, 'jumpTop')
      return
    case 'edit.jumpSelection':
      exec(ctx, 'jumpSelection')
      return
    case 'edit.jumpBottom':
      exec(ctx, 'jumpBottom')
      return
    case 'edit.jumpLineStart':
      exec(ctx, 'jumpLineStart')
      return
    case 'edit.jumpLineEnd':
      exec(ctx, 'jumpLineEnd')
      return
    case 'edit.extendTop':
      exec(ctx, 'extendTop')
      return
    case 'edit.extendBottom':
      exec(ctx, 'extendBottom')
      return
    case 'edit.extendLineStart':
      exec(ctx, 'extendLineStart')
      return
    case 'edit.extendLineEnd':
      exec(ctx, 'extendLineEnd')
      return
    case 'edit.delete':
      document.execCommand('delete')
      return
    case 'edit.deleteRange':
      document.execCommand('delete')
      return
    case 'edit.deleteBlock':
      exec(ctx, 'deleteBlock')
      return
    case 'edit.deleteLine':
      exec(ctx, 'deleteLine')
      return
    case 'edit.deleteScope':
      exec(ctx, 'deleteScope')
      return
    case 'edit.deleteWord':
      exec(ctx, 'deleteWord')
      return
    case 'edit.refreshMath':
      exec(ctx, 'refreshMath')
      return
    case 'edit.smartOnInput':
    case 'edit.smartOnRender':
    case 'edit.smartQuotes':
    case 'edit.smartDashes':
      await applyBoolean(ctx, 'smartPunctuation')
      return
    case 'edit.remapPunctuation':
      await applyBoolean(ctx, 'remapPunctuation')
      return
    case 'edit.lineEndingCrlf':
      await ctx.patchSettings({ eol: 'crlf' })
      return
    case 'edit.lineEndingLf':
      await ctx.patchSettings({ eol: 'lf' })
      return
    case 'edit.finalNewline':
      exec(ctx, 'finalNewline')
      return
    case 'edit.showBr':
      await applyBoolean(ctx, 'showBr')
      return
    case 'edit.preserveLineBreak':
      await applyBoolean(ctx, 'preserveLineBreak')
      return
    case 'edit.indentFirstLine':
      await applyBoolean(ctx, 'indentFirstLine')
      return
    case 'edit.find':
      exec(ctx, 'find')
      return
    case 'edit.findNext':
      exec(ctx, 'findNext')
      return
    case 'edit.findPrevious':
      exec(ctx, 'findPrevious')
      return
    case 'edit.replace':
      exec(ctx, 'replace')
      return
    case 'edit.spellNow':
      await applyBoolean(ctx, 'spellcheck', true)
      exec(ctx, 'spellcheck', 1)
      return
    case 'edit.spellWhileTyping':
      await applyBoolean(ctx, 'spellcheck')
      return

    // ----------------------------------------------------------- paragraph
    case 'paragraph.h1':
      exec(ctx, 'heading', 1)
      return
    case 'paragraph.h2':
      exec(ctx, 'heading', 2)
      return
    case 'paragraph.h3':
      exec(ctx, 'heading', 3)
      return
    case 'paragraph.h4':
      exec(ctx, 'heading', 4)
      return
    case 'paragraph.h5':
      exec(ctx, 'heading', 5)
      return
    case 'paragraph.h6':
      exec(ctx, 'heading', 6)
      return
    case 'paragraph.p':
      exec(ctx, 'paragraph')
      return
    case 'paragraph.headingUp':
      exec(ctx, 'headingUp')
      return
    case 'paragraph.headingDown':
      exec(ctx, 'headingDown')
      return
    case 'paragraph.table':
      exec(ctx, 'table')
      return
    case 'paragraph.tableRowAbove':
      exec(ctx, 'tableRowAbove')
      return
    case 'paragraph.tableRowBelow':
      exec(ctx, 'tableRowBelow')
      return
    case 'paragraph.tableColBefore':
      exec(ctx, 'tableColBefore')
      return
    case 'paragraph.tableColAfter':
      exec(ctx, 'tableColAfter')
      return
    case 'paragraph.tableDeleteRow':
      exec(ctx, 'tableDeleteRow')
      return
    case 'paragraph.tableDeleteCol':
      exec(ctx, 'tableDeleteCol')
      return
    case 'paragraph.tableCopy':
      exec(ctx, 'tableCopy')
      return
    case 'paragraph.tableFormat':
      exec(ctx, 'tableFormat')
      return
    case 'paragraph.tableDelete':
      exec(ctx, 'tableDelete')
      return
    case 'paragraph.math':
      exec(ctx, 'math')
      return
    case 'paragraph.fences':
      exec(ctx, 'codefence')
      return
    case 'paragraph.codeCopy':
      exec(ctx, 'codeCopy')
      return
    case 'paragraph.codeIndent':
      exec(ctx, 'codeIndent')
      return
    case 'paragraph.alertNote':
      exec(ctx, 'alert', 'note')
      return
    case 'paragraph.alertTip':
      exec(ctx, 'alert', 'tip')
      return
    case 'paragraph.alertImportant':
      exec(ctx, 'alert', 'important')
      return
    case 'paragraph.alertWarning':
      exec(ctx, 'alert', 'warning')
      return
    case 'paragraph.alertCaution':
      exec(ctx, 'alert', 'caution')
      return
    case 'paragraph.quote':
      exec(ctx, 'quote')
      return
    case 'paragraph.ol':
      exec(ctx, 'ol')
      return
    case 'paragraph.ul':
      exec(ctx, 'ul')
      return
    case 'paragraph.taskList':
      exec(ctx, 'task')
      return
    case 'paragraph.taskToggle':
      exec(ctx, 'taskToggle')
      return
    case 'paragraph.taskDone':
      exec(ctx, 'taskDone')
      return
    case 'paragraph.taskTodo':
      exec(ctx, 'taskTodo')
      return
    case 'paragraph.indent':
      exec(ctx, 'indent')
      return
    case 'paragraph.outdent':
      exec(ctx, 'outdent')
      return
    case 'paragraph.insertBefore':
      exec(ctx, 'insertBefore')
      return
    case 'paragraph.insertAfter':
      exec(ctx, 'insertAfter')
      return
    case 'paragraph.linkReference':
      exec(ctx, 'linkReference')
      return
    case 'paragraph.footnote':
      exec(ctx, 'footnote')
      return
    case 'paragraph.hr':
      exec(ctx, 'hr')
      return
    case 'paragraph.toc':
      exec(ctx, 'toc')
      return
    case 'paragraph.frontMatter':
      exec(ctx, 'frontMatter')
      return

    // -------------------------------------------------------------- format
    case 'format.strong':
      exec(ctx, 'bold')
      return
    case 'format.em':
      exec(ctx, 'italic')
      return
    case 'format.underline':
      exec(ctx, 'underline')
      return
    case 'format.code':
      exec(ctx, 'code')
      return
    case 'format.inlineMath':
      exec(ctx, 'inlineMath')
      return
    case 'format.strike':
      exec(ctx, 'strike')
      return
    case 'format.highlight':
      exec(ctx, 'highlight')
      return
    case 'format.superscript':
      exec(ctx, 'superscript')
      return
    case 'format.subscript':
      exec(ctx, 'subscript')
      return
    case 'format.comment':
      exec(ctx, 'comment')
      return
    case 'format.link':
      exec(ctx, 'link')
      return
    case 'format.openLink': {
      const anchor = currentAnchor()
      const href = anchor?.getAttribute('href') ?? ''
      if (href !== '') {
        await ctx.api.app.openExternal(href)
        return
      }
      // no anchor under the caret: let the engine try (it may open a markdown URL)
      exec(ctx, 'openLink')
      return
    }
    case 'format.copyLink': {
      const anchor = currentAnchor()
      const href = anchor?.getAttribute('href') ?? ''
      if (href !== '') {
        await copyToClipboard(href)
        return
      }
      exec(ctx, 'copyLink')
      return
    }
    case 'format.image':
      await insertImageFromDialog(ctx)
      return
    case 'format.insertLocalImage':
      await insertImageFromDialog(ctx)
      return
    case 'format.imageRoot': {
      const folder = await ctx.api.dialog.openFolder()
      if (folder !== null) await ctx.patchSettings({ imageRoot: folder })
      return
    }
    case 'format.clear':
      exec(ctx, 'clearFormat')
      return

    // ---------------------------------------------------------------- view
    case 'view.sidebar':
      await applyBoolean(ctx, 'sidebarVisible')
      return
    case 'view.outline':
      await ctx.patchSettings({ sidebarVisible: true, sidebarTab: 'outline' })
      ctx.setSidebarTab('outline')
      return
    case 'view.fileList':
    case 'view.fileTree':
      // this shell has a single file tree, so both items open the files tab
      await ctx.patchSettings({ sidebarVisible: true, sidebarTab: 'files' })
      ctx.setSidebarTab('files')
      return
    case 'view.search':
      await ctx.patchSettings({ sidebarVisible: true, sidebarTab: 'search' })
      ctx.setSidebarTab('search')
      return
    case 'view.sourceCodeMode':
      await applyBoolean(ctx, 'sourceCodeMode')
      return
    case 'view.readonlyMode':
      await applyBoolean(ctx, 'readonlyMode')
      return
    case 'view.focusMode':
      await applyBoolean(ctx, 'focusMode')
      return
    case 'view.typewriterMode':
      await applyBoolean(ctx, 'typewriterMode')
      return
    case 'view.statusBar':
      await applyBoolean(ctx, 'showStatusBar')
      return
    case 'view.toolbar':
      await applyBoolean(ctx, 'showToolbar')
      return
    case 'view.wordCountPopover':
      ctx.setDialog('wordCount')
      return
    case 'view.fullscreen':
      if (document.fullscreenElement === null) await document.documentElement.requestFullscreen()
      else await document.exitFullscreen()
      return
    case 'view.alwaysOnTop':
      await applyBoolean(ctx, 'alwaysOnTop')
      return
    case 'view.actualSize':
      applyZoom(100)
      return
    case 'view.zoomIn':
      applyZoom(zoomPercent + 10)
      return
    case 'view.zoomOut':
      applyZoom(zoomPercent - 10)
      return
    case 'view.switchDocument':
      // no-op: single-document shell; CommandContext has no tab registry to cycle through
      return
    case 'view.devTools':
      // no-op: the item carries role 'toggleDevTools', which the main process executes
      return

    // -------------------------------------------------------------- themes
    default:
      if (await dispatchParameterized(id, ctx)) return
      console.warn('[commands] unhandled: ' + id)
  }
}

async function dispatchParameterized(id: string, ctx: CommandContext): Promise<boolean> {
  if (id.startsWith('theme.set:')) {
    const theme = id.slice('theme.set:'.length)
    if (!THEMES.includes(theme)) return false
    await ctx.patchSettings({ theme: theme as EditorSettings['theme'] })
    return true
  }
  if (id.startsWith('format.zoomImage:')) {
    const percent = Number.parseInt(id.slice('format.zoomImage:'.length), 10)
    if (!Number.isFinite(percent)) return false
    exec(ctx, 'zoomImage', percent)
    return true
  }
  if (id.startsWith('file.reopenEncoding:')) {
    const encoding = id.slice('file.reopenEncoding:'.length)
    if (encoding !== 'UTF-8') {
      // no-op: api.fs.readFile decodes UTF-8 only, so other encodings cannot be honoured
      return true
    }
    if (activePath !== null) {
      const file = await ctx.api.fs.readFile(activePath)
      ctx.editor()?.setValue(file.content)
    }
    return true
  }
  if (id in HELP_LINKS) {
    await ctx.api.app.openExternal(HELP_LINKS[id])
    return true
  }
  return false
}

export async function runCommand(id: string, ctx: CommandContext): Promise<void> {
  try {
    await dispatch(id, ctx)
  } catch (error) {
    console.warn('[commands] failed: ' + id + ' :: ' + String(error))
  }
}
