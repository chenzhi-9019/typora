import type { EditorCommand } from './index'
import {
  currentSerializationOptions,
  serializeDocument,
  serializeSelection,
  setPreserveLineBreak,
  setSerializationOptions,
  setSmartPunctuation
} from './dom-to-markdown'
import { copyImageBytes, copyPayload, copyText, readClipboardText } from './clipboard'
import { renderDiagrams } from './diagram'
import { insertImageSource } from '../settings/images'
import {
  renderMarkdown,
  renderMathBlockHtml,
  renderMathInlineHtml,
  setRenderOptions
} from './markdown-renderer'
import {
  caretOffsetIn,
  deleteOffsets,
  rangeForOffsets,
  centerElementInView,
  currentCaretPosition,
  currentRange,
  nearestBlockAt,
  placeCaretAtEnd,
  placeCaretWithin,
  selectRange,
  setCaretPosition,
  topLevelBlockAt
} from './dom-selection'
import type { CaretPosition } from './dom-selection'
import { findTypoFix, isClosingPair, pairCloserFor } from './text-rules'
import { listCodeLanguages } from './markdown-renderer'
import { createFindBar } from './find-bar'
import type { FindBar } from './find-bar'

const COMMIT_DEBOUNCE = 60
const TYPING_GROUP = 600
const PARAGRAPH_CLASS = 'md-end-block md-p'
const HEADING_RE = /^H([1-6])$/
const WORD_CHAR_RE = /[\p{L}\p{N}_'-]/u
const URL_ESCAPE_RE = /[.*+?^${}()|[\]\\]/g

type EditOrigin = 'input' | 'command'
type ListKind = 'ul' | 'ol' | 'task'
type InlineTag = 'STRONG' | 'EM' | 'U' | 'DEL' | 'MARK' | 'SUP' | 'SUB' | 'SPAN' | 'CODE'

interface InlineRule {
  opener: string
  closer: string
  tag: InlineTag
  className?: string
  math?: boolean
  allowSpace: boolean
}

interface InlineRuleMatch {
  rule: InlineRule
  node: Text
  openIndex: number
  caretIndex: number
  content: string
}

type BlockRuleMatch =
  | { kind: 'heading'; block: HTMLElement; markerLength: number; level: number }
  | { kind: 'bullet'; block: HTMLElement; markerLength: number; mark: string }
  | { kind: 'ordered'; block: HTMLElement; markerLength: number; start: number }
  | { kind: 'task'; block: HTMLElement; markerLength: number; checked: boolean }
  | { kind: 'quote'; block: HTMLElement; markerLength: number }
  | { kind: 'fence'; block: HTMLElement; markerLength: number; language: string }
  | { kind: 'hr'; block: HTMLElement; markerLength: number }
  | { kind: 'taskItem'; block: HTMLElement; markerLength: number; checked: boolean }

/** Closing markers that turn into an inline element the moment they are typed. */
const INLINE_INPUT_RULES: InlineRule[] = [
  { opener: '**', closer: '**', tag: 'STRONG', allowSpace: false },
  { opener: '~~', closer: '~~', tag: 'DEL', allowSpace: false },
  { opener: '==', closer: '==', tag: 'MARK', allowSpace: false },
  { opener: '`', closer: '`', tag: 'CODE', allowSpace: true },
  {
    opener: '$',
    closer: '$',
    tag: 'SPAN',
    className: 'md-inline-math',
    math: true,
    allowSpace: false
  },
  { opener: '*', closer: '*', tag: 'EM', allowSpace: false }
]

function isEscapedAt(text: string, index: number): boolean {
  let backslashes = 0
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) backslashes += 1
  return backslashes % 2 === 1
}

function createMathElement(tex: string): HTMLElement | null {
  const holder = document.createElement('div')
  holder.innerHTML = renderMathInlineHtml(tex)
  return holder.firstElementChild as HTMLElement | null
}

const PHRASE_SELECTOR =
  'strong,em,b,i,u,del,s,mark,sup,sub,code,a,span.md-inline-math,span.md-comment'
const SENTENCE_END_RE = /[.!?。！？]/
/** px from a cell edge that counts as "clicking the border" (row/column selection). */
const TABLE_EDGE = 6
/**
 * Picker order: names that start with the query first, the exact alias last (typing
 * "py" must still offer "python"), then shorter names, then alphabetical.
 */
function rankLangNames(needle: string): string[] {
  const names = listCodeLanguages()
  if (needle === '') return names.slice().sort((left, right) => left.localeCompare(right))
  const rank = (name: string): number => {
    const lower = name.toLowerCase()
    if (lower === needle) return 2
    return lower.startsWith(needle) ? 0 : 1
  }
  return names
    .filter((name) => name.toLowerCase().includes(needle))
    .sort((left, right) => {
      const byRank = rank(left) - rank(right)
      if (byRank !== 0) return byRank
      if (left.length !== right.length) return left.length - right.length
      return left.localeCompare(right)
    })
}

/**
 * A real contenteditable writes the trailing space as U+00A0 (NBSP), so every rule that
 * matches "marker + space" has to normalise first. Both strings keep their length.
 */
const plainText = (value: string): string => value.replace(/\u00a0/g, ' ')

const IMAGE_EXTENSION_RE = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i

/** Electron exposes the on-disk path of a dropped file on the File object. */
function localPathOfFile(file: File): string {
  const candidate = (file as File & { path?: unknown }).path
  return typeof candidate === 'string' ? candidate : ''
}

function fileUrlToPath(url: string): string {
  if (!/^file:/i.test(url)) return ''
  try {
    const decoded = decodeURIComponent(new URL(url).pathname)
    return /^\/[a-zA-Z]:/.test(decoded) ? decoded.slice(1) : decoded
  } catch {
    return ''
  }
}

/** Entries of a text/uri-list payload that point at a local image. */
function imagePathsFromDataTransfer(data: DataTransfer): string[] {
  const raw = data.getData('text/uri-list')
  if (raw === '') return []
  const paths: string[] = []
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const path = fileUrlToPath(trimmed)
    if (path !== '' && IMAGE_EXTENSION_RE.test(path)) paths.push(path)
  }
  return paths
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      resolve(typeof reader.result === 'string' ? reader.result : '')
    })
    reader.addEventListener('error', () => {
      resolve('')
    })
    reader.readAsDataURL(file)
  })
}

interface Snapshot {
  markdown: string
  caret: CaretPosition | null
}

export interface WysiwygOptions {
  root: HTMLElement
  commit: (markdown: string, origin: EditOrigin) => void
  isTypewriter: () => boolean
}

function isElement(node: Node | null): node is HTMLElement {
  return node !== null && node.nodeType === Node.ELEMENT_NODE
}

function isWordChar(char: string): boolean {
  return WORD_CHAR_RE.test(char)
}

function escapeRegExp(value: string): string {
  return value.replace(URL_ESCAPE_RE, '\\$&')
}

/** An empty block needs a <br> placeholder so the caret can sit inside it. */
function ensurePlaceholder(element: Element): void {
  if ((element.textContent ?? '') !== '') return
  if (element.querySelector('img, input, hr, br') !== null) return
  element.appendChild(document.createElement('br'))
}

function placeCaretAtStart(element: Element): void {
  const range = document.createRange()
  range.selectNodeContents(element)
  range.collapse(true)
  selectRange(range)
}

/**
 * WYSIWYG surface: a contenteditable `#write` rendered from Markdown. The DOM is the
 * editing surface, so every structural change is converted back into Markdown and
 * reported through `commit`; the engine never re-renders mid-typing.
 */
export class WysiwygEngine {
  private readonly root: HTMLElement
  private readonly options: WysiwygOptions
  private readonly findBar: FindBar
  private history: Snapshot[] = []
  private historyIndex = -1
  private pendingTimer: number | null = null
  private pendingOrigin: EditOrigin | null = null
  private lastCommitAt = 0
  private selectionFrame = 0
  private committedSource = ''
  private composing = false
  /** last selection that lived inside the editor; menu clicks blur the document and lose it */
  private savedRange: Range | null = null
  /** the fence whose language pill is being edited */
  private langTarget: { pre: HTMLElement; original: string } | null = null
  /** the paragraph that is waiting for a code-fence language; its text holds the query */
  private pendingFence: HTMLElement | null = null
  private langSuggest: HTMLElement | null = null
  private langCandidates: string[] = []
  private langIndex = 0
  private autoPairBracket = true
  private autoPairMarkdown = true
  private autoCorrectEnabled = false

  constructor(options: WysiwygOptions) {
    this.options = options
    this.root = options.root
    this.root.addEventListener('input', this.handleInput)
    this.root.addEventListener('keydown', this.handleKeydown)
    this.root.addEventListener('paste', this.handlePaste)
    this.root.addEventListener('click', this.handleClick)
    this.root.addEventListener('compositionstart', this.handleCompositionStart)
    this.root.addEventListener('compositionend', this.handleCompositionEnd)
    this.root.addEventListener('keydown', this.handleLangKeydown, true)
    this.root.addEventListener('focusout', this.handleLangFocusOut, true)
    this.root.addEventListener('input', this.handleLangInput, true)
    this.root.addEventListener('mouseup', this.rememberSelection)
    this.root.addEventListener('keyup', this.rememberSelection)
    this.root.addEventListener('dragover', this.handleDragOver)
    this.root.addEventListener('dragleave', this.handleDragLeave)
    this.root.addEventListener('drop', this.handleDrop)
    document.addEventListener('selectionchange', this.handleSelectionChange)
    this.findBar = createFindBar({
      root: this.root,
      commit: (): void => this.commitNow('command')
    })
  }

  getMarkdown(): string {
    return serializeDocument(this.root)
  }

  setMarkdown(markdown: string): void {
    this.render(markdown, null)
    this.resetHistory(markdown)
    this.options.commit(markdown, 'command')
  }

  render(markdown: string, caret: CaretPosition | null = null): void {
    this.committedSource = markdown
    this.savedRange = null
    const wasFocused = this.root.contains(document.activeElement)
    this.root.innerHTML = renderMarkdown(markdown)
    if (caret) {
      if (wasFocused) this.root.focus()
      setCaretPosition(this.root, caret)
    }
    this.updateFocusClass()
    this.updateTypewriter()
    void renderDiagrams(this.root)
  }

  resetHistory(markdown: string): void {
    this.history = [{ markdown, caret: null }]
    this.historyIndex = 0
    this.lastCommitAt = 0
  }

  flush(): void {
    if (this.pendingTimer !== null) {
      window.clearTimeout(this.pendingTimer)
      this.pendingTimer = null
    }
    const origin = this.pendingOrigin
    this.pendingOrigin = null
    if (origin) this.commitNow(origin)
  }

  focus(): void {
    this.root.focus()
  }

