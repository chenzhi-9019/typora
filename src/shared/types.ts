/**
 * Shared contract between the Electron main process, the preload bridge and the
 * renderer. Mirrors the surfaces Typora 1.14.15 exposes in its own preferences
 * schema (see codespec/specs/design.md).
 */

export type ThemeName = 'github' | 'night' | 'newsprint' | 'pixyll' | 'whitey'

export type SidebarTab = 'files' | 'outline' | 'search'

export interface EditorSettings {
  theme: ThemeName
  /** 0 keeps the theme's own font size. */
  fontSize: number
  /** 0 keeps the theme's own line height. */
  lineHeight: number
  /** 0 keeps the theme's own `#write` max width. */
  maxWidth: number
  autoNumber: boolean
  focusMode: boolean
  typewriterMode: boolean
  sourceCodeMode: boolean
  autoPairBracket: boolean
  autoPairMarkdown: boolean
  spellcheck: boolean
  wordWrap: boolean
  sidebarVisible: boolean
  sidebarTab: SidebarTab
  sidebarWidth: number
  autoHideMenuBar: boolean
  readonlyMode: boolean
  showStatusBar: boolean
  showToolbar: boolean
  alwaysOnTop: boolean
  /** line ending used when writing a file */
  eol: 'lf' | 'crlf'
  /** folder local images are copied into on insert; '' keeps them in place */
  imageRoot: string
  /** draw a marker where a <br> sits */
  showBr: boolean
  smartPunctuation: boolean
  remapPunctuation: boolean
  preserveLineBreak: boolean
  indentFirstLine: boolean

  // ---- 通用 / general
  alwaysShowWordCount: boolean
  collapsibleOutline: boolean
  autoSaveOnSwitch: boolean
  language: UiLanguage
  startupMode: StartupMode
  startupFolder: string
  autoQuit: boolean

  // ---- 编辑器 / editor
  showSourceOfActiveBlock: boolean
  autoCorrect: boolean
  indentSize: 2 | 3 | 4
  copyMarkdownOnCopy: boolean
  emojiAutocomplete: boolean

  // ---- 图像 / image
  insertImageRule: ImageInsertRule
  applyToLocalImages: boolean
  applyToRemoteImages: boolean
  uploadService: UploadService
  uploadCommand: string
  uploadOnInsert: boolean
  escapeImageUrl: boolean

  // ---- Markdown
  strictMode: boolean
  inlineMath: boolean
  subscript: boolean
  superscript: boolean
  highlight: boolean
  diagrams: boolean
  headingStyle: HeadingStyle
  unorderedMarker: '-' | '*' | '+'
  orderedMarker: '.' | ')'
  codeLineNumbers: boolean
  codeWrap: boolean

  // ---- 导出 / export
  exportFolder: string
  exportAfter: ExportAfter
  exportArgs: string
  exportKeepExtensions: boolean
  exportNoDialog: boolean
  exportShowCommandOutput: boolean

  // ---- 外观 / appearance
  windowStyle: WindowStyle
  debugMode: boolean

  lastOpenedFolder: string | null
  recentFiles: string[]
}

export type UiLanguage = 'system' | 'zh-Hans' | 'en'
export type StartupMode = 'new' | 'folder' | 'recent' | 'custom'
export type ImageInsertRule = 'none' | 'current' | 'assets' | 'filename' | 'custom'
export type UploadService = 'none' | 'picgo-app' | 'picgo-core' | 'custom'
export type HeadingStyle = 'atx' | 'setext' | 'hybrid'
export type ExportAfter = 'none' | 'reveal' | 'open'
export type WindowStyle = 'classic' | 'seamless'

export const DEFAULT_SETTINGS: EditorSettings = {
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

  alwaysShowWordCount: false,
  collapsibleOutline: true,
  autoSaveOnSwitch: false,
  language: 'system',
  startupMode: 'new',
  startupFolder: '',
  autoQuit: true,

  showSourceOfActiveBlock: false,
  autoCorrect: false,
  indentSize: 2,
  copyMarkdownOnCopy: false,
  emojiAutocomplete: true,

  insertImageRule: 'none',
  applyToLocalImages: true,
  applyToRemoteImages: false,
  uploadService: 'none',
  uploadCommand: '',
  uploadOnInsert: false,
  escapeImageUrl: true,

  strictMode: false,
  inlineMath: true,
  subscript: true,
  superscript: true,
  highlight: true,
  diagrams: true,
  headingStyle: 'atx',
  unorderedMarker: '-',
  orderedMarker: '.',
  codeLineNumbers: false,
  codeWrap: false,

  exportFolder: '',
  exportAfter: 'none',
  exportArgs: '',
  exportKeepExtensions: false,
  exportNoDialog: false,
  exportShowCommandOutput: false,

  windowStyle: 'classic',
  debugMode: false,

  lastOpenedFolder: null,
  recentFiles: []
}

export interface FileNode {
  name: string
  path: string
  isDirectory: boolean
  /** epoch millis */
  mtime: number
  size: number
  children?: FileNode[]
}

export interface FileContent {
  path: string
  content: string
  mtime: number
  /** true when the file exceeded the read guard and was truncated */
  truncated: boolean
}

export interface SaveResult {
  path: string
  mtime: number
}

export interface DocumentTab {
  id: string
  path: string | null
  title: string
  content: string
  savedContent: string
}

/** Every command id is defined once, in shared/menu.ts. */
export type MenuCommand = string

export interface MenuCommandPayload {
  command: MenuCommand
  /** e.g. the theme name for 'theme.set', the heading level for 'paragraph.heading1' */
  arg?: string | number
}