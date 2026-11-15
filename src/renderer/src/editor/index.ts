import 'katex/dist/katex.min.css'
import './editor.css'

import { countText } from './stats'
import { extractOutline } from './outline'
import { SourceEngine } from './source-mode'
import { WysiwygEngine } from './wysiwyg'

export interface OutlineItem {
  level: number
  text: string
  line: number
}

export interface EditorOptions {
  value: string
  sourceCodeMode: boolean
  focusMode: boolean
  typewriterMode: boolean
  wordWrap: boolean
  onChange: (value: string) => void
  onOutline: (items: OutlineItem[]) => void
  onCount: (words: number, chars: number, nonSpaceChars: number) => void
}

export type EditorCommand =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'underline'
  | 'link'
  | 'image'
  | 'heading'
  | 'quote'
  | 'ul'
  | 'ol'
  | 'task'
  | 'codefence'
  | 'math'
  | 'hr'
  | 'table'
  | 'undo'
  | 'redo'
  | 'find'
  | 'replaceAll'
  | 'paragraph'
  | 'headingUp'
  | 'headingDown'
  | 'tableRowAbove'
  | 'tableRowBelow'
  | 'tableColBefore'
  | 'tableColAfter'
  | 'tableDeleteRow'
  | 'tableDeleteCol'
  | 'tableDelete'
  | 'tableFormat'
  | 'tableCopy'
  | 'codeCopy'
  | 'codeIndent'
  | 'indent'
  | 'outdent'
  | 'taskToggle'
  | 'taskDone'
  | 'taskTodo'
  | 'alert'
  | 'linkReference'
  | 'footnote'
  | 'toc'
  | 'frontMatter'
  | 'insertBefore'
  | 'insertAfter'
  | 'inlineMath'
  | 'highlight'
  | 'superscript'
  | 'subscript'
  | 'comment'
  | 'clearFormat'
  | 'zoomImage'
  | 'selectAll'
  | 'selectBlock'
  | 'selectLine'
  | 'selectPhrase'
  | 'selectWord'
  | 'jumpTop'
  | 'jumpBottom'
  | 'jumpSelection'
  | 'jumpLineStart'
  | 'jumpLineEnd'
  | 'extendTop'
  | 'extendBottom'
  | 'extendLineStart'
  | 'extendLineEnd'
  | 'deleteBlock'
  | 'deleteLine'
  | 'deleteScope'
  | 'deleteWord'
  | 'copyPlain'
  | 'copyMarkdown'
  | 'copyHtml'
  | 'copySemantic'
  | 'copyImage'
  | 'pastePlain'
  | 'findNext'
  | 'findPrevious'
  | 'replace'
  | 'openLink'
  | 'copyLink'
  | 'readonly'
  | 'spellcheck'
  | 'showBr'
  | 'remapPunctuation'
  | 'strictMode'
  | 'inlineMathEnabled'
  | 'subscriptEnabled'
  | 'superscriptEnabled'
  | 'highlightEnabled'
  | 'diagramsEnabled'
  | 'codeLineNumbers'
  | 'codeWrap'
  | 'autoNumber'
  | 'headingStyle'
  | 'unorderedMarker'
  | 'orderedMarker'
  | 'autoPairBracket'
  | 'autoPairMarkdown'
  | 'autoCorrect'
  | 'moveBlockUp'
  | 'moveBlockDown'
  | 'refreshMath'
  | 'preserveLineBreak'
  | 'indentFirstLine'
  | 'smartPunctuation'
  | 'finalNewline'

export interface EditorHandle {
  getValue(): string
  setValue(value: string): void
  focus(): void
  setOptions(
    patch: Partial<
      Pick<EditorOptions, 'sourceCodeMode' | 'focusMode' | 'typewriterMode' | 'wordWrap'>
    >
  ): void
  exec(command: EditorCommand, arg?: string | number): void
  destroy(): void
}

class EditorSession implements EditorHandle {
  private readonly host: HTMLElement
  private readonly options: EditorOptions
  private readonly writeRoot: HTMLElement
  private readonly sourceRoot: HTMLElement
  private wysiwyg: WysiwygEngine | null = null
  private source: SourceEngine | null = null
  private value: string
  private outlineKey = ''
  private countKey = ''
  private destroyed = false

  constructor(host: HTMLElement, options: EditorOptions) {
    this.host = host
    this.options = { ...options }
    this.value = options.value

    host.classList.add('typora-editor-host')
    host.replaceChildren()

    this.writeRoot = document.createElement('div')
    this.writeRoot.id = 'write'
    this.writeRoot.className = 'typora-article'
    this.writeRoot.setAttribute('contenteditable', 'true')
    this.writeRoot.setAttribute('spellcheck', 'false')
    this.writeRoot.setAttribute('role', 'textbox')
    this.writeRoot.setAttribute('aria-multiline', 'true')
    this.writeRoot.setAttribute('aria-placeholder', 'Start writing...')
    this.writeRoot.setAttribute('tabindex', '-1')

    this.sourceRoot = document.createElement('div')
    this.sourceRoot.id = 'typora-source'
    this.sourceRoot.className = 'typora-source'
    this.sourceRoot.hidden = true

    host.append(this.writeRoot, this.sourceRoot)
    this.applyMode()
    this.emitDocumentMeta()
  }