  exec(command: EditorCommand, arg?: string | number): void {
    this.flush()
    switch (command) {
      case 'bold':
        this.toggleInline('STRONG')
        break
      case 'italic':
        this.toggleInline('EM')
        break
      case 'underline':
        this.toggleInline('U')
        break
      case 'strike':
        this.toggleInline('DEL')
        break
      case 'code':
        this.toggleInlineCode()
        break
      case 'link':
        this.applyLink(arg)
        break
      case 'image':
        this.insertImage(arg)
        break
      case 'heading':
        this.applyHeading(arg)
        break
      case 'quote':
        this.toggleBlockquote()
        break
      case 'ul':
        this.applyList('ul')
        break
      case 'ol':
        this.applyList('ol')
        break
      case 'task':
        this.applyList('task')
        break
      case 'codefence':
        this.toggleCodeFence()
        break
      case 'math':
        this.insertMath(arg)
        break
      case 'hr':
        this.insertHr()
        break
      case 'table':
        this.insertTable(arg)
        break
      case 'undo':
        this.undo()
        break
      case 'redo':
        this.redo()
        break
      case 'find':
        this.findBar.open({ replace: false, query: typeof arg === 'string' ? arg : undefined })
        break
      case 'replaceAll':
        this.replaceAll(arg)
        break
      case 'findNext':
        this.findBar.next()
        break
      case 'findPrevious':
        this.findBar.previous()
        break
      case 'replace':
        this.findBar.open({ replace: true, query: typeof arg === 'string' ? arg : undefined })
        break
      case 'paragraph':
        this.applyHeading(0)
        break
      case 'headingUp':
        this.shiftHeading(-1)
        break
      case 'headingDown':
        this.shiftHeading(1)
        break
      case 'tableRowAbove':
        this.tableInsertRow(true)
        break
      case 'tableRowBelow':
        this.tableInsertRow(false)
        break
      case 'tableColBefore':
        this.tableInsertColumn(true)
        break
      case 'tableColAfter':
        this.tableInsertColumn(false)
        break
      case 'tableDeleteRow':
        this.tableDeleteRow()
        break
      case 'tableDeleteCol':
        this.tableDeleteColumn()
        break
      case 'tableDelete':
        this.tableDeleteTable()
        break
      case 'tableFormat':
        this.tableFormat()
        break
      case 'tableCopy':
        void this.tableCopy()
        break
      case 'codeCopy':
        void this.codeCopy()
        break
      case 'codeIndent':
        this.codeIndent()
        break
      case 'indent':
        this.shiftListItem(false)
        break
      case 'outdent':
        this.shiftListItem(true)
        break
      case 'taskToggle':
        this.applyTaskStatus('toggle')
        break
      case 'taskDone':
        this.applyTaskStatus('done')
        break
      case 'taskTodo':
        this.applyTaskStatus('todo')
        break
      case 'alert':
        this.insertAlert(typeof arg === 'string' ? arg : 'note')
        break
      case 'linkReference':
        this.insertLinkReference()
        break
      case 'footnote':
        this.insertFootnote()
        break
      case 'toc':
        this.insertToc()
        break
      case 'frontMatter':
        this.insertFrontMatter()
        break
      case 'insertBefore':
        this.insertParagraph(true)
        break
      case 'insertAfter':
        this.insertParagraph(false)
        break
      case 'inlineMath':
        this.insertInlineMath()
        break
      case 'highlight':
        this.toggleInline('MARK')
        break
      case 'superscript':
        this.toggleInline('SUP')
        break
      case 'subscript':
        this.toggleInline('SUB')
        break
      case 'comment':
        this.toggleInline('SPAN', 'md-comment')
        break
      case 'clearFormat':
        this.clearFormat()
        break
      case 'zoomImage':
        this.zoomImage(typeof arg === 'number' ? arg : Number(arg ?? 100))
        break
      case 'selectAll':
        this.selectAll()
        break
      case 'selectBlock':
        this.selectBlock()
        break
      case 'selectLine':
        this.selectLine(false)
        break
      case 'selectPhrase':
        this.selectPhrase()
        break
      case 'selectWord':
        this.selectWord()
        break
      case 'jumpTop':
        this.jumpToEdge(true, false)
        break
      case 'jumpBottom':
        this.jumpToEdge(false, false)
        break
      case 'jumpLineStart':
        this.jumpToEdge(true, true)
        break
      case 'jumpLineEnd':
        this.jumpToEdge(false, true)
        break
      case 'jumpSelection':
        this.jumpToSelection()
        break
      case 'extendTop':
        this.extendSelection(true, false)
        break
      case 'extendBottom':
        this.extendSelection(false, false)
        break
      case 'extendLineStart':
        this.extendSelection(true, true)
        break
      case 'extendLineEnd':
        this.extendSelection(false, true)
        break
      case 'deleteBlock':
        this.deleteBlock()
        break
      case 'deleteLine':
        this.selectLine(true)
        break
      case 'deleteScope':
        this.deleteScope()
        break
      case 'deleteWord':
        this.deleteWord()
        break
      case 'copyPlain':
        void this.copyPlain()
        break
      case 'copyMarkdown':
        void this.copyMarkdown()
        break
      case 'copyHtml':
        void this.copyHtml()
        break
      case 'copySemantic':
        void this.copySemantic()
        break
      case 'copyImage':
        void this.copyImage()
        break
      case 'pastePlain':
        void this.pastePlain()
        break
      case 'openLink':
        void this.openLink(true)
        break
      case 'copyLink':
        void this.openLink(false)
        break
      case 'readonly':
        this.setReadonly(arg === 1 || arg === '1')
        break
      case 'spellcheck':
        this.root.spellcheck = arg === 1 || arg === '1'
        break
      case 'refreshMath':
        this.render(this.getMarkdown())
        this.options.commit(this.getMarkdown(), 'command')
        break
      case 'preserveLineBreak': {
        const preserve = arg === 1 || arg === '1'
        setPreserveLineBreak(preserve)
        this.root.classList.toggle('md-collapse-softbreak', !preserve)
        break
      }
      case 'indentFirstLine':
        // the conditional class is owned by EditorSession.exec (#write.indent-first-line)
        break
      case 'showBr':
        if (setRenderOptions({ showBr: arg === 1 || arg === '1' })) this.refreshFromSource()
        break
      case 'smartPunctuation': {
        const smart = arg === 1 || arg === '1'
        setSmartPunctuation(smart)
        if (setRenderOptions({ smartPunctuation: smart })) this.refreshFromSource()
        break
      }
      case 'remapPunctuation':
        if (setRenderOptions({ remapPunctuation: arg === 1 || arg === '1' })) {
          this.refreshFromSource()
        }
        break
      case 'strictMode':
        if (setRenderOptions({ strictMode: arg === 1 || arg === '1' })) this.refreshFromSource()
        break
      case 'inlineMathEnabled':
        if (setRenderOptions({ inlineMath: arg === 1 || arg === '1' })) this.refreshFromSource()
        break
      case 'subscriptEnabled':
        if (setRenderOptions({ subscript: arg === 1 || arg === '1' })) this.refreshFromSource()
        break
      case 'superscriptEnabled':
        if (setRenderOptions({ superscript: arg === 1 || arg === '1' })) this.refreshFromSource()
        break
      case 'highlightEnabled':
        if (setRenderOptions({ highlight: arg === 1 || arg === '1' })) this.refreshFromSource()
        break
      case 'diagramsEnabled':
        if (setRenderOptions({ diagrams: arg === 1 || arg === '1' })) this.refreshFromSource()
        break
      case 'codeLineNumbers':
        if (setRenderOptions({ codeLineNumbers: arg === 1 || arg === '1' })) {
          this.refreshFromSource()
        }
        break
      case 'autoNumber':
        if (setRenderOptions({ autoNumber: arg === 1 || arg === '1' })) this.refreshFromSource()
        break
      case 'headingStyle': {
        const style = typeof arg === 'string' ? arg : 'atx'
        if (style !== 'atx' && style !== 'setext' && style !== 'hybrid') break
        if (setSerializationOptions({ headingStyle: style })) this.commitNow('command')
        break
      }
      case 'unorderedMarker': {
        const marker = typeof arg === 'string' ? arg : '-'
        if (marker !== '-' && marker !== '*' && marker !== '+') break
        if (setSerializationOptions({ unorderedMarker: marker })) this.commitNow('command')
        break
      }
      case 'orderedMarker': {
        const marker = typeof arg === 'string' ? arg : '.'
        if (marker !== '.' && marker !== ')') break
        if (setSerializationOptions({ orderedMarker: marker })) this.commitNow('command')
        break
      }
      case 'autoPairBracket':
        this.autoPairBracket = arg === 1 || arg === '1'
        break
      case 'autoPairMarkdown':
        this.autoPairMarkdown = arg === 1 || arg === '1'
        break
      case 'autoCorrect':
        this.autoCorrectEnabled = arg === 1 || arg === '1'
        break
      case 'moveBlockUp':
        this.moveBlock(-1)
        break
      case 'moveBlockDown':
        this.moveBlock(1)
        break
      case 'codeWrap':
        // the conditional class is owned by EditorSession.exec (#write.code-wrap)
        break
      case 'finalNewline': {
        const value = this.getMarkdown()
        if (!value.endsWith('\n')) this.setMarkdown(value + '\n')
        break
      }
      default:
        break
    }
  }

  destroy(): void {
    this.flush()
    this.root.removeEventListener('input', this.handleInput)
    this.root.removeEventListener('keydown', this.handleKeydown)
    this.root.removeEventListener('paste', this.handlePaste)
    this.root.removeEventListener('click', this.handleClick)
    this.root.removeEventListener('compositionstart', this.handleCompositionStart)
    this.root.removeEventListener('compositionend', this.handleCompositionEnd)
    this.root.removeEventListener('keydown', this.handleLangKeydown, true)
    this.root.removeEventListener('focusout', this.handleLangFocusOut, true)
    this.root.removeEventListener('input', this.handleLangInput, true)
    this.root.removeEventListener('mouseup', this.rememberSelection)
    this.root.removeEventListener('keyup', this.rememberSelection)
    this.root.removeEventListener('dragover', this.handleDragOver)
    this.root.removeEventListener('dragleave', this.handleDragLeave)
    this.root.removeEventListener('drop', this.handleDrop)
    document.removeEventListener('selectionchange', this.handleSelectionChange)
    if (this.selectionFrame !== 0) window.cancelAnimationFrame(this.selectionFrame)
    this.findBar.destroy()
  }

  private handleInput = (event: Event): void => {
    // the language pill is chrome, not document text: no rules, no autocorrect, no commit
    if (this.langTarget !== null) return
    if (this.composing || (event as InputEvent).isComposing === true) {
      this.scheduleCommit('input')
      return
    }
    if (this.autoCorrectEnabled && this.applyAutoCorrect()) {
      this.scheduleCommit('input')
      return
    }
    if (this.runInputRules()) return
    this.scheduleCommit('input')
  }

  private handleCompositionStart = (): void => {
    this.composing = true
  }

  private handleCompositionEnd = (): void => {
    this.composing = false
    // an IME may finish on a string that forms a rule; evaluate it once the event settles
    window.setTimeout((): void => {
      this.runInputRules()
    }, 0)
  }

