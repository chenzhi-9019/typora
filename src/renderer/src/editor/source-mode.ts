import { EditorSelection, EditorState, Compartment } from '@codemirror/state'
import type { ChangeSpec, Extension, Line } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers
} from '@codemirror/view'
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting
} from '@codemirror/language'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  undo
} from '@codemirror/commands'
import {
  findNext,
  findPrevious,
  highlightSelectionMatches,
  openSearchPanel,
  search,
  searchKeymap
} from '@codemirror/search'
import { markdown } from '@codemirror/lang-markdown'
import type { EditorCommand } from './index'
import { copyImageBytes, copyPayload, copyText, readClipboardText } from './clipboard'
import { renderMarkdown, setRenderOptions } from './markdown-renderer'
import {
  setPreserveLineBreak,
  setSerializationOptions,
  setSmartPunctuation
} from './dom-to-markdown'
import { findTypoFix, isClosingPair, pairCloserFor } from './text-rules'

const HEADING_RE = /^(#{1,6})\s+/
const URL_ESCAPE_RE = /[.*+?^${}()|[\]\\]/g

export interface SourceOptions {
  parent: HTMLElement
  value: string
  wordWrap: boolean
  isTypewriter: () => boolean
  onChange: (markdown: string) => void
}

function escapeRegExp(value: string): string {
  return value.replace(URL_ESCAPE_RE, '\\$&')
}

/**
 * Source-code mode: a CodeMirror 6 editor over the Markdown text with a gutter,
 * syntax highlighting and the same command surface as the WYSIWYG engine.
 */
export class SourceEngine {
  private readonly view: EditorView
  private readonly options: SourceOptions
  private readonly gutter = new Compartment()
  private readonly wrapping = new Compartment()
  private readonly readonlyCompartment = new Compartment()
  private suppress = false
  private autoPairBracket = true
  private autoPairMarkdown = true
  private autoCorrectEnabled = false

  constructor(options: SourceOptions) {
    this.options = options
    this.view = new EditorView({
      parent: options.parent,
      state: EditorState.create({
        doc: options.value,
        extensions: this.buildExtensions()
      })
    })
    this.view.dom.classList.add('typora-source-editor')
  }

  private buildExtensions(): Extension[] {
    return [
      this.gutter.of(lineNumbers()),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      indentOnInput(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      bracketMatching(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      search({ top: true }),
      keymap.of([
        { key: 'Mod-b', run: (): boolean => this.runCommand('bold') },
        { key: 'Mod-i', run: (): boolean => this.runCommand('italic') },
        { key: 'Mod-u', run: (): boolean => this.runCommand('underline') },
        { key: 'Mod-k', run: (): boolean => this.runCommand('link') },
        { key: 'Mod-Shift-k', run: (): boolean => this.runCommand('codefence') },
        indentWithTab,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap
      ]),
      markdown(),
      this.wrapping.of(this.options.wordWrap ? EditorView.lineWrapping : []),
      EditorView.inputHandler.of((view, from, to, text): boolean =>
        this.handleTextInput(view, from, to, text)
      ),
      this.readonlyCompartment.of([EditorView.editable.of(true), EditorState.readOnly.of(false)]),
      EditorView.updateListener.of((update): void => {
        if (update.docChanged && !this.suppress) {
          this.options.onChange(update.state.doc.toString())
        }
        if ((update.selectionSet || update.docChanged) && this.options.isTypewriter()) {
          this.centerCursor()
        }
      })
    ]
  }

  /**
   * Input rules for the source surface: auto pairing (settings.autoPairBracket /
   * autoPairMarkdown) and the typo table behind settings.autoCorrect.
   */
  private handleTextInput(view: EditorView, from: number, to: number, text: string): boolean {
    if (view.composing || text.length !== 1) return false
    const doc = view.state.doc

    if (this.autoCorrectEnabled) {
      const base = Math.max(doc.lineAt(from).from, from - 64)
      const fix = findTypoFix(doc.sliceString(base, from) + text)
      if (fix !== null) {
        const start = base + fix.start
        const end = base + fix.end
        view.dispatch({
          changes: { from: start, to: end, insert: fix.replacement + text },
          selection: EditorSelection.cursor(start + fix.replacement.length + 1),
          scrollIntoView: true,
          userEvent: 'input.type'
        })
        return true
      }
    }

    const closing = isClosingPair(text, this.autoPairBracket, this.autoPairMarkdown)
    if (closing && from === to && doc.sliceString(to, Math.min(to + 1, doc.length)) === text) {
      view.dispatch({ selection: EditorSelection.cursor(to + 1), scrollIntoView: true })
      return true
    }

    const closer = pairCloserFor(text, this.autoPairBracket, this.autoPairMarkdown)
    if (closer === undefined) return false
    // a run of the same character is never paired: three fences must stay three characters
    if (doc.sliceString(Math.max(0, from - 1), from) === text) return false
    const selected = doc.sliceString(from, to)
    view.dispatch({
      changes: { from, to, insert: text + selected + closer },
      selection: EditorSelection.cursor(from + 1 + selected.length),
      scrollIntoView: true,
      userEvent: 'input.type'
    })
    return true
  }

  private runCommand(command: EditorCommand): boolean {
    this.exec(command)
    return true
  }

  getValue(): string {
    return this.view.state.doc.toString()
  }

  setValue(markdown: string): void {
    const current = this.getValue()
    if (current === markdown) return
    this.suppress = true
    this.view.dispatch({ changes: { from: 0, to: current.length, insert: markdown } })
    this.suppress = false
  }

  setWordWrap(enabled: boolean): void {
    this.view.dispatch({
      effects: this.wrapping.reconfigure(enabled ? EditorView.lineWrapping : [])
    })
  }

  setFocusMode(enabled: boolean): void {
    this.view.dispatch({ effects: this.gutter.reconfigure(enabled ? [] : lineNumbers()) })
  }

  focus(): void {
    this.view.focus()
  }

  destroy(): void {
    this.view.destroy()
  }

  private centerCursor(): void {
    const position = this.view.state.selection.main.head
    const coords = this.view.coordsAtPos(position)
    if (!coords) return
    const scroller = this.view.scrollDOM
    const rect = scroller.getBoundingClientRect()
    const delta = coords.top - (rect.top + rect.height / 2)
    if (Math.abs(delta) < 4) return
    scroller.scrollTop += delta
  }

  exec(command: EditorCommand, arg?: string | number): void {
    switch (command) {
      case 'bold':
        this.toggleWrap('**', '**')
        break
      case 'italic':
        this.toggleWrap('*', '*')
        break
      case 'strike':
        this.toggleWrap('~~', '~~')
        break
      case 'underline':
        this.toggleWrap('<u>', '</u>')
        break
      case 'code':
        this.toggleInlineCode()
        break
      case 'link':
        this.applyLink(arg)
        break
      case 'image':
        this.insertSnippet(
          '![' + this.selectedOr('image') + '](' + (typeof arg === 'string' ? arg : '') + ')'
        )
        break
      case 'heading':
        this.applyHeading(arg)
        break
      case 'quote':
        this.toggleLinePrefix(['> '], '> ')
        break
      case 'ul':
        this.toggleLinePrefix(['- ', '* ', '+ '], '- ')
        break
      case 'ol':
        this.toggleLinePrefix(['1. '], '1. ')
        break
      case 'task':
        this.toggleLinePrefix(['- [ ] ', '- [x] '], '- [ ] ')
        break
      case 'codefence':
        this.wrapBlock('```', '```')
        break
      case 'math':
        this.wrapBlock('$$', '$$')
        break
      case 'hr':
        this.insertSnippet('\n---\n')
        break
      case 'table':
        this.insertSnippet(this.tableTemplate(arg))
        break
      case 'undo':
        undo(this.view)
        break
      case 'redo':
        redo(this.view)
        break
      case 'find':
        openSearchPanel(this.view)
        break
      case 'replaceAll':
        this.replaceAll(arg)
        break
      case 'findNext':
        this.stepSearch(1)
        break
      case 'findPrevious':
        this.stepSearch(-1)
        break
      case 'replace':
        openSearchPanel(this.view)
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
        this.shiftIndent(false)
        break
      case 'outdent':
        this.shiftIndent(true)
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
        this.applyAlert(typeof arg === 'string' ? arg : 'note')
        break
      case 'linkReference':
        this.insertLinkReference()
        break
      case 'footnote':
        this.insertFootnote()
        break
      case 'toc':
        this.insertSnippet('[TOC]\n\n')
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
        this.toggleWrap('$', '$')
        break
      case 'highlight':
        this.toggleWrap('==', '==')
        break
      case 'superscript':
        this.toggleWrap('^', '^')
        break
      case 'subscript':
        this.toggleWrap('~', '~')
        break
      case 'comment':
        this.toggleWrap('<!--', '-->')
        break
      case 'clearFormat':
        this.clearFormat()
        break
      case 'zoomImage':
        this.zoomImage(typeof arg === 'number' ? arg : Number(arg ?? 100))
        break
      case 'selectAll':
        this.view.dispatch({ selection: EditorSelection.range(0, this.view.state.doc.length) })
        break
      case 'selectBlock':
        this.selectBlock()
        break
      case 'selectLine':
        this.selectSentence(false)
        break
      case 'selectPhrase':
        this.selectPhrase()
        break
      case 'selectWord':
        this.selectWord()
        break
      case 'jumpTop':
        this.placeCaret(0)
        break
      case 'jumpBottom':
        this.placeCaret(this.view.state.doc.length)
        break
      case 'jumpLineStart':
        this.placeCaret(this.view.state.doc.lineAt(this.view.state.selection.main.head).from)
        break
      case 'jumpLineEnd':
        this.placeCaret(this.view.state.doc.lineAt(this.view.state.selection.main.head).to)
        break
      case 'jumpSelection':
        this.view.dispatch({
          effects: EditorView.scrollIntoView(this.view.state.selection.main.from)
        })
        break
      case 'extendTop':
        this.extendTo(0)
        break
      case 'extendBottom':
        this.extendTo(this.view.state.doc.length)
        break
      case 'extendLineStart':
        this.extendTo(this.view.state.doc.lineAt(this.view.state.selection.main.head).from)
        break
      case 'extendLineEnd':
        this.extendTo(this.view.state.doc.lineAt(this.view.state.selection.main.head).to)
        break
      case 'deleteBlock':
        this.deleteBlock()
        break
      case 'deleteLine':
        this.selectSentence(true)
        break
      case 'deleteScope':
        this.deleteScope()
        break
      case 'deleteWord':
        this.deleteWord()
        break
      case 'copyPlain':
        void copyText(this.selectedOr(''))
        break
      case 'copyMarkdown':
        void copyPayload({ plain: this.selectedOr(''), markdown: this.selectedOr('') })
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
        void this.linkAction(true)
        break
      case 'copyLink':
        void this.linkAction(false)
        break
      case 'readonly': {
        const readonly = arg === 1 || arg === '1'
        this.view.dispatch({
          effects: this.readonlyCompartment.reconfigure([
            EditorView.editable.of(!readonly),
            EditorState.readOnly.of(readonly)
          ])
        })
        break
      }
      case 'spellcheck':
        this.view.contentDOM.spellcheck = arg === 1 || arg === '1'
        break
      case 'refreshMath':
        break
      case 'preserveLineBreak':
        setPreserveLineBreak(arg === 1 || arg === '1')
        break
      case 'showBr':
        setRenderOptions({ showBr: arg === 1 || arg === '1' })
        break
      case 'smartPunctuation': {
        const smart = arg === 1 || arg === '1'
        setSmartPunctuation(smart)
        setRenderOptions({ smartPunctuation: smart })
        break
      }
      case 'remapPunctuation':
        setRenderOptions({ remapPunctuation: arg === 1 || arg === '1' })
        break
      case 'strictMode':
        setRenderOptions({ strictMode: arg === 1 || arg === '1' })
        break
      case 'inlineMathEnabled':
        setRenderOptions({ inlineMath: arg === 1 || arg === '1' })
        break
      case 'subscriptEnabled':
        setRenderOptions({ subscript: arg === 1 || arg === '1' })
        break
      case 'superscriptEnabled':
        setRenderOptions({ superscript: arg === 1 || arg === '1' })
        break
      case 'highlightEnabled':
        setRenderOptions({ highlight: arg === 1 || arg === '1' })
        break
      case 'diagramsEnabled':
        setRenderOptions({ diagrams: arg === 1 || arg === '1' })
        break
      case 'codeLineNumbers':
        setRenderOptions({ codeLineNumbers: arg === 1 || arg === '1' })
        break
      case 'autoNumber':
        setRenderOptions({ autoNumber: arg === 1 || arg === '1' })
        break
      case 'headingStyle': {
        const style = typeof arg === 'string' ? arg : 'atx'
        if (style === 'atx' || style === 'setext' || style === 'hybrid') {
          setSerializationOptions({ headingStyle: style })
        }
        break
      }
      case 'unorderedMarker': {
        const marker = typeof arg === 'string' ? arg : '-'
        if (marker === '-' || marker === '*' || marker === '+') {
          setSerializationOptions({ unorderedMarker: marker })
        }
        break
      }
      case 'orderedMarker': {
        const marker = typeof arg === 'string' ? arg : '.'
        if (marker === '.' || marker === ')') setSerializationOptions({ orderedMarker: marker })
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
      case 'codeWrap':
        break
      case 'indentFirstLine':
      case 'finalNewline':
        break
      default:
        break
    }
  }

  private selectedOr(fallback: string): string {
    const range = this.view.state.selection.main
    const selected = this.view.state.sliceDoc(range.from, range.to)
    return selected === '' ? fallback : selected
  }

  private insertSnippet(text: string): void {
    const range = this.view.state.selection.main
    this.view.dispatch({
      changes: { from: range.from, to: range.to, insert: text },
      selection: EditorSelection.cursor(range.from + text.length)
    })
    this.view.focus()
  }

  private toggleWrap(prefix: string, suffix: string): void {
    const { state } = this.view
    const range = state.selection.main
    const before = state.sliceDoc(Math.max(0, range.from - prefix.length), range.from)
    const after = state.sliceDoc(range.to, Math.min(state.doc.length, range.to + suffix.length))
    if (before === prefix && after === suffix) {
      this.view.dispatch({
        changes: [
          { from: range.from - prefix.length, to: range.from, insert: '' },
          { from: range.to, to: range.to + suffix.length, insert: '' }
        ],
        selection: EditorSelection.range(range.from - prefix.length, range.to - prefix.length)
      })
      this.view.focus()
      return
    }
    const selected = state.sliceDoc(range.from, range.to)
    const text = prefix + selected + suffix
    this.view.dispatch({
      changes: { from: range.from, to: range.to, insert: text },
      selection:
        selected === ''
          ? EditorSelection.cursor(range.from + prefix.length)
          : EditorSelection.range(range.from, range.from + text.length)
    })
    this.view.focus()
  }

  private toggleInlineCode(): void {
    const { state } = this.view
    const range = state.selection.main
    const selected = state.sliceDoc(range.from, range.to)
    const fence = selected.includes('`') ? '``' : '`'
    this.toggleWrap(fence, fence)
  }

  private applyLink(arg?: string | number): void {
    const target = typeof arg === 'string' ? arg : ''
    const range = this.view.state.selection.main
    const selected = this.view.state.sliceDoc(range.from, range.to)
    const label = selected === '' ? 'link' : selected
    const text = '[' + label + '](' + target + ')'
    this.view.dispatch({
      changes: { from: range.from, to: range.to, insert: text },
      selection:
        selected === ''
          ? EditorSelection.range(range.from + 1, range.from + 1 + label.length)
          : EditorSelection.range(range.from, range.from + text.length)
    })
    this.view.focus()
  }

  private applyHeading(arg?: string | number): void {
    const { state } = this.view
    const range = state.selection.main
    const line = state.doc.lineAt(range.from)
    const current = HEADING_RE.exec(line.text)
    const requested =
      typeof arg === 'number'
        ? arg
        : typeof arg === 'string' && /^[1-6]$/.test(arg)
          ? Number(arg)
          : 0
    let level = requested
    if (level === 0) level = current ? (current[1].length >= 6 ? 0 : current[1].length + 1) : 1
    const body = line.text.replace(HEADING_RE, '')
    const insert = level === 0 ? body : '#'.repeat(level) + ' ' + body
    this.view.dispatch({
      changes: { from: line.from, to: line.to, insert },
      selection: EditorSelection.cursor(
        line.from + Math.min(insert.length, range.from - line.from + 0)
      )
    })
    this.view.focus()
  }

  private toggleLinePrefix(prefixes: string[], prefix: string): void {
    const { state } = this.view
    const range = state.selection.main
    const first = state.doc.lineAt(range.from).number
    const last = state.doc.lineAt(range.to).number
    const lines: Line[] = []
    for (let index = first; index <= last; index += 1) lines.push(state.doc.line(index))
    const allPrefixed = lines.every((line) =>
      prefixes.some((candidate) => line.text.startsWith(candidate))
    )
    const changes: ChangeSpec[] = []
    for (const line of lines) {
      const existing = prefixes.find((candidate) => line.text.startsWith(candidate))
      if (allPrefixed) {
        if (existing) changes.push({ from: line.from, to: line.from + existing.length, insert: '' })
      } else if (!existing) {
        changes.push({ from: line.from, insert: prefix })
      }
    }
    if (changes.length === 0) return
    this.view.dispatch({ changes })
    this.view.focus()
  }

  private wrapBlock(open: string, close: string): void {
    const { state } = this.view
    const range = state.selection.main
    const start = state.doc.lineAt(range.from)
    const end = state.doc.lineAt(range.to)
    const body = state.sliceDoc(start.from, end.to)
    const text = open + '\n' + body + '\n' + close
    this.view.dispatch({
      changes: { from: start.from, to: end.to, insert: text },
      selection: EditorSelection.range(
        start.from + open.length + 1,
        start.from + open.length + 1 + body.length
      )
    })
    this.view.focus()
  }

  private tableTemplate(arg?: string | number): string {
    let columns = 3
    let rows = 1
    if (typeof arg === 'number' && arg > 0) columns = Math.min(12, Math.floor(arg))
    if (typeof arg === 'string') {
      const match = /^(\d+)\s*[x*x]\s*(\d+)$/i.exec(arg.trim())
      if (match) {
        columns = Math.min(12, Math.max(1, Number(match[1])))
        rows = Math.min(50, Math.max(1, Number(match[2])))
      }
    }
    const header = '| ' + Array.from({ length: columns }, () => '').join(' | ') + ' |'
    const divider = '| ' + Array.from({ length: columns }, () => '---').join(' | ') + ' |'
    const body = Array.from(
      { length: rows },
      () => '| ' + Array.from({ length: columns }, () => '').join(' | ') + ' |'
    )
    return '\n' + [header, divider, ...body].join('\n') + '\n'
  }

  private placeCaret(position: number): void {
    this.view.dispatch({ selection: EditorSelection.cursor(position) })
    this.view.focus()
  }

  private extendTo(position: number): void {
    const range = this.view.state.selection.main
    this.view.dispatch({ selection: EditorSelection.range(range.anchor, position) })
    this.view.focus()
  }

  private stepSearch(delta: number): void {
    if (delta > 0) findNext(this.view)
    else findPrevious(this.view)
  }

  private shiftHeading(delta: number): void {
    const { state } = this.view
    const line = state.doc.lineAt(state.selection.main.head)
    const current = HEADING_RE.exec(line.text)
    const level = current ? current[1].length : 0
    const next = Math.max(0, Math.min(6, level + delta))
    if (next !== level) this.applyHeading(next)
  }

  private wordBounds(text: string, offset: number): { start: number; end: number } {
    const isWord = (char: string): boolean => /[\p{L}\p{N}_'-]/u.test(char)
    let start = offset
    let end = offset
    while (start > 0 && isWord(text[start - 1])) start -= 1
    while (end < text.length && isWord(text[end])) end += 1
    if (start === end && end < text.length) end += 1
    return { start, end }
  }

  private selectWord(): void {
    const { state } = this.view
    const range = state.selection.main
    if (!range.empty) return
    const line = state.doc.lineAt(range.head)
    const bounds = this.wordBounds(line.text, range.head - line.from)
    this.view.dispatch({
      selection: EditorSelection.range(line.from + bounds.start, line.from + bounds.end)
    })
    this.view.focus()
  }

  private selectSentence(remove: boolean): void {
    const { state } = this.view
    const range = state.selection.main
    const line = state.doc.lineAt(range.head)
    const offset = range.head - line.from
    let start = 0
    for (let index = offset - 1; index >= 0; index -= 1) {
      if (/[.!?。！？]/.test(line.text[index])) {
        start = index + 1
        break
      }
    }
    let end = line.text.length
    for (let index = offset; index < line.text.length; index += 1) {
      if (/[.!?。！？]/.test(line.text[index])) {
        end = index + 1
        break
      }
    }
    if (remove) {
      this.view.dispatch({ changes: { from: line.from + start, to: line.from + end, insert: '' } })
      this.view.focus()
      return
    }
    this.view.dispatch({ selection: EditorSelection.range(line.from + start, line.from + end) })
    this.view.focus()
  }

  private selectBlock(): void {
    const { state } = this.view
    const head = state.doc.lineAt(state.selection.main.head)
    let first = head.number
    let last = head.number
    while (first > 1 && state.doc.line(first - 1).text.trim() !== '') first -= 1
    while (last < state.doc.lines && state.doc.line(last + 1).text.trim() !== '') last += 1
    this.view.dispatch({
      selection: EditorSelection.range(state.doc.line(first).from, state.doc.line(last).to)
    })
    this.view.focus()
  }

  private selectPhrase(): void {
    const { state } = this.view
    const range = state.selection.main
    const line = state.doc.lineAt(range.head)
    const pairs: [string, string][] = [
      ['**', '**'],
      ['~~', '~~'],
      ['==', '=='],
      ['`', '`'],
      ['$', '$'],
      ['*', '*'],
      ['^', '^']
    ]
    for (const [open, close] of pairs) {
      const before = line.text.lastIndexOf(open, range.from - line.from - 1)
      const after = line.text.indexOf(close, range.to - line.from)
      if (before >= 0 && after >= 0) {
        this.view.dispatch({
          selection: EditorSelection.range(line.from + before + open.length, line.from + after)
        })
        this.view.focus()
        return
      }
    }
    this.selectWord()
  }

  private deleteScope(): void {
    this.selectPhrase()
    const range = this.view.state.selection.main
    if (range.empty) return
    this.view.dispatch({ changes: { from: range.from, to: range.to, insert: '' } })
    this.view.focus()
  }

  private deleteWord(): void {
    const { state } = this.view
    const range = state.selection.main
    const line = state.doc.lineAt(range.head)
    const bounds = this.wordBounds(line.text, range.head - line.from)
    this.view.dispatch({
      changes: { from: line.from + bounds.start, to: line.from + bounds.end, insert: '' }
    })
    this.view.focus()
  }

  private deleteBlock(): void {
    const { state } = this.view
    const head = state.doc.lineAt(state.selection.main.head)
    let first = head.number
    let last = head.number
    while (first > 1 && state.doc.line(first - 1).text.trim() !== '') first -= 1
    while (last < state.doc.lines && state.doc.line(last + 1).text.trim() !== '') last += 1
    const from = state.doc.line(first).from
    const to = Math.min(state.doc.line(last).to + 1, state.doc.length)
    this.view.dispatch({ changes: { from, to, insert: '' } })
    this.view.focus()
  }

  private clearFormat(): void {
    const { state } = this.view
    const range = state.selection.main
    const text = state.sliceDoc(range.from, range.to)
    this.view.dispatch({
      changes: { from: range.from, to: range.to, insert: text.replace(/[*_~`=^$]/g, '') }
    })
    this.view.focus()
  }

  private shiftIndent(outdent: boolean): void {
    const { state } = this.view
    const range = state.selection.main
    const first = state.doc.lineAt(range.from).number
    const last = state.doc.lineAt(range.to).number
    const changes: ChangeSpec[] = []
    for (let index = first; index <= last; index += 1) {
      const line = state.doc.line(index)
      if (line.text.trim() === '') continue
      if (outdent) {
        const match = /^ {1,2}/.exec(line.text)
        if (match) changes.push({ from: line.from, to: line.from + match[0].length, insert: '' })
      } else {
        changes.push({ from: line.from, insert: '  ' })
      }
    }
    if (changes.length > 0) this.view.dispatch({ changes })
    this.view.focus()
  }

  private applyTaskStatus(mode: 'toggle' | 'done' | 'todo'): void {
    const { state } = this.view
    const line = state.doc.lineAt(state.selection.main.head)
    const match = /^(\s*[-*+] )\[([ xX])\]/.exec(line.text)
    if (!match) {
      this.insertSnippet('- [ ] ')
      return
    }
    const checked = mode === 'toggle' ? match[2].toLowerCase() !== 'x' : mode === 'done'
    const from = line.from + match[1].length
    this.view.dispatch({ changes: { from, to: from + 3, insert: checked ? '[x]' : '[ ]' } })
    this.view.focus()
  }

  private applyAlert(type: string): void {
    const { state } = this.view
    const line = state.doc.lineAt(state.selection.main.head)
    const marker = '[!' + type.toUpperCase() + '] '
    if (/^>\s/.test(line.text)) {
      this.view.dispatch({ changes: { from: line.from + 2, insert: marker } })
    } else {
      this.view.dispatch({
        changes: { from: line.from, to: line.to, insert: '> ' + marker + line.text }
      })
    }
    this.view.focus()
  }

  private insertLinkReference(): void {
    const end = this.view.state.doc.length
    const text = (end > 0 ? '\n\n' : '') + '[1]: https://'
    this.view.dispatch({
      changes: { from: end, insert: text },
      selection: EditorSelection.cursor(end + text.length)
    })
    this.view.focus()
  }

  private insertFootnote(): void {
    const end = this.view.state.doc.length
    const head = this.view.state.selection.main.head
    this.view.dispatch({
      changes: [
        { from: head, insert: '[^1]' },
        { from: end, insert: (end > 0 ? '\n\n' : '') + '[^1]: footnote' }
      ]
    })
    this.view.focus()
  }

  private insertFrontMatter(): void {
    if (/^---\r?\n/.test(this.getValue())) {
      this.placeCaret(0)
      return
    }
    this.view.dispatch({ changes: { from: 0, insert: '---\ntitle: \n---\n\n' } })
    this.view.focus()
  }

  private insertParagraph(before: boolean): void {
    const { state } = this.view
    const line = state.doc.lineAt(state.selection.main.head)
    if (before) {
      this.view.dispatch({
        changes: { from: line.from, insert: '\n' },
        selection: EditorSelection.cursor(line.from)
      })
    } else {
      this.view.dispatch({
        changes: { from: line.to, insert: '\n' },
        selection: EditorSelection.cursor(line.to + 1)
      })
    }
    this.view.focus()
  }

  private imagePattern(): { src: string; from: number; to: number } | null {
    const { state } = this.view
    const line = state.doc.lineAt(state.selection.main.head)
    const markdown = /!\[[^\]]*\]\(([^)\s]+)/.exec(line.text)
    if (markdown) {
      const start = (markdown.index ?? 0) + markdown[0].length - markdown[1].length
      return {
        src: markdown[1],
        from: line.from + start,
        to: line.from + start + markdown[1].length
      }
    }
    const html = /<img[^>]*src="([^"]+)"/.exec(line.text)
    if (html) {
      const start = (html.index ?? 0) + html[0].length - html[1].length - 1
      return { src: html[1], from: line.from + start, to: line.from + start + html[1].length }
    }
    return null
  }

  private zoomImage(percent: number): void {
    const image = this.imagePattern()
    if (!image) return
    const value = Number.isFinite(percent) && percent > 0 ? percent : 100
    const { state } = this.view
    const line = state.doc.lineAt(state.selection.main.head)
    const replacement = '<img src="' + image.src + '" style="width:' + value + '%">'
    this.view.dispatch({ changes: { from: line.from, to: line.to, insert: replacement } })
    this.view.focus()
  }

  private async copyImage(): Promise<void> {
    const image = this.imagePattern()
    if (!image) return
    if (!(await copyImageBytes(image.src))) await copyText(image.src)
  }

  private async copyHtml(): Promise<void> {
    const text = this.selectedOr('')
    await copyPayload({ plain: text, html: renderMarkdown(text) })
  }

  private async copySemantic(): Promise<void> {
    const text = this.selectedOr('')
    await copyPayload({ plain: text, html: renderMarkdown(text) })
  }

  private async pastePlain(): Promise<void> {
    const text = await readClipboardText()
    if (text === '') return
    this.insertSnippet(text)
  }

  private async linkAction(openIt: boolean): Promise<void> {
    const { state } = this.view
    const line = state.doc.lineAt(state.selection.main.head)
    const match = /\]\(([^)\s]+)/.exec(line.text)
    if (!match) return
    if (openIt) window.open(match[1], '_blank', 'noopener')
    else await copyText(match[1])
  }

  private tableBlock(): { from: number; to: number; rows: string[][] } | null {
    const { state } = this.view
    const head = state.doc.lineAt(state.selection.main.head)
    if (!/^\s*\|/.test(head.text)) return null
    let first = head.number
    let last = head.number
    while (first > 1 && /^\s*\|/.test(state.doc.line(first - 1).text)) first -= 1
    while (last < state.doc.lines && /^\s*\|/.test(state.doc.line(last + 1).text)) last += 1
    const rows: string[][] = []
    for (let index = first; index <= last; index += 1) {
      const text = state.doc.line(index).text.trim().replace(/^\|/, '').replace(/\|$/, '')
      rows.push(text.split('|').map((cell) => cell.trim()))
    }
    return { from: state.doc.line(first).from, to: state.doc.line(last).to, rows }
  }

  private writeTable(from: number, to: number, rows: string[][]): void {
    const text = rows.map((cells) => '| ' + cells.join(' | ') + ' |').join('\n')
    this.view.dispatch({ changes: { from, to, insert: text } })
    this.view.focus()
  }

  private tableInsertRow(above: boolean): void {
    const table = this.tableBlock()
    if (!table) return
    const { state } = this.view
    const offset =
      state.doc.lineAt(state.selection.main.head).number - state.doc.lineAt(table.from).number
    const index = above ? Math.max(1, offset) : offset + 1
    const width = table.rows[0]?.length ?? 1
    table.rows.splice(
      index,
      0,
      Array.from({ length: width }, () => '')
    )
    this.writeTable(table.from, table.to, table.rows)
  }

  private tableCellIndex(): number {
    const { state } = this.view
    const range = state.selection.main
    const line = state.doc.lineAt(range.head)
    return Math.max(0, (line.text.slice(0, range.head - line.from).match(/\|/g) ?? []).length - 1)
  }

  private tableInsertColumn(before: boolean): void {
    const table = this.tableBlock()
    if (!table) return
    const index = this.tableCellIndex() + (before ? 0 : 1)
    for (const row of table.rows) row.splice(Math.min(index, row.length), 0, '')
    this.writeTable(table.from, table.to, table.rows)
  }

  private tableDeleteRow(): void {
    const table = this.tableBlock()
    if (!table) return
    const { state } = this.view
    const offset =
      state.doc.lineAt(state.selection.main.head).number - state.doc.lineAt(table.from).number
    if (table.rows.length <= 2) {
      this.tableDeleteTable()
      return
    }
    table.rows.splice(offset <= 1 ? Math.min(2, table.rows.length - 1) : offset, 1)
    this.writeTable(table.from, table.to, table.rows)
  }

  private tableDeleteColumn(): void {
    const table = this.tableBlock()
    if (!table) return
    if ((table.rows[0]?.length ?? 0) <= 1) {
      this.tableDeleteTable()
      return
    }
    const index = this.tableCellIndex()
    for (const row of table.rows) row.splice(Math.min(index, row.length - 1), 1)
    this.writeTable(table.from, table.to, table.rows)
  }

  private tableDeleteTable(): void {
    const table = this.tableBlock()
    if (!table) return
    const to = Math.min(table.to + 2, this.view.state.doc.length)
    this.view.dispatch({ changes: { from: table.from, to, insert: '' } })
    this.view.focus()
  }

  private tableFormat(): void {
    const table = this.tableBlock()
    if (!table) return
    const columns = Math.max(...table.rows.map((row) => row.length))
    for (const row of table.rows) {
      while (row.length < columns) row.push('')
    }
    const widths = Array.from({ length: columns }, (_value, index) =>
      Math.max(3, ...table.rows.map((row) => row[index].length))
    )
    const lines = table.rows.map((row, rowIndex) => {
      if (rowIndex === 1) return '| ' + widths.map((width) => '-'.repeat(width)).join(' | ') + ' |'
      return (
        '| ' +
        row.map((cell, index) => cell + ' '.repeat(widths[index] - cell.length)).join(' | ') +
        ' |'
      )
    })
    this.view.dispatch({ changes: { from: table.from, to: table.to, insert: lines.join('\n') } })
    this.view.focus()
  }

  private async tableCopy(): Promise<void> {
    const table = this.tableBlock()
    if (!table) return
    await copyText(this.view.state.sliceDoc(table.from, table.to))
  }

  private fenceRange(): {
    from: number
    to: number
    bodyFrom: number
    bodyTo: number
    body: string
  } | null {
    const { state } = this.view
    const caretLine = state.doc.lineAt(state.selection.main.head).number
    let open = -1
    for (let index = caretLine; index >= 1; index -= 1) {
      if (/^\s*(`{3,}|~{3,})/.test(state.doc.line(index).text)) {
        open = index
        break
      }
    }
    if (open < 1) return null
    let close = open + 1
    while (close <= state.doc.lines && !/^\s*(`{3,}|~{3,})\s*$/.test(state.doc.line(close).text))
      close += 1
    if (close > state.doc.lines || close < caretLine) return null
    const openLine = state.doc.line(open)
    const closeLine = state.doc.line(close)
    const bodyFrom = openLine.to + 1
    const bodyTo = Math.max(bodyFrom, closeLine.from)
    return {
      from: openLine.from,
      to: closeLine.to,
      bodyFrom,
      bodyTo,
      body: state.sliceDoc(bodyFrom, bodyTo)
    }
  }

  private async codeCopy(): Promise<void> {
    const fence = this.fenceRange()
    if (!fence) return
    await copyText(fence.body)
  }

  private codeIndent(): void {
    const fence = this.fenceRange()
    if (!fence) return
    const lines = fence.body.split('\n')
    const widths = lines
      .filter((line) => line.trim() !== '')
      .map((line) => (line.match(/^ +/) ?? [''])[0].length)
    const smallest = widths.length > 0 ? Math.min(...widths) : 0
    const next = smallest >= 16 ? 0 : smallest + 4
    const body = lines
      .map((line) => {
        if (line.trim() === '') return line
        const stripped = line.slice(smallest)
        return next > 0 ? ' '.repeat(next) + stripped : stripped
      })
      .join('\n')
    this.view.dispatch({ changes: { from: fence.bodyFrom, to: fence.bodyTo, insert: body } })
    this.view.focus()
  }

  private replaceAll(arg?: string | number): void {
    const spec = typeof arg === 'string' ? arg : ''
    const separator = spec.indexOf('\u0000')
    if (separator <= 0) {
      openSearchPanel(this.view)
      return
    }
    const query = spec.slice(0, separator)
    const replacement = spec.slice(separator + 1)
    const source = this.getValue()
    const pattern = new RegExp(escapeRegExp(query), 'gi')
    const next = source.replace(pattern, () => replacement)
    if (next === source) return
    this.setValue(next)
    this.options.onChange(next)
  }
}
