/* eslint-disable @typescript-eslint/explicit-function-return-type */
/**
 * Menu-command coverage self-proof.
 *
 *   node src/renderer/src/editor/scripts/coverage.mjs
 *
 * Loads MENU_COMMAND_IDS from src/shared/menu.ts and the real runCommand from
 * src/renderer/src/commands.ts (Node's native type stripping, no build step), drives
 * every id against a stub CommandContext, and reports:
 *   - runtime uncovered: ids whose dispatch logged '[commands] unhandled: <id>'
 *   - static diff: ids with neither a matched `case` literal nor a parameterised prefix
 * Both must be 0; the process exits non-zero otherwise.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../../../..')
const toUrl = (relative) => new URL('file:///' + path.join(repo, relative).replace(/\\/g, '/')).href

const settings = {
  theme: 'github',
  fontSize: 0,
  lineHeight: 0,
  maxWidth: 0,
  autoNumber: false,
  focusMode: false,
  typewriterMode: false,
  sourceCodeMode: false,
  autoPairBracket: true,
  autoPairMarkdown: true,
  spellcheck: false,
  wordWrap: true,
  sidebarVisible: false,
  sidebarTab: 'files',
  sidebarWidth: 240,
  autoHideMenuBar: false,
  readonlyMode: false,
  showStatusBar: true,
  showToolbar: false,
  alwaysOnTop: false,
  eol: 'lf',
  imageRoot: '',
  showBr: false,
  smartPunctuation: true,
  remapPunctuation: true,
  preserveLineBreak: false,
  indentFirstLine: false,
  lastOpenedFolder: null,
  recentFiles: []
}

const calls = []
const fakeEditor = {
  getValue: () => '# doc',
  setValue: (value) => calls.push(['setValue', value]),
  focus: () => calls.push(['focus']),
  setOptions: (patch) => calls.push(['setOptions', patch]),
  exec: (command, arg) => calls.push(['exec', command, arg]),
  destroy: () => undefined
}

const api = {
  settings: { get: async () => settings, patch: async () => settings, reset: async () => settings },
  window: {
    minimize: async () => undefined,
    toggleMaximize: async () => false,
    close: async () => undefined,
    isMaximized: async () => false,
    onMaximizedChanged: () => () => undefined,
    openNew: async () => undefined
  },

  dialog: {
    openFile: async () => null,
    openFolder: async () => null,
    saveAs: async () => null,
    message: async () => 0
  },
  fs: {
    readFile: async (filePath) => ({
      path: filePath,
      content: '# disk',
      mtime: 0,
      truncated: false
    }),
    writeFile: async (filePath) => ({ path: filePath, mtime: 0 }),
    readDir: async (filePath) => ({
      name: 'root',
      path: filePath,
      isDirectory: true,
      mtime: 0,
      size: 0
    }),
    exists: async () => false,
    copyFile: async (source, destination) => destination,
    createFile: async (filePath) => filePath,
    rename: async () => undefined,
    reveal: async () => undefined,
    watchFolder: async () => undefined,
    onFolderChanged: () => () => undefined
  },
  app: {
    version: async () => '1.0.0',
    initialFile: async () => null,
    openExternal: async () => undefined,
    quit: async () => undefined,
    print: async () => undefined,
    pageSetup: async () => undefined,
    inspectElement: async () => undefined,
    checkUpdates: async () => undefined
  },
  shell: { openExternal: async () => undefined, googleSearch: async () => undefined },
  onMenuCommand: () => () => undefined,
  export: {
    html: async () => null,
    pdf: async () => null,
    image: async () => null,
    convert: async () => null
  },
  importDoc: { markdown: async () => null },
  image: { upload: async (path) => path }
}

globalThis.window = { getSelection: () => null, open: () => null }
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    clipboard: {
      writeText: async () => undefined,
      readText: async () => '',
      write: async () => undefined
    }
  }
})
globalThis.fetch = async () => ({ blob: async () => ({ type: 'image/png' }) })
globalThis.ClipboardItem = class ClipboardItem {
  constructor(items) {
    this.items = items
  }
}
globalThis.document = {
  execCommand: () => true,
  querySelector: () => null,
  documentElement: { style: {}, requestFullscreen: async () => undefined },
  fullscreenElement: null,
  exitFullscreen: async () => undefined,
  createElement: () => ({
    style: {},
    setAttribute: () => undefined,
    appendChild: () => undefined,
    remove: () => undefined
  })
}

const ctx = {
  editor: () => fakeEditor,
  settings: () => settings,
  patchSettings: async (patch) => {
    Object.assign(settings, patch)
    calls.push(['patchSettings', patch])
  },
  api,
  setSidebarTab: (tab) => calls.push(['setSidebarTab', tab]),
  setDialog: (dialog) => calls.push(['setDialog', dialog]),
  replaceDocument: async (content) => calls.push(['replaceDocument', content]),
  newTab: async () => calls.push(['newTab']),
  closeTab: async () => calls.push(['closeTab']),
  currentPath: () => null,
  currentFolder: () => null,
  moveBlock: (direction) => calls.push(['moveBlock', direction]),
  createFileIn: async (folder) => calls.push(['createFileIn', folder]),
  createFolderIn: async (folder) => calls.push(['createFolderIn', folder]),
  renameEntry: async (path) => calls.push(['renameEntry', path]),
  duplicateEntry: async (path) => calls.push(['duplicateEntry', path]),
  moveEntryTo: async (path) => calls.push(['moveEntryTo', path])
}

const { MENU_COMMAND_IDS } = await import(toUrl('src/shared/menu.ts'))
const { runCommand } = await import(toUrl('src/renderer/src/commands.ts'))

const warnings = []
const originalWarn = console.warn
console.warn = (...args) => warnings.push(args.map(String).join(' '))

const unhandled = []
const failed = []
for (const id of MENU_COMMAND_IDS) {
  const before = warnings.length
  await runCommand(id, ctx)
  const produced = warnings.slice(before)
  if (produced.some((line) => line.includes('unhandled:'))) unhandled.push(id)
  if (produced.some((line) => line.includes('failed:'))) failed.push(id)
}
console.warn = originalWarn

const source = fs.readFileSync(path.join(repo, 'src/renderer/src/commands.ts'), 'utf8')
const literalIds = new Set([...source.matchAll(/case '([a-zA-Z0-9.]+)'/g)].map((match) => match[1]))
for (const match of source.matchAll(/'([a-zA-Z]+\.[a-zA-Z]+)':\s*'https/g)) literalIds.add(match[1])
const parameterizedPrefixes = ['theme.set:', 'format.zoomImage:', 'file.reopenEncoding:']
const staticUncovered = MENU_COMMAND_IDS.filter(
  (id) => !literalIds.has(id) && !parameterizedPrefixes.some((prefix) => id.startsWith(prefix))
)

console.log('MENU_COMMAND_IDS total   = ' + MENU_COMMAND_IDS.length)
console.log('runtime covered          = ' + (MENU_COMMAND_IDS.length - unhandled.length))
console.log('runtime uncovered        = ' + unhandled.length)
if (unhandled.length > 0) console.log('  -> ' + unhandled.join(', '))
console.log('static case-literal diff = ' + staticUncovered.length)
if (staticUncovered.length > 0) console.log('  -> ' + staticUncovered.join(', '))
console.log(
  'runtime failures         = ' +
    failed.length +
    (failed.length > 0 ? ' :: ' + failed.join(', ') : '')
)
console.log('editor exec calls        = ' + calls.filter((call) => call[0] === 'exec').length)
const ok = unhandled.length === 0 && staticUncovered.length === 0 && failed.length === 0
console.log(ok ? 'COVERAGE RESULT: 未覆盖 = 0 条' : 'COVERAGE RESULT: FAILED')
process.exit(ok ? 0 : 1)