  private handlePaste = (event: ClipboardEvent): void => {
    const data = event.clipboardData
    if (data !== null) {
      const files = Array.from(data.items)
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null)
      const paths = imagePathsFromDataTransfer(data)
      if (files.length > 0 || paths.length > 0) {
        event.preventDefault()
        void this.insertImageInputs(files, paths)
        return
      }
    }
    const text = data?.getData('text/plain')
    if (text === undefined) return
    event.preventDefault()
    const range = currentRange()
    if (!range) return
    range.deleteContents()
    const fragment = document.createDocumentFragment()
    const lines = text.split(/\r\n|\r|\n/)
    for (let i = 0; i < lines.length; i += 1) {
      if (i > 0) fragment.appendChild(document.createElement('br'))
      fragment.appendChild(document.createTextNode(lines[i]))
    }
    const last = fragment.lastChild
    range.insertNode(fragment)
    if (last) {
      const after = document.createRange()
      after.setStartAfter(last)
      after.collapse(true)
      selectRange(after)
    }
    this.scheduleCommit('input')
  }

  private handleClick = (event: MouseEvent): void => {
    if (this.handleLangClick(event)) return
    if (this.handleRawEditorClick(event)) return
    if (this.handleTableSelection(event)) return
    const target = event.target
    if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') return
    // The browser toggles a checkbox before the click reaches us, so read the state
    // back on the next task instead of flipping it twice.
    window.setTimeout((): void => {
      const item = target.closest('li')
      if (item) {
        item.classList.toggle('task-list-done', target.checked)
        item.classList.toggle('task-list-not-done', !target.checked)
      }
      this.commitNow('command')
    }, 0)
  }

  private handleSelectionChange = (): void => {
    if (this.selectionFrame !== 0) return
    this.selectionFrame = window.requestAnimationFrame((): void => {
      this.selectionFrame = 0
      const range = currentRange()
      if (!range || !this.root.contains(range.startContainer)) return
      this.savedRange = range.cloneRange()
      this.updateFocusClass()
      this.updateTypewriter()
    })
  }

  private handleKeydown = (event: KeyboardEvent): void => {
    if (event.isComposing) return
    const modifier = event.ctrlKey || event.metaKey
    if (modifier && !event.altKey) {
      const key = event.key.toLowerCase()
      if (key === 'b') {
        event.preventDefault()
        this.exec('bold')
        return
      }
      if (key === 'i') {
        event.preventDefault()
        this.exec('italic')
        return
      }
      if (key === 'u') {
        event.preventDefault()
        this.exec('underline')
        return
      }
      if (key === 'k') {
        event.preventDefault()
        this.exec(event.shiftKey ? 'codefence' : 'link')
        return
      }
      if (key === 'z') {
        event.preventDefault()
        this.exec(event.shiftKey ? 'redo' : 'undo')
        return
      }
      if (key === 'y') {
        event.preventDefault()
        this.exec('redo')
        return
      }
      if (key === 'f') {
        event.preventDefault()
        this.exec('find')
      }
      return
    }
    if (this.pendingFence !== null) {
      // the caret sits in the paragraph, so these keys would scroll the document or do nothing
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        this.moveLangIndex(event.key === 'ArrowDown' ? 1 : -1)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        this.cancelPendingFence()
        return
      }
    }
    if (!modifier && !event.altKey && event.key.length === 1 && this.handleAutoPair(event)) {
      event.preventDefault()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey && this.handleEnter()) {
      event.preventDefault()
      return
    }
    if (event.key === 'Backspace' && !modifier && this.handleBackspaceAtStart()) {
      event.preventDefault()
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      this.handleTab(event.shiftKey)
    }
  }

  private handleTab(outdent: boolean): void {
    const range = currentRange()
    if (!range) return
    const block = nearestBlockAt(this.root, range.startContainer)
    if (!block) return
    if (block.tagName === 'PRE') {
      this.insertPlainText('    ')
      return
    }
    const cell = this.currentCell()
    if (cell !== null) {
      this.moveTableCell(cell, outdent)
      return
    }
    const item = block.tagName === 'LI' ? block : block.closest('li')
    if (!item) return
    const offset = caretOffsetIn(item)
    if (outdent) this.outdentListItem(item)
    else this.indentListItem(item)
    if (offset !== null) placeCaretWithin(item, offset)
    this.commitNow('command')
  }

  private nestedListTag(list: HTMLElement): HTMLElement {
    const tag = list.tagName === 'OL' ? 'ol' : 'ul'
    const nested = document.createElement(tag)
    nested.className = tag === 'ol' ? 'ol-list' : 'ul-list'
    if (tag !== 'ol') nested.setAttribute('data-mark', list.getAttribute('data-mark') ?? '-')
    return nested
  }

  private indentListItem(item: HTMLElement): void {
    const previous = item.previousElementSibling
    if (!previous || previous.tagName !== 'LI') return
    const list = item.parentElement
    let nested = Array.from(previous.children).find(
      (child) => child.tagName === 'UL' || child.tagName === 'OL'
    ) as HTMLElement | undefined
    if (!nested) {
      if (!list) return
      nested = this.nestedListTag(list)
      previous.appendChild(nested)
    }
    nested.appendChild(item)
  }

  private outdentListItem(item: HTMLElement): void {
    const list = item.parentElement
    const parentItem = list?.parentElement
    if (!list || !parentItem || parentItem.tagName !== 'LI') return
    const outerList = parentItem.parentElement
    if (!outerList) return
    const following: HTMLElement[] = []
    let sibling = item.nextElementSibling
    while (sibling) {
      following.push(sibling as HTMLElement)
      sibling = sibling.nextElementSibling
    }
    if (following.length > 0) {
      const nested = this.nestedListTag(list)
      for (const node of following) nested.appendChild(node)
      item.appendChild(nested)
    }
    outerList.insertBefore(item, parentItem.nextSibling)
    if (list.children.length === 0) list.remove()
  }

  private handleEnter(): boolean {
    if (this.applyEnterBlockRules()) return true
    const range = currentRange()
    if (!range) return false
    const block = nearestBlockAt(this.root, range.startContainer)
    if (!block) return false
    if (block.tagName === 'PRE') return false
    if (block.classList.contains('md-math-block') || block.classList.contains('md-diagram')) {
      return false
    }
    if (block.tagName === 'LI' && (block.textContent ?? '').trim() === '') {
      this.exitListItem(block)
      return true
    }
    return this.splitBlock(block, range)
  }

  private insertPlainText(text: string): void {
    const range = currentRange()
    if (!range) return
    range.deleteContents()
    const node = document.createTextNode(text)
    range.insertNode(node)
    const after = document.createRange()
    after.setStartAfter(node)
    after.collapse(true)
    selectRange(after)
    this.scheduleCommit('input')
  }

  private splitBlock(block: HTMLElement, caret: Range): boolean {
    const tail = document.createRange()
    tail.selectNodeContents(block)
    tail.setStart(caret.startContainer, caret.startOffset)
    const fragment = tail.extractContents()
    const isListItem = block.tagName === 'LI'
    const next = document.createElement(isListItem ? 'li' : 'p')
    next.className = isListItem ? 'md-list-item' : PARAGRAPH_CLASS
    if ((fragment.textContent ?? '').trim() === '' && fragment.querySelector('img') === null) {
      next.innerHTML = '<br>'
    } else {
      next.appendChild(fragment)
    }
    block.parentNode?.insertBefore(next, block.nextSibling)
    placeCaretAtStart(next)
    this.scheduleCommit('command')
    return true
  }

  private exitListItem(item: HTMLElement): void {
    const list = item.parentElement
    if (!list) return
    const top = topLevelBlockAt(this.root, item) ?? list
    const paragraph = document.createElement('p')
    paragraph.className = PARAGRAPH_CLASS
    paragraph.innerHTML = '<br>'
    item.remove()
    if (list.children.length === 0) top.replaceWith(paragraph)
    else top.parentNode?.insertBefore(paragraph, top.nextSibling)
    placeCaretAtStart(paragraph)
    this.scheduleCommit('command')
  }

  private scheduleCommit(origin: EditOrigin): void {
    this.pendingOrigin = origin
    if (this.pendingTimer !== null) window.clearTimeout(this.pendingTimer)
    this.pendingTimer = window.setTimeout((): void => {
      this.pendingTimer = null
      const pending = this.pendingOrigin
      this.pendingOrigin = null
      if (pending) this.commitNow(pending)
    }, COMMIT_DEBOUNCE)
  }

  /** Re-renders from the committed Markdown instead of from the (already transformed) DOM. */
  private refreshFromSource(): void {
    this.flush()
    this.render(this.committedSource)
  }

  private commitNow(origin: EditOrigin): void {
    const markdown = this.getMarkdown()
    this.committedSource = markdown
    const caret = currentCaretPosition(this.root)
    this.updateFocusClass()
    this.updateTypewriter()
    this.pushHistory(markdown, caret, origin === 'input')
    this.options.commit(markdown, origin)
  }

  private pushHistory(markdown: string, caret: CaretPosition | null, coalesce: boolean): void {
    const current = this.history[this.historyIndex]
    if (current && current.markdown === markdown) {
      current.caret = caret
      return
    }
    const now = Date.now()
    const canCoalesce =
      coalesce &&
      this.historyIndex > 0 &&
      this.historyIndex === this.history.length - 1 &&
      now - this.lastCommitAt < TYPING_GROUP
    this.lastCommitAt = now
    if (canCoalesce) {
      this.history[this.historyIndex] = { markdown, caret }
      return
    }
    this.history = this.history.slice(0, this.historyIndex + 1)
    this.history.push({ markdown, caret })
    this.historyIndex = this.history.length - 1
  }

  private undo(): void {
    if (this.historyIndex <= 0) return
    this.historyIndex -= 1
    this.applySnapshot(this.history[this.historyIndex])
  }

  private redo(): void {
    if (this.historyIndex >= this.history.length - 1) return
    this.historyIndex += 1
    this.applySnapshot(this.history[this.historyIndex])
  }

  private applySnapshot(snapshot: Snapshot): void {
    this.render(snapshot.markdown, snapshot.caret)
    this.options.commit(snapshot.markdown, 'command')
  }

  private updateFocusClass(): void {
    const range = currentRange()
    const anchor = range && this.root.contains(range.startContainer) ? range.startContainer : null
    const block = anchor ? topLevelBlockAt(this.root, anchor) : null
    for (const element of Array.from(this.root.querySelectorAll('.md-focus'))) {
      element.classList.remove('md-focus')
    }
    if (block) block.classList.add('md-focus')
  }

  private focusedTopBlock(): HTMLElement | null {
    const range = this.activeRange()
    if (range === null) return null
    return topLevelBlockAt(this.root, range.startContainer)
  }

  private updateTypewriter(): void {
    if (!this.options.isTypewriter()) return
    const block = this.focusedTopBlock()
    if (block) centerElementInView(block)
  }

  private rememberSelection = (): void => {
    const range = currentRange()
    if (range === null) return
    if (!this.root.contains(range.startContainer)) return
    this.savedRange = range.cloneRange()
  }

  /**
   * Live selection, or the last one that was inside the editor. Clicking a menu item moves
   * focus out of the document, which loses the live selection - the format commands still
   * have to act on what the user selected.
   */
  private activeRange(): Range | null {
    const live = currentRange()
    if (live !== null && this.root.contains(live.startContainer)) {
      this.savedRange = live.cloneRange()
      return live
    }
    const saved = this.savedRange
    if (saved === null) return null
    const startNode = saved.startContainer
    const endNode = saved.endContainer
    if (startNode !== this.root && !this.root.contains(startNode)) return null
    if (endNode !== this.root && !this.root.contains(endNode)) return null
    return saved.cloneRange()
  }

  private prepareRange(): Range | null {
    const range = this.activeRange()
    if (range === null) return null
    if (range.collapsed) this.expandToWord(range)
    return range
  }

  private expandToWord(range: Range): void {
    const node = range.startContainer
    if (node.nodeType !== Node.TEXT_NODE) return
    const text = node.nodeValue ?? ''
    let start = range.startOffset
    let end = range.startOffset
    while (start > 0 && isWordChar(text[start - 1])) start -= 1
    while (end < text.length && isWordChar(text[end])) end += 1
    if (start === end) {
      if (start >= text.length) return
      end = start + 1
    }
    range.setStart(node, start)
    range.setEnd(node, end)
  }

  private placeCaretInside(element: HTMLElement): void {
    const range = document.createRange()
    range.setStart(element, 0)
    range.collapse(true)
    selectRange(range)
    this.savedRange = range.cloneRange()
  }

  private inlineAncestor(node: Node, tagName: string, className?: string): HTMLElement | null {
    let current: Node | null = node
    while (current && current !== this.root) {
      if (
        isElement(current) &&
        current.tagName === tagName &&
        (className === undefined || current.classList.contains(className))
      ) {
        return current
      }
      current = current.parentNode
    }
    return null
  }

  private unwrapElement(element: HTMLElement): void {
    const parent = element.parentNode
    if (!parent) return
    const range = document.createRange()
    range.setStartBefore(element)
    range.setEndAfter(element)
    element.replaceWith(...Array.from(element.childNodes))
    selectRange(range)
  }

  private wrapRange(range: Range, wrapper: HTMLElement): HTMLElement | null {
    try {
      range.surroundContents(wrapper)
      return wrapper
    } catch {
      try {
        const fragment = range.extractContents()
        wrapper.appendChild(fragment)
        range.insertNode(wrapper)
        return wrapper
      } catch {
        return null
      }
    }
  }

  private selectNodeContents(element: HTMLElement): void {
    const range = document.createRange()
    range.selectNodeContents(element)
    selectRange(range)
  }

  private createInline(tagName: InlineTag, className?: string): HTMLElement {
    const element = document.createElement(tagName)
    if (className) element.className = className
    return element
  }

  private toggleInline(tagName: InlineTag, className?: string): void {
    const range = this.prepareRange()
    if (!range) return
    const existing = this.inlineAncestor(range.startContainer, tagName, className)
    if (existing) {
      this.unwrapElement(existing)
      this.commitNow('command')
      return
    }
    if (range.collapsed) {
      // Typora toggles a typing mode instead: an empty wrapper the caret sits in, so the
      // next characters land inside it (an abandoned one serialises to nothing)
      const wrapper = this.createInline(tagName, className)
      range.insertNode(wrapper)
      this.placeCaretInside(wrapper)
    } else {
      const wrapper = this.wrapRange(range, this.createInline(tagName, className))
      if (wrapper) this.selectNodeContents(wrapper)
    }
    this.commitNow('command')
  }

  private toggleInlineCode(): void {
    const range = this.prepareRange()
    if (!range) return
    const existing = this.inlineAncestor(range.startContainer, 'CODE')
    if (existing && existing.closest('pre') === null) {
      this.unwrapElement(existing)
      this.commitNow('command')
      return
    }
    if (range.collapsed) {
      const code = document.createElement('code')
      range.insertNode(code)
      this.placeCaretInside(code)
    } else {
      const wrapper = this.wrapRange(range, document.createElement('code'))
      if (wrapper) this.selectNodeContents(wrapper)
    }
    this.commitNow('command')
  }

  private applyLink(arg?: string | number): void {
    const href = typeof arg === 'string' ? arg : ''
    const range = this.prepareRange()
    if (!range) return
    const existing = this.inlineAncestor(range.startContainer, 'A')
    if (existing && href === '') {
      this.unwrapElement(existing)
      this.commitNow('command')
      return
    }
    const anchor = document.createElement('a')
    anchor.setAttribute('href', href)
    const text = range.collapsed ? 'link' : range.toString()
    anchor.textContent = text === '' ? 'link' : text
    range.deleteContents()
    range.insertNode(anchor)
    if (href === '') this.selectNodeContents(anchor)
    this.commitNow('command')
  }

  private insertImage(arg?: string | number): void {
    const range = this.prepareRange()
    if (!range) return
    const image = document.createElement('img')
    image.setAttribute('src', typeof arg === 'string' ? arg : '')
    image.setAttribute('alt', 'image')
    range.deleteContents()
    range.insertNode(image)
    const after = document.createRange()
    after.setStartAfter(image)
    after.collapse(true)
    selectRange(after)
    this.commitNow('command')
  }

  private applyHeading(arg?: string | number): void {
    const block = this.focusedTopBlock()
    if (!block) return
    if (block.tagName !== 'P' && HEADING_RE.test(block.tagName) === false) return
    const caret = currentCaretPosition(this.root)
    const explicitArg =
      typeof arg === 'number'
        ? String(arg)
        : typeof arg === 'string' && /^[0-6]$/.test(arg)
          ? arg
          : null
    const current = HEADING_RE.exec(block.tagName)
    let level = explicitArg === null ? -1 : Number(explicitArg)
    if (level < 0) level = current ? (Number(current[1]) >= 6 ? 0 : Number(current[1]) + 1) : 1
    const next = document.createElement(level === 0 ? 'p' : 'h' + level)
    next.className = level === 0 ? PARAGRAPH_CLASS : 'md-end-block'
    while (block.firstChild) next.appendChild(block.firstChild)
    if ((next.textContent ?? '') === '' && next.querySelector('img') === null)
      next.innerHTML = '<br>'
    block.replaceWith(next)
    if (caret) setCaretPosition(this.root, caret)
    else placeCaretAtEnd(next)
    this.commitNow('command')
  }

  private toggleBlockquote(): void {
    const block = this.focusedTopBlock()
    if (!block) return
    const caret = currentCaretPosition(this.root)
    if (block.tagName === 'BLOCKQUOTE') {
      const paragraph = document.createElement('p')
      paragraph.className = PARAGRAPH_CLASS
      const source = block.querySelector('p, h1, h2, h3, h4, h5, h6')
      if (source) {
        while (source.firstChild) paragraph.appendChild(source.firstChild)
      }
      if ((paragraph.textContent ?? '') === '' && paragraph.querySelector('img') === null) {
        paragraph.innerHTML = '<br>'
      }
      block.replaceWith(paragraph)
      if (caret) setCaretPosition(this.root, caret)
      else placeCaretAtEnd(paragraph)
      this.commitNow('command')
      return
    }
    if (block.tagName !== 'P' && HEADING_RE.test(block.tagName) === false) return
    const quote = document.createElement('blockquote')
    quote.className = 'md-end-block'
    const paragraph = document.createElement('p')
    paragraph.className = PARAGRAPH_CLASS
    while (block.firstChild) paragraph.appendChild(block.firstChild)
    if ((paragraph.textContent ?? '') === '' && paragraph.querySelector('img') === null) {
      paragraph.innerHTML = '<br>'
    }
    quote.appendChild(paragraph)
    block.replaceWith(quote)
    if (caret) setCaretPosition(this.root, caret)
    else placeCaretAtEnd(paragraph)
    this.commitNow('command')
  }

  private applyList(kind: ListKind): void {
    const block = this.focusedTopBlock()
    if (!block) return
    const caret = currentCaretPosition(this.root)
    const targetTag = kind === 'ol' ? 'OL' : 'UL'
    if (block.tagName === 'UL' || block.tagName === 'OL') {
      const hasTask = block.querySelector('.task-list-item') !== null
      const sameKind = block.tagName === targetTag && (kind === 'task') === hasTask
      if (sameKind) {
        this.listToParagraphs(block)
        this.commitNow('command')
        return
      }
      const rebuilt = this.convertList(block, kind)
      block.replaceWith(rebuilt)
      if (caret) setCaretPosition(this.root, caret)
      else placeCaretAtEnd(rebuilt)
      this.commitNow('command')
      return
    }
    if (block.tagName !== 'P' && HEADING_RE.test(block.tagName) === false) return
    const created = this.blockToList(block, kind)
    block.replaceWith(created)
    if (caret) setCaretPosition(this.root, caret)
    else placeCaretAtEnd(created)
    this.commitNow('command')
  }

  private convertList(list: HTMLElement, kind: ListKind): HTMLElement {
    const next = document.createElement(kind === 'ol' ? 'ol' : 'ul')
    next.className = kind === 'ol' ? 'ol-list' : 'ul-list'
    if (kind !== 'ol') next.setAttribute('data-mark', '-')
    for (const item of Array.from(list.children)) {
      if (item.tagName !== 'LI') continue
      next.appendChild(this.convertListItem(item, kind))
    }
    return next
  }

  private convertListItem(item: Element, kind: ListKind): HTMLElement {
    const li = document.createElement('li')
    li.className = 'md-list-item'
    const checkbox = Array.from(item.children).find((child) => child.tagName === 'INPUT') as
      HTMLInputElement | undefined
    const checked = checkbox !== undefined && checkbox.checked
    if (kind === 'task') {
      li.className =
        'md-list-item task-list-item md-task-list-item task-list-' + (checked ? 'done' : 'not-done')
      const input = document.createElement('input')
      input.type = 'checkbox'
      input.className = 'task-list-item-checkbox'
      input.checked = checked
      li.appendChild(input)
    }
    for (const child of Array.from(item.childNodes)) {
      if (isElement(child) && child.tagName === 'INPUT') continue
      li.appendChild(child)
    }
    return li
  }

  private listToParagraphs(list: HTMLElement): void {
    const paragraphs: HTMLElement[] = []
    for (const item of Array.from(list.children)) {
      if (item.tagName !== 'LI') continue
      const paragraph = document.createElement('p')
      paragraph.className = PARAGRAPH_CLASS
      for (const child of Array.from(item.childNodes)) {
        if (
          isElement(child) &&
          (child.tagName === 'INPUT' || child.tagName === 'UL' || child.tagName === 'OL')
        ) {
          continue
        }
        paragraph.appendChild(child)
      }
      if ((paragraph.textContent ?? '') === '' && paragraph.querySelector('img') === null) {
        paragraph.innerHTML = '<br>'
      }
      paragraphs.push(paragraph)
    }
    if (paragraphs.length === 0) return
    list.replaceWith(...paragraphs)
  }

  private blockToList(block: HTMLElement, kind: ListKind): HTMLElement {
    const list = document.createElement(kind === 'ol' ? 'ol' : 'ul')
    list.className = kind === 'ol' ? 'ol-list' : 'ul-list'
    if (kind !== 'ol') list.setAttribute('data-mark', '-')
    const li = document.createElement('li')
    li.className = 'md-list-item'
    if (kind === 'task') {
      li.className += ' task-list-item md-task-list-item task-list-not-done'
      const input = document.createElement('input')
      input.type = 'checkbox'
      input.className = 'task-list-item-checkbox'
      li.appendChild(input)
    }
    for (const child of Array.from(block.childNodes)) {
      if (isElement(child) && child.tagName === 'BR') continue
      li.appendChild(child)
    }
    if ((li.textContent ?? '') === '' && li.querySelector('img') === null)
      li.appendChild(document.createElement('br'))
    list.appendChild(li)
    return list
  }

  private toggleCodeFence(): void {
    const block = this.focusedTopBlock()
    if (!block) return
    if (block.tagName === 'PRE' && block.classList.contains('md-fences')) {
      const paragraph = document.createElement('p')
      paragraph.className = PARAGRAPH_CLASS
      const code = block.querySelector('code')
      paragraph.textContent = (code?.textContent ?? '').replace(/\n$/, '')
      if ((paragraph.textContent ?? '') === '') paragraph.innerHTML = '<br>'
      block.replaceWith(paragraph)
      placeCaretAtEnd(paragraph)
      this.commitNow('command')
      return
    }
    if (block.tagName !== 'P' && HEADING_RE.test(block.tagName) === false) return
    const pre = document.createElement('pre')
    pre.className = 'md-fences md-end-block'
    const code = document.createElement('code')
    code.className = 'hljs'
    code.textContent = (block.textContent ?? '').replace(/\n$/, '')
    pre.appendChild(code)
    this.attachCodeTooltip(pre, '')
    block.replaceWith(pre)
    const range = document.createRange()
    range.selectNodeContents(code)
    range.collapse(false)
    selectRange(range)
    this.commitNow('command')
  }

  private insertMath(arg?: string | number): void {
    const block = this.focusedTopBlock()
    if (!block) return
    if (block.classList.contains('md-math-block')) {
      const paragraph = document.createElement('p')
      paragraph.className = PARAGRAPH_CLASS
      paragraph.textContent = block.getAttribute('data-math') ?? ''
      if ((paragraph.textContent ?? '') === '') paragraph.innerHTML = '<br>'
      block.replaceWith(paragraph)
      placeCaretAtEnd(paragraph)
      this.commitNow('command')
      return
    }
    const source = typeof arg === 'string' ? arg.trim() : ''
    const tex = source !== '' ? source : (block.textContent ?? '').trim() || 'x^2'
    const holder = document.createElement('div')
    holder.innerHTML = renderMathBlockHtml(tex)
    const math = holder.firstElementChild
    if (!math) return
    block.replaceWith(math)
    const paragraph = document.createElement('p')
    paragraph.className = PARAGRAPH_CLASS
    paragraph.innerHTML = '<br>'
    math.parentNode?.insertBefore(paragraph, math.nextSibling)
    placeCaretAtEnd(paragraph)
    this.commitNow('command')
  }

  private insertHr(): void {
    const block = this.focusedTopBlock()
    if (!block) return
    const hr = document.createElement('hr')
    hr.className = 'md-hr md-end-block'
    const paragraph = document.createElement('p')
    paragraph.className = PARAGRAPH_CLASS
    paragraph.innerHTML = '<br>'
    block.parentNode?.insertBefore(hr, block.nextSibling)
    hr.parentNode?.insertBefore(paragraph, hr.nextSibling)
    placeCaretAtEnd(paragraph)
    this.commitNow('command')
  }

  private insertTable(arg?: string | number): void {
    const block = this.focusedTopBlock()
    if (!block) return
    let columns = 3
    let rows = 2
    if (typeof arg === 'number' && arg > 0) columns = Math.min(12, Math.floor(arg))
    if (typeof arg === 'string') {
      const match = /^(\d+)\s*[x*x]\s*(\d+)$/i.exec(arg.trim())
      if (match) {
        columns = Math.min(12, Math.max(1, Number(match[1])))
        rows = Math.min(50, Math.max(1, Number(match[2])))
      }
    }
    const wrapper = document.createElement('div')
    wrapper.className = 'md-table md-table-fig md-end-block'
    const table = document.createElement('table')
    table.className = 'md-table'
    const head = document.createElement('thead')
    const headRow = document.createElement('tr')
    for (let i = 0; i < columns; i += 1) {
      const cell = document.createElement('th')
      cell.appendChild(document.createElement('br'))
      headRow.appendChild(cell)
    }
    head.appendChild(headRow)
    table.appendChild(head)
    const body = document.createElement('tbody')
    for (let r = 0; r < rows; r += 1) {
      const row = document.createElement('tr')
      for (let c = 0; c < columns; c += 1) {
        const cell = document.createElement('td')
        cell.appendChild(document.createElement('br'))
        row.appendChild(cell)
      }
      body.appendChild(row)
    }
    table.appendChild(body)
    wrapper.appendChild(table)
    block.parentNode?.insertBefore(wrapper, block.nextSibling)
    const paragraph = document.createElement('p')
    paragraph.className = PARAGRAPH_CLASS
    paragraph.innerHTML = '<br>'
    wrapper.parentNode?.insertBefore(paragraph, wrapper.nextSibling)
    const first = headRow.firstElementChild
    if (first) placeCaretAtStart(first)
    this.commitNow('command')
  }

  private nearestBlock(): HTMLElement | null {
    const range = currentRange()
    if (!range || !this.root.contains(range.startContainer)) return null
    return nearestBlockAt(this.root, range.startContainer)
  }

  private shiftHeading(delta: number): void {
    const block = this.focusedTopBlock()
    if (!block) return
    const current = HEADING_RE.exec(block.tagName)
    const level = current ? Number(current[1]) : 0
    const next = Math.max(0, Math.min(6, level + delta))
    if (next !== level) this.applyHeading(next)
  }

  private currentCell(): HTMLTableCellElement | null {
    const range = currentRange()
    if (!range) return null
    const node = range.startContainer
    const element = isElement(node) ? node : node.parentElement
    return element?.closest('td,th') ?? null
  }

  private currentTable(): HTMLTableElement | null {
    return this.currentCell()?.closest('table') ?? null
  }

  private tableInsertRow(above: boolean): void {
    const cell = this.currentCell()
    const parent = cell?.closest('tr')
    const table = cell?.closest('table')
    if (!cell || !parent || !table || !parent.parentElement) return
    const index = Array.prototype.indexOf.call(parent.children, cell)
    const created = document.createElement('tr')
    for (const source of Array.from(parent.children)) {
      const target = document.createElement(source.tagName === 'TH' ? 'th' : 'td')
      target.appendChild(document.createElement('br'))
      created.appendChild(target)
    }
    const body = table.querySelector('tbody')
    if (!above && parent.parentElement.tagName === 'THEAD' && body) {
      body.insertBefore(created, body.firstChild)
    } else {
      parent.parentElement.insertBefore(created, above ? parent : parent.nextSibling)
    }
    const targetCell = created.children[Math.min(index, created.children.length - 1)]
    if (targetCell) placeCaretWithin(targetCell, 0)
    this.commitNow('command')
  }

  private tableInsertColumn(before: boolean): void {
    const cell = this.currentCell()
    const table = cell?.closest('table')
    const row = cell?.closest('tr')
    if (!cell || !table || !row) return
    const index = Array.prototype.indexOf.call(row.children, cell)
    for (const line of Array.from(table.querySelectorAll('tr'))) {
      const reference = line.children[index]
      const created = document.createElement(reference?.tagName === 'TH' ? 'th' : 'td')
      created.appendChild(document.createElement('br'))
      if (reference) line.insertBefore(created, before ? reference : reference.nextSibling)
      else line.appendChild(created)
    }
    const targetCell = row.children[before ? index : index + 1]
    if (targetCell) placeCaretWithin(targetCell, 0)
    this.commitNow('command')
  }

  private removeTable(table: HTMLTableElement): void {
    const wrapper = table.closest('div.md-table') ?? table
    const paragraph = document.createElement('p')
    paragraph.className = PARAGRAPH_CLASS
    paragraph.innerHTML = '<br>'
    if (wrapper.parentNode) {
      wrapper.parentNode.insertBefore(paragraph, wrapper.nextSibling)
      wrapper.remove()
    }
    placeCaretAtStart(paragraph)
    this.commitNow('command')
  }

  private tableRemoveIfEmpty(table: HTMLTableElement): boolean {
    const body = table.querySelector('tbody')
    const columns = table.querySelector('tr')?.children.length ?? 0
    if ((body !== null && body.children.length === 0) || columns === 0) {
      this.removeTable(table)
      return true
    }
    return false
  }

  private tableDeleteRow(): void {
    const cell = this.currentCell()
    const row = cell?.closest('tr')
    const table = cell?.closest('table')
    if (!row || !table) return
    const parent = row.parentElement
    row.remove()
    if (parent && parent.tagName === 'THEAD') {
      const body = table.querySelector('tbody')
      const promoted = body?.firstElementChild
      if (promoted) parent.appendChild(promoted)
    }
    if (this.tableRemoveIfEmpty(table)) return
    const fallback = table.querySelector('td,th')
    if (fallback) placeCaretWithin(fallback, 0)
    this.commitNow('command')
  }

  private tableDeleteColumn(): void {
    const cell = this.currentCell()
    const table = cell?.closest('table')
    const row = cell?.closest('tr')
    if (!cell || !table || !row) return
    const index = Array.prototype.indexOf.call(row.children, cell)
    for (const line of Array.from(table.querySelectorAll('tr'))) {
      line.children[index]?.remove()
    }
    if (this.tableRemoveIfEmpty(table)) return
    const fallback = row.children[Math.min(index, row.children.length - 1)]
    if (fallback) placeCaretWithin(fallback, 0)
    this.commitNow('command')
  }

  private tableDeleteTable(): void {
    const table = this.currentTable()
    if (table) this.removeTable(table)
  }

  private tableFormat(): void {
    if (!this.currentTable()) return
    this.render(this.getMarkdown())
    this.commitNow('command')
  }

  private async tableCopy(): Promise<void> {
    const table = this.currentTable()
    if (!table) return
    const wrapper = table.closest('div.md-table') ?? table
    await copyText(serializeSelection([wrapper]))
  }

  private currentFence(): HTMLElement | null {
    const block = this.focusedTopBlock()
    return block && block.tagName === 'PRE' ? block : null
  }

  private async codeCopy(): Promise<void> {
    const fence = this.currentFence()
    if (!fence) return
    const code = fence.querySelector('code')
    await copyText((code?.textContent ?? '').replace(/\n$/, ''))
  }

  private codeIndent(): void {
    const fence = this.currentFence()
    const code = fence?.querySelector('code')
    if (!code) return
    const lines = (code.textContent ?? '').replace(/\n$/, '').split('\n')
    const widths = lines
      .filter((line) => line.trim() !== '')
      .map((line) => (line.match(/^ +/) ?? [''])[0].length)
    const smallest = widths.length > 0 ? Math.min(...widths) : 0
    const next = smallest >= 16 ? 0 : smallest + 4
    code.textContent = lines
      .map((line) => {
        if (line.trim() === '') return line
        const stripped = line.slice(smallest)
        return next > 0 ? ' '.repeat(next) + stripped : stripped
      })
      .join('\n')
    this.commitNow('command')
  }

  private currentListItem(): HTMLElement | null {
    const block = this.nearestBlock()
    if (!block) return null
    return block.tagName === 'LI' ? block : (block.closest('li') as HTMLElement | null)
  }

  private shiftListItem(outdent: boolean): void {
    const item = this.currentListItem()
    if (!item) return
    const offset = caretOffsetIn(item)
    if (outdent) this.outdentListItem(item)
    else this.indentListItem(item)
    if (offset !== null) placeCaretWithin(item, offset)
    this.commitNow('command')
  }

  private applyTaskStatus(mode: 'toggle' | 'done' | 'todo'): void {
    const item = this.currentListItem()
    const checkbox = item
      ? (Array.from(item.children).find((child) => child.tagName === 'INPUT') as
          HTMLInputElement | undefined)
      : undefined
    if (!item || !checkbox) {
      this.applyList('task')
      return
    }
    const checked = mode === 'toggle' ? !checkbox.checked : mode === 'done'
    checkbox.checked = checked
    item.classList.toggle('task-list-done', checked)
    item.classList.toggle('task-list-not-done', !checked)
    this.commitNow('command')
  }

  private insertAlert(type: string): void {
    const block = this.focusedTopBlock()
    if (!block) return
    const titleText = type.charAt(0).toUpperCase() + type.slice(1)
    if (block.classList.contains('md-alert')) {
      block.className = 'md-alert md-end-block md-alert-' + type
      const text = block.querySelector('.md-alert-text')
      if (text) {
        text.className = 'md-alert-text md-alert-text-' + type
        text.textContent = titleText
      }
      this.commitNow('command')
      return
    }
    const quote = document.createElement('blockquote')
    quote.className = 'md-alert md-end-block md-alert-' + type
    const title = document.createElement('p')
    title.className = 'md-alert-text md-alert-text-' + type
    title.textContent = titleText
    const body = document.createElement('p')
    body.className = PARAGRAPH_CLASS
    if (block.tagName === 'P' || HEADING_RE.test(block.tagName)) {
      while (block.firstChild) body.appendChild(block.firstChild)
    }
    if ((body.textContent ?? '') === '' && body.querySelector('img') === null)
      body.innerHTML = '<br>'
    quote.append(title, body)
    block.replaceWith(quote)
    placeCaretAtEnd(body)
    this.commitNow('command')
  }

  private insertLinkReference(): void {
    const block = this.focusedTopBlock()
    const container = document.createElement('div')
    container.className = 'md-def-link md-end-block'
    container.textContent = '[1]: https://'
    if (block?.parentNode) block.parentNode.insertBefore(container, block.nextSibling)
    else this.root.appendChild(container)
    placeCaretWithin(container, (container.textContent ?? '').length)
    this.commitNow('command')
  }

  private insertFootnote(): void {
    const range = this.prepareRange()
    if (!range) return
    const label = '1'
    const sup = document.createElement('sup')
    sup.className = 'md-footnote'
    const anchor = document.createElement('a')
    anchor.setAttribute('href', '#fn-' + label)
    anchor.textContent = label
    sup.appendChild(anchor)
    range.collapse(false)
    range.insertNode(sup)
    const block = this.focusedTopBlock()
    const container = document.createElement('div')
    container.className = 'footnotes md-def-footnote md-end-block'
    container.setAttribute('data-label', label)
    const line = document.createElement('p')
    line.className = 'md-footnote-line'
    line.textContent = 'footnote'
    container.appendChild(line)
    if (block?.parentNode) block.parentNode.insertBefore(container, block.nextSibling)
    else this.root.appendChild(container)
    this.commitNow('command')
  }

  private insertToc(): void {
    const block = this.focusedTopBlock()
    const container = document.createElement('div')
    container.className = 'md-toc md-end-block'
    if (block?.parentNode) block.parentNode.insertBefore(container, block.nextSibling)
    else this.root.appendChild(container)
    this.render(this.getMarkdown())
    this.commitNow('command')
  }

  private insertFrontMatter(): void {
    const existing = this.root.querySelector('pre.md-meta-block')
    if (existing) {
      placeCaretAtEnd(existing)
      this.commitNow('command')
      return
    }
    const meta = document.createElement('pre')
    meta.className = 'md-meta-block md-end-block'
    meta.textContent = 'title: '
    const first = this.root.firstElementChild
    if (first?.parentNode) first.parentNode.insertBefore(meta, first)
    else this.root.appendChild(meta)
    placeCaretAtEnd(meta)
    this.commitNow('command')
  }

  private insertParagraph(before: boolean): void {
    const block = this.focusedTopBlock()
    const paragraph = document.createElement('p')
    paragraph.className = PARAGRAPH_CLASS
    paragraph.innerHTML = '<br>'
    if (block?.parentNode)
      block.parentNode.insertBefore(paragraph, before ? block : block.nextSibling)
    else this.root.appendChild(paragraph)
    placeCaretAtStart(paragraph)
    this.commitNow('command')
  }

  private insertInlineMath(): void {
    const range = this.prepareRange()
    if (!range) return
    const tex = range.collapsed ? 'x^2' : range.toString().trim() || 'x^2'
    const holder = document.createElement('div')
    holder.innerHTML = renderMathInlineHtml(tex)
    const math = holder.firstElementChild
    if (!math) return
    if (!range.collapsed) range.deleteContents()
    range.insertNode(math)
    const after = document.createRange()
    after.setStartAfter(math)
    after.collapse(true)
    selectRange(after)
    this.commitNow('command')
  }

  private clearFormat(): void {
    const range = currentRange()
    if (!range || !this.root.contains(range.startContainer)) return
    const block = this.focusedTopBlock() ?? this.root
    const targets = Array.from(block.querySelectorAll(PHRASE_SELECTOR)).filter((element) =>
      range.intersectsNode(element)
    )
    for (const element of targets) element.replaceWith(...Array.from(element.childNodes))
    this.commitNow('command')
  }

  private currentImage(): HTMLImageElement | null {
    const range = currentRange()
    if (range) {
      const node = range.startContainer
      const element = isElement(node) ? node : node.parentElement
      const inside = element?.closest('img')
      if (inside) return inside as HTMLImageElement
    }
    const block = this.focusedTopBlock()
    return (block?.querySelector('img') as HTMLImageElement | null) ?? null
  }

  private zoomImage(percent: number): void {
    const image = this.currentImage()
    if (!image) return
    const value = Number.isFinite(percent) && percent > 0 ? percent : 100
    image.style.width = value + '%'
    image.removeAttribute('width')
    this.commitNow('command')
  }

  private selectAll(): void {
    const range = document.createRange()
    range.selectNodeContents(this.root)
    selectRange(range)
    this.updateFocusClass()
  }

  private selectBlock(): void {
    const block = this.focusedTopBlock()
    if (!block) return
    const range = document.createRange()
    range.selectNodeContents(block)
    selectRange(range)
  }

  private selectLine(remove: boolean): void {
    const block = this.nearestBlock()
    const offset = block ? caretOffsetIn(block) : null
    if (!block || offset === null) return
    const text = block.textContent ?? ''
    let start = 0
    for (let i = offset - 1; i >= 0; i -= 1) {
      if (SENTENCE_END_RE.test(text[i]) || text[i] === '\n') {
        start = i + 1
        break
      }
    }
    let end = text.length
    for (let i = offset; i < text.length; i += 1) {
      if (SENTENCE_END_RE.test(text[i]) || text[i] === '\n') {
        end = i + 1
        break
      }
    }
    if (remove) {
      if (deleteOffsets(block, start, end)) this.commitNow('command')
      return
    }
    const range = rangeForOffsets(block, start, end)
    if (range) selectRange(range)
  }

  private selectPhrase(): void {
    const range = currentRange()
    if (!range) return
    const node = range.startContainer
    const element = isElement(node) ? node : node.parentElement
    const phrase = element?.closest(PHRASE_SELECTOR)
    if (!phrase) {
      this.selectWord()
      return
    }
    const selection = document.createRange()
    selection.selectNodeContents(phrase)
    selectRange(selection)
  }

  private selectWord(): void {
    this.prepareRange()
  }

  private jumpToEdge(start: boolean, lineOnly: boolean): void {
    const target = lineOnly
      ? this.nearestBlock()
      : start
        ? this.root.firstElementChild
        : this.root.lastElementChild
    if (!target) return
    if (start) placeCaretAtStart(target)
    else placeCaretAtEnd(target)
    this.updateFocusClass()
    this.updateTypewriter()
  }

  private jumpToSelection(): void {
    const range = currentRange()
    if (!range) return
    const node = range.startContainer
    const element = isElement(node) ? node : node.parentElement
    element?.scrollIntoView({ block: 'nearest' })
  }

  private extendSelection(start: boolean, lineOnly: boolean): void {
    const range = currentRange()
    if (!range) return
    const target = lineOnly
      ? this.nearestBlock()
      : start
        ? this.root.firstElementChild
        : this.root.lastElementChild
    if (!target) return
    const next = document.createRange()
    if (start) {
      next.setStart(target, 0)
      next.setEnd(range.startContainer, range.startOffset)
    } else {
      next.setStart(range.endContainer, range.endOffset)
      next.setEnd(target, target.childNodes.length)
    }
    selectRange(next)
  }

  private deleteBlock(): void {
    const block = this.focusedTopBlock()
    if (!block) return
    const caret = currentCaretPosition(this.root)
    block.remove()
    if (this.root.children.length === 0) {
      const paragraph = document.createElement('p')
      paragraph.className = PARAGRAPH_CLASS
      paragraph.innerHTML = '<br>'
      this.root.appendChild(paragraph)
      placeCaretAtStart(paragraph)
    } else if (caret) {
      const index = Math.min(caret.block, this.root.children.length - 1)
      setCaretPosition(this.root, { block: index, offset: 0 })
    }
    this.updateFocusClass()
    this.commitNow('command')
  }

  private deleteScope(): void {
    const range = currentRange()
    if (!range) return
    const node = range.startContainer
    const element = isElement(node) ? node : node.parentElement
    const phrase = element?.closest(PHRASE_SELECTOR)
    if (!phrase || phrase === element?.closest('p,h1,h2,h3,h4,h5,h6')) return
    const after = document.createRange()
    after.setStartBefore(phrase)
    after.collapse(true)
    phrase.remove()
    selectRange(after)
    this.commitNow('command')
  }

  private deleteWord(): void {
    const range = this.prepareRange()
    if (!range || range.collapsed) return
    range.deleteContents()
    range.collapse(true)
    selectRange(range)
    this.commitNow('command')
  }

  private selectionFragment(): { nodes: Node[]; text: string; html: string } {
    const holder = document.createElement('div')
    const range = currentRange()
    if (!range || !this.root.contains(range.startContainer)) {
      for (const node of Array.from(this.root.childNodes)) holder.appendChild(node.cloneNode(true))
    } else {
      holder.appendChild(range.cloneContents())
    }
    return {
      nodes: Array.from(holder.childNodes),
      text: holder.textContent ?? '',
      html: holder.innerHTML
    }
  }

  private async copyPlain(): Promise<void> {
    await copyText(this.selectionFragment().text)
  }

  private async copyMarkdown(): Promise<void> {
    const fragment = this.selectionFragment()
    const markdown = serializeSelection(fragment.nodes)
    await copyPayload({ plain: markdown, markdown })
  }

  private async copyHtml(): Promise<void> {
    const fragment = this.selectionFragment()
    await copyPayload({ plain: fragment.text, html: fragment.html })
  }

  private async copySemantic(): Promise<void> {
    const fragment = this.selectionFragment()
    const holder = document.createElement('div')
    holder.innerHTML = fragment.html
    for (const element of Array.from(holder.querySelectorAll('span,div,font'))) {
      if (element.children.length === 0) element.replaceWith(...Array.from(element.childNodes))
    }
    for (const element of Array.from(holder.querySelectorAll('*'))) {
      for (const attribute of Array.from(element.attributes)) {
        if (!['href', 'src', 'alt', 'title'].includes(attribute.name))
          element.removeAttribute(attribute.name)
      }
    }
    await copyPayload({ plain: holder.textContent ?? '', html: holder.innerHTML })
  }

  private async copyImage(): Promise<void> {
    const image = this.currentImage()
    const source = image?.getAttribute('src') ?? ''
    if (source === '') return
    if (!(await copyImageBytes(source))) await copyText(source)
  }

  private async pastePlain(): Promise<void> {
    const text = await readClipboardText()
    if (text === '') return
    this.insertPlainText(text)
    this.flush()
  }

  private async openLink(openIt: boolean): Promise<void> {
    const range = currentRange()
    if (!range) return
    const node = range.startContainer
    const element = isElement(node) ? node : node.parentElement
    const href = element?.closest('a')?.getAttribute('href') ?? ''
    if (href === '') return
    if (openIt) window.open(href, '_blank', 'noopener')
    else await copyText(href)
  }

  private setReadonly(readonly: boolean): void {
    this.root.setAttribute('contenteditable', readonly ? 'false' : 'true')
  }

  // ------------------------------------------------------------------ input rules

  private runInputRules(): boolean {
    this.refreshPendingFence()
    const block = this.matchBlockInputRule()
    if (block !== null) {
      // remember the literal text as its own step so one rule is exactly one undo
      this.flush()
      if (block.kind === 'fence') {
        // nothing structural happens yet: the marker stays in the paragraph as the query
        this.openFenceLangPicker(block.block)
        return true
      }
      this.applyBlockInputRule(block)
      this.commitNow('command')
      return true
    }
    const inline = this.matchInlineInputRule()
    if (inline !== null) {
      this.flush()
      this.applyInlineInputRule(inline)
      this.commitNow('command')
      return true
    }
    return false
  }

  private matchBlockInputRule(): BlockRuleMatch | null {
    // A realistic browser types the trailing space as U+00A0; the rules below are
    // written against a plain space, so normalise before matching.
    const plain = plainText
    const range = currentRange()
    if (!range || !range.collapsed || !this.root.contains(range.startContainer)) return null
    const inner = nearestBlockAt(this.root, range.startContainer)
    if (inner !== null && inner.tagName === 'LI') {
      // inside an existing item only the task marker converts (`- ` already made the list)
      const offset = caretOffsetIn(inner)
      if (offset === null) return null
      const itemHead = plain(inner.textContent ?? '').slice(0, offset)
      const taskItem = /^\[([ xX])\] $/.exec(itemHead)
      if (taskItem === null) return null
      return {
        kind: 'taskItem',
        block: inner,
        markerLength: itemHead.length,
        checked: taskItem[1].toLowerCase() === 'x'
      }
    }
    const block = this.focusedTopBlock()
    if (!block || block.tagName !== 'P') return null
    if (block.classList.contains('md-alert')) return null
    const caret = caretOffsetIn(block)
    if (caret === null) return null
    const text = plain(block.textContent ?? '')
    const head = text.slice(0, caret)

    if (/^(---+|\*\*\*+|___+)$/.test(text) && caret === text.length) {
      return { kind: 'hr', block, markerLength: text.length }
    }
    const task = /^([-*+]) \[([ xX])\] $/.exec(head)
    if (task) {
      return {
        kind: 'task',
        block,
        markerLength: head.length,
        checked: task[2].toLowerCase() === 'x'
      }
    }
    const heading = /^(#{1,6}) $/.exec(head)
    if (heading)
      return { kind: 'heading', block, markerLength: head.length, level: heading[1].length }
    const fence = /^(`{3,}|~{3,})([A-Za-z0-9#+._-]*) $/.exec(head)
    if (fence) {
      return { kind: 'fence', block, markerLength: head.length, language: fence[2] }
    }
    const ordered = /^(\d{1,9})\. $/.exec(head)
    if (ordered) {
      return { kind: 'ordered', block, markerLength: head.length, start: Number(ordered[1]) }
    }
    const bullet = /^([-*+]) $/.exec(head)
    if (bullet) return { kind: 'bullet', block, markerLength: head.length, mark: bullet[1] }
    if (/^> $/.test(head)) return { kind: 'quote', block, markerLength: head.length }
    return null
  }

  private applyBlockInputRule(match: BlockRuleMatch): void {
    const block = match.block
    deleteOffsets(block, 0, match.markerLength)
    for (const node of Array.from(block.childNodes)) {
      // deleteOffsets can leave a zero-length text node behind; it must not become the caret anchor
      if (node.nodeType === Node.TEXT_NODE && (node.nodeValue ?? '') === '') node.remove()
    }
    if ((block.textContent ?? '') === '') {
      // drop the empty-paragraph <br> sentinel now that the marker text is gone
      for (const br of Array.from(block.querySelectorAll('br'))) br.remove()
    }
    switch (match.kind) {
      case 'taskItem': {
        block.className =
          'md-list-item task-list-item md-task-list-item task-list-' +
          (match.checked ? 'done' : 'not-done')
        const checkbox = document.createElement('input')
        checkbox.type = 'checkbox'
        checkbox.className = 'task-list-item-checkbox'
        checkbox.checked = match.checked
        block.insertBefore(checkbox, block.firstChild)
        ensurePlaceholder(block)
        placeCaretWithin(block, 0)
        return
      }
      case 'heading': {
        const heading = document.createElement('h' + match.level)
        heading.className = 'md-end-block'
        while (block.firstChild) heading.appendChild(block.firstChild)
        block.replaceWith(heading)
        ensurePlaceholder(heading)
        placeCaretWithin(heading, 0)
        return
      }
      case 'bullet':
      case 'task': {
        const list = document.createElement('ul')
        list.className = 'ul-list'
        list.setAttribute(
          'data-mark',
          match.kind === 'task' ? currentSerializationOptions().unorderedMarker : match.mark
        )
        const item = document.createElement('li')
        item.className = 'md-list-item'
        if (match.kind === 'task') {
          item.className +=
            ' task-list-item md-task-list-item task-list-' + (match.checked ? 'done' : 'not-done')
          const checkbox = document.createElement('input')
          checkbox.type = 'checkbox'
          checkbox.className = 'task-list-item-checkbox'
          checkbox.checked = match.checked
          item.appendChild(checkbox)
        }
        while (block.firstChild) item.appendChild(block.firstChild)
        list.appendChild(item)
        block.replaceWith(list)
        ensurePlaceholder(item)
        placeCaretWithin(item, 0)
        return
      }
      case 'ordered': {
        const list = document.createElement('ol')
        list.className = 'ol-list'
        if (match.start !== 1) list.setAttribute('start', String(match.start))
        const item = document.createElement('li')
        item.className = 'md-list-item'
        while (block.firstChild) item.appendChild(block.firstChild)
        list.appendChild(item)
        block.replaceWith(list)
        ensurePlaceholder(item)
        placeCaretWithin(item, 0)
        return
      }
      case 'quote': {
        const quote = document.createElement('blockquote')
        quote.className = 'md-end-block'
        const paragraph = document.createElement('p')
        paragraph.className = PARAGRAPH_CLASS
        while (block.firstChild) paragraph.appendChild(block.firstChild)
        quote.appendChild(paragraph)
        block.replaceWith(quote)
        ensurePlaceholder(paragraph)
        placeCaretWithin(paragraph, 0)
        return
      }
      case 'hr': {
        const rule = document.createElement('hr')
        rule.className = 'md-hr md-end-block'
        const paragraph = document.createElement('p')
        paragraph.className = PARAGRAPH_CLASS
        paragraph.innerHTML = '<br>'
        block.replaceWith(rule)
        rule.parentNode?.insertBefore(paragraph, rule.nextSibling)
        placeCaretAtStart(paragraph)
        return
      }
      default:
        return
    }
  }

  private convertToFence(block: HTMLElement, language: string): void {
    const text = block.textContent ?? ''
    const lang = language
    const pre = document.createElement('pre')
    pre.className = 'md-fences md-end-block'
    if (lang !== '') pre.setAttribute('lang', lang)
    const code = document.createElement('code')
    code.className = lang !== '' ? 'language-' + lang + ' hljs' : 'hljs'
    code.textContent = text
    pre.appendChild(code)
    this.attachCodeTooltip(pre, lang)
    block.replaceWith(pre)
    ensurePlaceholder(code)
    placeCaretWithin(code, text.length)
  }

  /** Merges adjacent text nodes so a marker can be matched even when typing split it. */
  private normalizeCaretText(): { node: Text; offset: number } | null {
    const range = currentRange()
    if (!range || !range.collapsed) return null
    const startNode = range.startContainer
    if (startNode.nodeType !== Node.TEXT_NODE) return null
    const parent = startNode.parentNode
    if (parent === null) return null
    let offset = range.startOffset
    let cursor = startNode.previousSibling
    while (cursor !== null && cursor.nodeType === Node.TEXT_NODE) {
      offset += (cursor.nodeValue ?? '').length
      cursor = cursor.previousSibling
    }
    parent.normalize()
    let remaining = offset
    let target: Text | null = null
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType !== Node.TEXT_NODE) continue
      const length = (child as Text).nodeValue?.length ?? 0
      if (remaining <= length) {
        target = child as Text
        break
      }
      remaining -= length
    }
    if (target === null) return null
    const caret = document.createRange()
    caret.setStart(target, remaining)
    caret.collapse(true)
    selectRange(caret)
    return { node: target, offset: remaining }
  }

  private matchInlineInputRule(): InlineRuleMatch | null {
    const normalized = this.normalizeCaretText()
    if (normalized === null) return null
    const node = normalized.node
    const text = node.nodeValue ?? ''
    const caret = normalized.offset
    if (caret < 3) return null
    // same NBSP caveat as the block rules: match on the normalised copy
    const head = plainText(text.slice(0, caret))
    for (const rule of INLINE_INPUT_RULES) {
      if (!head.endsWith(rule.closer)) continue
      const closeStart = head.length - rule.closer.length
      if (isEscapedAt(head, closeStart)) continue
      if (rule.closer.length === 1 && head[closeStart - 1] === rule.closer) continue
      const openIndex = head.lastIndexOf(rule.opener, closeStart - rule.opener.length)
      if (openIndex < 0) continue
      if (isEscapedAt(head, openIndex)) continue
      if (head[openIndex - 1] === rule.opener[0]) continue
      const contentStart = openIndex + rule.opener.length
      const content = plainText(head.slice(contentStart, closeStart))
      if (content === '' || content.includes('\n')) continue
      if (content.includes(rule.opener) && rule.opener !== rule.closer) continue
      if (!rule.allowSpace && (/\s/.test(content[0]) || /\s$/.test(content))) continue
      return { rule, node, openIndex, caretIndex: caret, content }
    }
    return null
  }

  private applyInlineInputRule(match: InlineRuleMatch): void {
    const element =
      match.rule.math === true
        ? createMathElement(match.content)
        : this.createInline(match.rule.tag, match.rule.className)
    if (element === null) return
    if (match.rule.math !== true) element.textContent = match.content
    this.replaceInlineConstruct(match, element)
  }

  private replaceInlineConstruct(match: InlineRuleMatch, element: HTMLElement): void {
    const node = match.node
    const parent = node.parentNode
    if (!parent) return
    const text = node.nodeValue ?? ''
    const head = text.slice(0, match.openIndex)
    const tail = text.slice(match.caretIndex)
    node.nodeValue = head
    parent.insertBefore(element, node.nextSibling)
    let tailNode: Text | null = null
    if (tail !== '') {
      tailNode = document.createTextNode(tail)
      parent.insertBefore(tailNode, element.nextSibling)
    }
    if (head === '') node.remove()
    const range = document.createRange()
    if (tailNode !== null) range.setStart(tailNode, 0)
    else range.setStartAfter(element)
    range.collapse(true)
    selectRange(range)
  }

  private applyEnterBlockRules(): boolean {
    if (this.pendingFence !== null) {
      this.commitFenceLang()
      return true
    }
    const range = currentRange()
    if (!range || !range.collapsed) return false
    const block = this.focusedTopBlock()
    if (!block || block.tagName !== 'P') return false
    const caret = caretOffsetIn(block)
    const text = plainText(block.textContent ?? '')
    if (caret === null || caret !== text.length) return false
    const fence = /^(`{3,}|~{3,})([A-Za-z0-9#+._-]*)\s*$/.exec(text)
    if (fence) {
      this.flush()
      deleteOffsets(block, 0, text.length)
      this.convertToFence(block, fence[2])
      this.commitNow('command')
      return true
    }
    const table = /^\|(.+)\|\s*$/.exec(text)
    if (table) {
      const cells = table[1].split('|').map((cell) => cell.trim())
      if (cells.length < 2) return false
      this.flush()
      this.applyTableConversion(block, cells)
      this.commitNow('command')
      return true
    }
    return false
  }

  private applyTableConversion(block: HTMLElement, cells: string[]): void {
    const wrapper = document.createElement('div')
    wrapper.className = 'md-table md-table-fig md-end-block'
    const table = document.createElement('table')
    table.className = 'md-table'
    const head = document.createElement('thead')
    const headRow = document.createElement('tr')
    for (const cell of cells) {
      const th = document.createElement('th')
      if (cell === '') th.appendChild(document.createElement('br'))
      else th.textContent = cell
      headRow.appendChild(th)
    }
    head.appendChild(headRow)
    table.appendChild(head)
    const body = document.createElement('tbody')
    const bodyRow = document.createElement('tr')
    for (let index = 0; index < cells.length; index += 1) {
      const cell = document.createElement('td')
      cell.appendChild(document.createElement('br'))
      bodyRow.appendChild(cell)
    }
    body.appendChild(bodyRow)
    table.appendChild(body)
    wrapper.appendChild(table)
    const paragraph = document.createElement('p')
    paragraph.className = PARAGRAPH_CLASS
    paragraph.innerHTML = '<br>'
    block.replaceWith(wrapper)
    wrapper.parentNode?.insertBefore(paragraph, wrapper.nextSibling)
    placeCaretWithin(headRow.firstElementChild ?? wrapper, 0)
  }

  private handleBackspaceAtStart(): boolean {
    const range = currentRange()
    if (!range || !range.collapsed) return false
    const block = nearestBlockAt(this.root, range.startContainer)
    if (block === null) return false
    const offset = caretOffsetIn(block)
    if (offset !== 0) return false
    const top = this.focusedTopBlock()
    if (top === null) return false
    if (block.tagName === 'PRE') {
      this.flush()
      this.replaceWithParagraph(block, '')
      this.commitNow('command')
      return true
    }
    if (HEADING_RE.test(block.tagName)) {
      this.flush()
      this.replaceWithParagraph(block, '')
      this.commitNow('command')
      return true
    }
    if (block.tagName === 'P' && top.tagName === 'BLOCKQUOTE') {
      this.flush()
      const paragraphs: HTMLElement[] = []
      for (const child of Array.from(top.children)) {
        const paragraph = document.createElement('p')
        paragraph.className = PARAGRAPH_CLASS
        while (child.firstChild) paragraph.appendChild(child.firstChild)
        paragraphs.push(paragraph)
      }
      if (paragraphs.length === 0) return false
      top.replaceWith(...paragraphs)
      placeCaretAtStart(paragraphs[0])
      this.commitNow('command')
      return true
    }
    if (block.tagName === 'LI') {
      const item = block
      const list = item.parentElement
      if (list === null) return false
      this.flush()
      const parentItem = list.parentElement
      if (parentItem !== null && parentItem.tagName === 'LI') {
        this.outdentListItem(item)
        placeCaretWithin(item, 0)
        this.commitNow('command')
        return true
      }
      const paragraph = document.createElement('p')
      paragraph.className = PARAGRAPH_CLASS
      for (const child of Array.from(item.childNodes)) {
        if (isElement(child) && child.tagName === 'INPUT') continue
        paragraph.appendChild(child)
      }
      if ((paragraph.textContent ?? '') === '' && paragraph.querySelector('img') === null) {
        paragraph.innerHTML = '<br>'
      }
      const isFirst = item.previousElementSibling === null
      item.remove()
      if (list.children.length === 0) list.replaceWith(paragraph)
      else if (isFirst) list.parentNode?.insertBefore(paragraph, list)
      else list.parentNode?.insertBefore(paragraph, list.nextSibling)
      placeCaretAtStart(paragraph)
      this.commitNow('command')
      return true
    }
    return false
  }

  private replaceWithParagraph(element: HTMLElement, className: string): void {
    const paragraph = document.createElement('p')
    paragraph.className = className === '' ? PARAGRAPH_CLASS : className
    while (element.firstChild) paragraph.appendChild(element.firstChild)
    if ((paragraph.textContent ?? '') === '' && paragraph.querySelector('img') === null) {
      paragraph.innerHTML = '<br>'
    }
    element.replaceWith(paragraph)
    placeCaretAtStart(paragraph)
  }

  private charBeforeCaret(range: Range, char: string): boolean {
    const node = range.startContainer
    if (node.nodeType !== Node.TEXT_NODE) return false
    return (node.nodeValue ?? '')[range.startOffset - 1] === char
  }

  private charAfterCaret(range: Range, char: string): boolean {
    const node = range.startContainer
    if (node.nodeType !== Node.TEXT_NODE) return false
    return (node.nodeValue ?? '')[range.startOffset] === char
  }

  private handleAutoPair(event: KeyboardEvent): boolean {
    if (this.composing) return false
    const char = event.key
    const range = currentRange()
    if (!range || !this.root.contains(range.startContainer)) return false

    const closing = isClosingPair(char, this.autoPairBracket, this.autoPairMarkdown)
    if (closing && range.collapsed && this.charAfterCaret(range, char)) {
      // stepping over an existing closer instead of duplicating it
      const next = document.createRange()
      next.setStart(range.startContainer, range.startOffset + 1)
      next.collapse(true)
      selectRange(next)
      if (!this.runInputRules()) this.scheduleCommit('input')
      return true
    }

    const closer = pairCloserFor(char, this.autoPairBracket, this.autoPairMarkdown)
    if (closer === undefined) return false
    // a run of the same character is never paired: three fences must stay three characters
    if (this.charBeforeCaret(range, char)) return false
    const selected = range.collapsed ? '' : range.toString()
    range.deleteContents()
    const node = document.createTextNode(char + selected + closer)
    range.insertNode(node)
    const caret = document.createRange()
    caret.setStart(node, char.length + selected.length)
    caret.collapse(true)
    selectRange(caret)
    this.scheduleCommit('input')
    return true
  }

  private applyAutoCorrect(): boolean {
    const normalized = this.normalizeCaretText()
    if (normalized === null) return false
    const node = normalized.node
    const text = node.nodeValue ?? ''
    const caret = normalized.offset
    if (caret < 3) return false
    const fix = findTypoFix(text.slice(0, caret))
    if (fix === null) return false
    node.nodeValue = text.slice(0, fix.start) + fix.replacement + text.slice(fix.end)
    const caretRange = document.createRange()
    caretRange.setStart(node, fix.start + fix.replacement.length)
    caretRange.collapse(true)
    selectRange(caretRange)
    return true
  }

  private handleRawEditorClick(event: MouseEvent): boolean {
    const target = event.target
    if (!(target instanceof Element)) return false
    if (target.closest('.md-raw-edit') !== null) return true
    const block = target.closest('.md-math-block, .md-diagram')
    if (!(block instanceof HTMLElement) || !this.root.contains(block)) return false
    if (target.closest('.md-raw-edit') !== null) return true
    event.preventDefault()
    this.openRawEditor(block)
    return true
  }

  /**
   * Typora-style raw editor: clicking a math block or a mermaid diagram swaps the
   * rendered output for a monospace source panel. The panel never reaches the Markdown
   * serialiser (the block keeps its data attribute until the edit is committed).
   */
  private openRawEditor(block: HTMLElement): void {
    if (block.querySelector('.md-raw-edit') !== null) return
    const attribute = block.classList.contains('md-math-block') ? 'data-math' : 'data-mermaid'
    const original = block.getAttribute(attribute) ?? ''
    const panel = document.createElement('textarea')
    panel.className = 'md-raw-edit'
    panel.value = original
    panel.spellcheck = false
    panel.setAttribute('contenteditable', 'false')
    panel.setAttribute('data-md-panel', 'true')
    let closed = false
    const close = (commit: boolean): void => {
      if (closed) return
      closed = true
      const value = panel.value
      panel.remove()
      block.classList.remove('md-raw-edit-open')
      if (!commit || value === original) return
      block.setAttribute(attribute, value)
      const markdown = this.getMarkdown()
      this.render(markdown)
      this.commitNow('command')
    }
    panel.addEventListener('keydown', (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        close(false)
        return
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        close(true)
      }
    })
    panel.addEventListener('blur', (): void => {
      close(true)
    })
    block.classList.add('md-raw-edit-open')
    block.appendChild(panel)
    panel.focus()
    panel.select()
  }

  private handleTableSelection(event: MouseEvent): boolean {
    const target = event.target
    if (!(target instanceof HTMLElement)) return false
    const cell = target.closest('td,th')
    if (!(cell instanceof HTMLTableCellElement)) return false
    const row = cell.parentElement
    const table = cell.closest('table')
    if (row === null || table === null) return false
    const rect = cell.getBoundingClientRect()
    const nearTop = event.clientY - rect.top <= TABLE_EDGE
    const nearLeft = event.clientX - rect.left <= TABLE_EDGE
    if (!nearTop && !nearLeft) return false
    for (const marked of Array.from(
      table.querySelectorAll('.md-table-col-selected, .md-table-row-selected')
    )) {
      marked.classList.remove('md-table-col-selected', 'md-table-row-selected')
    }
    const range = document.createRange()
    if (nearTop) {
      const index = Array.prototype.indexOf.call(row.children, cell)
      const column = Array.from(table.querySelectorAll('tr'))
        .map((line) => line.children[index])
        .filter((node): node is Element => node !== undefined)
      if (column.length === 0) return false
      for (const cellOfColumn of column) cellOfColumn.classList.add('md-table-col-selected')
      // a DOM selection cannot be discontiguous, so it spans the column's cell block
      range.setStartBefore(column[0])
      range.setEndAfter(column[column.length - 1])
    } else {
      for (const cellOfRow of Array.from(row.children)) {
        cellOfRow.classList.add('md-table-row-selected')
      }
      range.setStartBefore(row)
      range.setEndAfter(row)
    }
    event.preventDefault()
    selectRange(range)
    return true
  }

  private moveTableCell(cell: HTMLTableCellElement, backwards: boolean): void {
    const table = cell.closest('table')
    if (table === null) return
    const cells = Array.from(table.querySelectorAll('td,th')) as HTMLTableCellElement[]
    const index = cells.indexOf(cell)
    if (index < 0) return
    const target = backwards ? cells[index - 1] : cells[index + 1]
    if (target !== undefined) {
      placeCaretWithin(target, 0)
      return
    }
    if (backwards) return
    // past the last cell: Typora appends a row and keeps going
    const lastRow =
      table.querySelector('tbody tr:last-child') ?? table.querySelector('tr:last-child')
    const columns = lastRow === null ? 1 : lastRow.children.length
    const row = document.createElement('tr')
    for (let count = 0; count < columns; count += 1) {
      const created = document.createElement('td')
      created.appendChild(document.createElement('br'))
      row.appendChild(created)
    }
    const body = table.querySelector('tbody')
    if (body !== null) body.appendChild(row)
    else table.appendChild(row)
    const first = row.firstElementChild
    if (first !== null) placeCaretWithin(first, 0)
    this.commitNow('command')
  }

  // ------------------------------------------------------- images: paste and drop

  private imageInsertionRange(): Range | null {
    const range = currentRange()
    if (
      range !== null &&
      range.startContainer !== this.root &&
      this.root.contains(range.startContainer)
    ) {
      // an empty block keeps a <br> sentinel; inserting after it would add a stray hard break
      const container = range.startContainer
      if (
        container instanceof HTMLElement &&
        range.startOffset > 0 &&
        (container.textContent ?? '') === ''
      ) {
        const previous = container.childNodes[range.startOffset - 1]
        if (previous !== undefined && previous.nodeName === 'BR') {
          range.setStart(container, range.startOffset - 1)
          range.collapse(true)
        }
      }
      return range
    }
    if (range !== null && range.startContainer === this.root && this.root.children.length > 0) {
      // a caret parked between blocks (click into the padding) still needs a block to land in
      const index = Math.min(Math.max(range.startOffset, 0), this.root.children.length - 1)
      const target = this.root.children[index] as HTMLElement
      const inside = document.createRange()
      inside.selectNodeContents(target)
      inside.collapse(false)
      return inside
    }
    const last = this.root.lastElementChild
    if (last === null) return null
    const fallback = document.createRange()
    fallback.selectNodeContents(last)
    fallback.collapse(false)
    return fallback
  }

  /**
   * Inserts every image in order. Dropped/pasted files carry an on-disk path in Electron, so
   * the archive rule (settings/images insertImageSource) can copy them; a clipboard bitmap has
   * no path, so its bytes travel as a data URL instead.
   */
  private async insertImageInputs(files: File[], paths: string[]): Promise<void> {
    const sources: string[] = [...paths]
    for (const file of files) {
      const local = localPathOfFile(file)
      if (local !== '') {
        sources.push(local)
        continue
      }
      const dataUrl = await readFileAsDataUrl(file)
      if (dataUrl !== '') sources.push(dataUrl)
    }
    if (sources.length === 0) return
    const resolved: string[] = []
    for (const source of sources) {
      try {
        resolved.push(await insertImageSource(source))
      } catch (error) {
        console.warn('[editor] insertImage: keeping the raw source :: ' + String(error))
        resolved.push(source)
      }
    }
    const range = this.imageInsertionRange()
    if (range === null) return
    range.deleteContents()
    const caret = document.createRange()
    caret.setStart(range.startContainer, range.startOffset)
    caret.collapse(true)
    for (const src of resolved) {
      const image = document.createElement('img')
      image.setAttribute('src', src)
      image.setAttribute('alt', 'image')
      caret.insertNode(image)
      caret.setStartAfter(image)
      caret.collapse(true)
    }
    selectRange(caret)
    this.commitNow('command')
  }

  private static isImageFile(file: File): boolean {
    return file.type.startsWith('image/') || IMAGE_EXTENSION_RE.test(file.name)
  }

  private handleDragOver = (event: DragEvent): void => {
    const data = event.dataTransfer
    if (data === null) return
    const types = Array.from(data.types)
    if (!types.includes('Files') && !types.includes('text/uri-list')) return
    event.preventDefault()
    data.dropEffect = 'copy'
    this.root.classList.add('md-drop-target')
    // preview the insertion point under the pointer
    const withCaret = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null
    }
    const caret = withCaret.caretRangeFromPoint?.(event.clientX, event.clientY)
    if (caret !== undefined && caret !== null && this.root.contains(caret.startContainer)) {
      selectRange(caret)
    }
  }

  private handleDragLeave = (): void => {
    this.root.classList.remove('md-drop-target')
  }

  private handleDrop = (event: DragEvent): void => {
    this.root.classList.remove('md-drop-target')
    const data = event.dataTransfer
    if (data === null) return
    const files = Array.from(data.files).filter((file) => WysiwygEngine.isImageFile(file))
    const paths = imagePathsFromDataTransfer(data)
    // a non-image drop stays untouched so the browser/other handlers can deal with it
    if (files.length === 0 && paths.length === 0) return
    event.preventDefault()
    void this.insertImageInputs(files, paths)
  }
  /**
   * Swaps the focused top-level block with its neighbour (menu: paragraph.moveUp/Down).
   * Items move inside their own list; crossing a list boundary is left to a no-op so the
   * structure stays legal.
   */
  private moveBlock(direction: -1 | 1): void {
    const range = currentRange()
    if (range === null || !this.root.contains(range.startContainer)) return
    const block = this.focusedTopBlock()
    if (block === null) return
    const inner = nearestBlockAt(this.root, range.startContainer)
    if (inner !== null && inner.tagName === 'LI') {
      const sibling = direction < 0 ? inner.previousElementSibling : inner.nextElementSibling
      const list = inner.parentElement
      if (sibling === null || list === null) return
      const offset = caretOffsetIn(inner) ?? 0
      this.flush()
      if (direction < 0) list.insertBefore(inner, sibling)
      else list.insertBefore(sibling, inner)
      placeCaretWithin(inner, offset)
      this.commitNow('command')
      return
    }
    const sibling = direction < 0 ? block.previousElementSibling : block.nextElementSibling
    const parent = block.parentNode
    if (sibling === null || parent === null) return
    const offset = caretOffsetIn(block)
    this.flush()
    if (direction < 0) parent.insertBefore(block, sibling)
    else parent.insertBefore(sibling, block)
    if (offset !== null) placeCaretWithin(block, offset)
    this.commitNow('command')
  }
  // ----------------------------------------------------- fence language pill

  /** The query is whatever follows the fence marker inside the paragraph. */
  private fenceQueryOf(block: HTMLElement): string {
    const text = plainText(block.textContent ?? '')
    const marker = /^(`{3,}|~{3,})\s*/.exec(text)
    return marker === null ? text.trim() : text.slice(marker[0].length)
  }

  /** A fence marker plus a space was typed: keep the paragraph and ask for the language. */
  private openFenceLangPicker(block: HTMLElement): void {
    this.pendingFence = block
    this.updateLangSuggest(this.fenceQueryOf(block), block)
  }

  /** Keeps the list in step with the typed query; drops the picker if the block went away. */
  private refreshPendingFence(): void {
    const block = this.pendingFence
    if (block === null) return
    if (!block.isConnected) {
      this.cancelPendingFence()
      return
    }
    if (!/^(`{3,}|~{3,})/.test(plainText(block.textContent ?? ''))) {
      this.cancelPendingFence()
      return
    }
    this.updateLangSuggest(this.fenceQueryOf(block), block)
  }

  private cancelPendingFence(): void {
    this.pendingFence = null
    this.hideLangSuggest()
  }

  /** Enter in the picker: highlighted candidate, else the typed query, else no language. */
  private commitFenceLang(explicit?: string): void {
    const block = this.pendingFence
    this.pendingFence = null
    const pick =
      this.langSuggest !== null && !this.langSuggest.hidden
        ? this.langCandidates[this.langIndex]
        : undefined
    const query = block === null ? '' : this.fenceQueryOf(block)
    this.hideLangSuggest()
    if (block === null || !block.isConnected) return
    this.flush()
    deleteOffsets(block, 0, (block.textContent ?? '').length)
    this.convertToFence(block, explicit ?? pick ?? query)
    this.commitNow('command')
  }

  private attachCodeTooltip(pre: HTMLElement, lang: string): void {
    if (pre.querySelector(':scope > .code-tooltip') !== null) return
    const tooltip = document.createElement('div')
    tooltip.className = 'code-tooltip md-tooltip-remove'
    tooltip.setAttribute('align', 'right')
    tooltip.setAttribute('contenteditable', 'false')
    const span = document.createElement('span')
    span.className = 'ty-input ty-input-after ty-cm-lang-input'
    span.setAttribute('contenteditable', 'true')
    span.setAttribute('tabindex', '-1')
    span.setAttribute('autocorrect', 'false')
    span.setAttribute('placeholder', '代码块语言')
    span.textContent = lang
    tooltip.appendChild(span)
    pre.insertBefore(tooltip, pre.firstChild)
  }

  private handleLangClick(event: MouseEvent): boolean {
    const target = event.target
    if (!(target instanceof HTMLElement)) return false
    const span = target.closest('.ty-cm-lang-input')
    if (!(span instanceof HTMLElement) || !this.root.contains(span)) return false
    event.preventDefault()
    this.openLangEditor(span)
    return true
  }

  private openLangEditor(span: HTMLElement): void {
    const pre = span.closest('pre.md-fences')
    if (!(pre instanceof HTMLElement)) return
    this.langTarget = { pre, original: span.textContent ?? '' }
    span.setAttribute('contenteditable', 'true')
    span.focus()
    this.selectNodeContents(span)
    this.updateLangSuggest(span.textContent ?? '', span)
  }

  private handleLangInput = (event: Event): void => {
    if (this.langTarget === null) return
    const target = event.target
    if (!(target instanceof HTMLElement) || !target.classList.contains('ty-cm-lang-input')) return
    this.updateLangSuggest(target.textContent ?? '', target)
  }

  private handleLangFocusOut = (event: FocusEvent): void => {
    if (this.pendingFence !== null) {
      const next = event.relatedTarget
      if (!(next instanceof Node) || !this.pendingFence.contains(next)) {
        this.cancelPendingFence()
        return
      }
    }
    if (this.langTarget === null) return
    const related = event.relatedTarget
    if (
      related instanceof Node &&
      this.langSuggest !== null &&
      this.langSuggest.contains(related)
    ) {
      return
    }
    this.commitLangEdit(true)
  }

  private handleLangKeydown = (event: KeyboardEvent): void => {
    if (this.langTarget === null) return
    const target = event.target
    if (!(target instanceof HTMLElement) || !target.classList.contains('ty-cm-lang-input')) return
    const panel = this.langSuggest
    const open = panel !== null && !panel.hidden
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      this.moveLangIndex(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (open) {
        this.hideLangSuggest()
        return
      }
      this.commitLangEdit(false)
      return
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      event.stopPropagation()
      const pick = open ? this.langCandidates[this.langIndex] : undefined
      if (pick !== undefined) this.pickLang(pick)
      else this.commitLangEdit(true)
    }
  }

  private ensureLangSuggest(): HTMLElement {
    if (this.langSuggest !== null) return this.langSuggest
    // a real list: the CSS already styles .typora-lang-suggest > li
    const panel = document.createElement('ul')
    panel.className = 'typora-lang-suggest'
    panel.hidden = true
    panel.addEventListener('mousedown', (event: MouseEvent): void => {
      // keep the pill focused so no focusout commit races the pick
      event.preventDefault()
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      const item = target.closest('li')
      const name = item instanceof HTMLElement ? item.dataset.lang : undefined
      if (name === undefined) return
      if (this.pendingFence !== null) this.commitFenceLang(name)
      else this.pickLang(name)
    })
    const host = document.querySelector('.typora-app') ?? document.body
    host.appendChild(panel)
    this.langSuggest = panel
    return panel
  }

  private hideLangSuggest(): void {
    if (this.langSuggest !== null) this.langSuggest.hidden = true
    this.langCandidates = []
    this.langIndex = -1
  }

  /** The list hangs under the anchor: the pill while editing one, the paragraph while creating one. */
  private updateLangSuggest(query: string, anchor: HTMLElement): void {
    const panel = this.ensureLangSuggest()
    const matches = rankLangNames(query.trim().toLowerCase())
    // no default highlight: Enter with an untouched list means "no language"
    this.langCandidates = matches
    this.langIndex = -1
    panel.replaceChildren()
    for (const name of matches) {
      const item = document.createElement('li')
      item.textContent = name
      item.dataset.lang = name
      panel.appendChild(item)
    }
    if (matches.length === 0) {
      panel.hidden = true
      return
    }
    const rect = anchor.getBoundingClientRect()
    panel.style.left = Math.round(rect.left) + 'px'
    panel.style.top = Math.round(rect.bottom + 2) + 'px'
    panel.style.minWidth = Math.max(140, Math.min(320, Math.round(rect.width))) + 'px'
    panel.scrollTop = 0
    panel.hidden = false
  }

  private moveLangIndex(delta: number): void {
    const panel = this.langSuggest
    if (panel === null || panel.hidden || this.langCandidates.length === 0) return
    const count = this.langCandidates.length
    const from = this.langIndex < 0 ? (delta > 0 ? -1 : 0) : this.langIndex
    this.langIndex = (from + delta + count) % count
    const items = Array.from(panel.children)
    for (let index = 0; index < items.length; index += 1) {
      items[index].className = index === this.langIndex ? 'md-active' : ''
    }
    const active = items[this.langIndex]
    // the panel is 12em tall and now holds the whole language table; keep the pick visible
    if (active instanceof HTMLElement) active.scrollIntoView({ block: 'nearest' })
  }

  private pickLang(name: string): void {
    const target = this.langTarget
    if (target === null) return
    const span = target.pre.querySelector('.ty-cm-lang-input')
    if (span instanceof HTMLElement) span.textContent = name
    this.hideLangSuggest()
    this.commitLangEdit(true)
  }

  private commitLangEdit(commit: boolean): void {
    const target = this.langTarget
    this.langTarget = null
    this.hideLangSuggest()
    if (target === null) return
    const span = target.pre.querySelector('.ty-cm-lang-input')
    const next = commit ? (span?.textContent ?? '').trim() : target.original.trim()
    if (span instanceof HTMLElement) {
      span.textContent = next
      span.setAttribute('contenteditable', 'true')
    }
    if (!commit || next === target.original.trim()) return
    if (next === '') target.pre.removeAttribute('lang')
    else target.pre.setAttribute('lang', next)
    const markdown = this.getMarkdown()
    this.render(markdown)
    this.commitNow('command')
  }

  private replaceAll(arg?: string | number): void {
    const spec = typeof arg === 'string' ? arg : ''
    const separator = spec.indexOf('\u0000')
    if (separator > 0) {
      const query = spec.slice(0, separator)
      const replacement = spec.slice(separator + 1)
      const source = this.getMarkdown()
      const pattern = new RegExp(escapeRegExp(query), 'gi')
      const next = source.replace(pattern, () => replacement)
      if (next !== source) this.setMarkdown(next)
      return
    }
    this.findBar.open({ replace: true, query: spec === '' ? undefined : spec })
  }
}