  getValue(): string {
    if (!this.options.sourceCodeMode) this.wysiwyg?.flush()
    return this.value
  }

  setValue(value: string): void {
    if (value === this.value) return
    this.value = value
    if (this.options.sourceCodeMode) this.source?.setValue(value)
    else this.renderWysiwyg(value)
    this.emitDocumentMeta()
  }

  focus(): void {
    if (this.options.sourceCodeMode) this.source?.focus()
    else this.wysiwyg?.focus()
  }

  setOptions(
    patch: Partial<
      Pick<EditorOptions, 'sourceCodeMode' | 'focusMode' | 'typewriterMode' | 'wordWrap'>
    >
  ): void {
    const previousSourceMode = this.options.sourceCodeMode
    const previousFocusMode = this.options.focusMode
    Object.assign(this.options, patch)
    if (this.options.sourceCodeMode !== previousSourceMode) {
      this.applyMode()
      return
    }
    if (this.options.sourceCodeMode) {
      if (this.options.focusMode !== previousFocusMode)
        this.source?.setFocusMode(this.options.focusMode)
      if (patch.wordWrap !== undefined) this.source?.setWordWrap(this.options.wordWrap)
      return
    }
    this.writeRoot.classList.toggle('on-focus-mode', this.options.focusMode)
  }

  exec(command: EditorCommand, arg?: string | number): void {
    const enabled = arg === 1 || arg === '1'
    // presentation switches that belong to the article root, independent of the engine
    if (command === 'showBr') this.writeRoot.classList.toggle('show-br', enabled)
    if (command === 'indentFirstLine') this.writeRoot.classList.toggle('indent-first-line', enabled)
    if (command === 'codeWrap') this.writeRoot.classList.toggle('code-wrap', enabled)
    if (this.options.sourceCodeMode) this.source?.exec(command, arg)
    else this.wysiwyg?.exec(command, arg)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.wysiwyg?.destroy()
    this.source?.destroy()
    this.wysiwyg = null
    this.source = null
    this.writeRoot.remove()
    this.sourceRoot.remove()
  }

  private applyMode(): void {
    const sourceMode = this.options.sourceCodeMode
    const wasFocused = this.host.contains(document.activeElement)
    this.wysiwyg?.flush()
    this.writeRoot.hidden = sourceMode
    this.sourceRoot.hidden = !sourceMode
    this.writeRoot.classList.toggle('on-focus-mode', this.options.focusMode)
    this.host.dataset.mode = sourceMode ? 'source' : 'wysiwyg'

    if (sourceMode) {
      if (this.source) {
        this.source.setValue(this.value)
      } else {
        this.source = new SourceEngine({
          parent: this.sourceRoot,
          value: this.value,
          wordWrap: this.options.wordWrap,
          isTypewriter: (): boolean => this.options.typewriterMode,
          onChange: (markdown: string): void => this.handleUserEdit(markdown)
        })
      }
      this.source.setFocusMode(this.options.focusMode)
      this.source.setWordWrap(this.options.wordWrap)
    } else if (this.wysiwyg) {
      this.renderWysiwyg(this.value)
    } else {
      this.wysiwyg = new WysiwygEngine({
        root: this.writeRoot,
        commit: (markdown: string): void => this.handleUserEdit(markdown),
        isTypewriter: (): boolean => this.options.typewriterMode
      })
      this.renderWysiwyg(this.value)
    }

    if (wasFocused) this.focus()
  }

  private renderWysiwyg(markdown: string): void {
    if (!this.wysiwyg) return
    this.wysiwyg.render(markdown)
    this.wysiwyg.resetHistory(markdown)
  }

  private handleUserEdit(markdown: string): void {
    if (this.destroyed) return
    if (markdown === this.value) return
    this.value = markdown
    this.emitDocumentMeta()
    this.options.onChange(markdown)
  }

  private emitDocumentMeta(): void {
    const outline = extractOutline(this.value)
    const outlineKey = JSON.stringify(outline)
    if (outlineKey !== this.outlineKey) {
      this.outlineKey = outlineKey
      this.options.onOutline(outline)
    }
    const count = countText(this.value)
    const countKey = count.words + ':' + count.chars + ':' + count.nonSpaceChars
    if (countKey !== this.countKey) {
      this.countKey = countKey
      this.options.onCount(count.words, count.chars, count.nonSpaceChars)
    }
  }
}

/**
 * Mounts the Typora-compatible editor into `host` and returns the handle the shell
 * drives it with.
 */
export function createEditor(host: HTMLElement, options: EditorOptions): EditorHandle {
  return new EditorSession(host, options)
}
