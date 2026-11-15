import { selectRange } from './dom-selection'

export interface FindBarHandlers {
  root: HTMLElement
  /** serialises the edited DOM and records one undo step */
  commit: () => void
}

export interface FindBar {
  open: (options?: { replace?: boolean; query?: string }) => void
  close: () => void
  next: () => void
  previous: () => void
  replaceAll: () => void
  destroy: () => void
}

interface TextSpan {
  node: Text
  start: number
}

interface Match {
  start: number
  end: number
}

function buildTextMap(root: Element): { text: string; spans: TextSpan[] } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    // editor chrome (the fence language pill) is not document text
    acceptNode: (node: Node): number => {
      const parent = node.parentElement
      if (parent !== null && parent.closest('.md-tooltip-remove') !== null) {
        return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    }
  })
  const spans: TextSpan[] = []
  let text = ''
  let node = walker.nextNode()
  while (node) {
    spans.push({ node: node as Text, start: text.length })
    text += node.nodeValue ?? ''
    node = walker.nextNode()
  }
  return { text, spans }
}

function locate(spans: TextSpan[], offset: number): { node: Text; offset: number } | null {
  let found: TextSpan | null = null
  for (const span of spans) {
    if (span.start > offset) break
    found = span
  }
  if (!found) return null
  return { node: found.node, offset: offset - found.start }
}

function findMatches(text: string, query: string): Match[] {
  if (query === '') return []
  const haystack = text.toLowerCase()
  const needle = query.toLowerCase()
  const matches: Match[] = []
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    matches.push({ start: index, end: index + needle.length })
    index = haystack.indexOf(needle, index + needle.length)
  }
  return matches
}

function rangeOf(spans: TextSpan[], match: Match): Range | null {
  const from = locate(spans, match.start)
  const last = locate(spans, Math.max(match.start, match.end - 1))
  if (!from || !last) return null
  const length = (last.node.nodeValue ?? '').length
  const range = document.createRange()
  range.setStart(from.node, Math.min(from.offset, (from.node.nodeValue ?? '').length))
  range.setEnd(last.node, Math.min(last.offset + 1, length))
  return range
}

/** Kept for engines without the Custom Highlight API (see paint()). */
function selectMatch(spans: TextSpan[], match: Match): void {
  const range = rangeOf(spans, match)
  if (range !== null) selectRange(range)
}

interface HighlightRegistry {
  set: (name: string, highlight: unknown) => void
  delete: (name: string) => boolean
}

const HIGHLIGHT_ALL = 'typora-find'
const HIGHLIGHT_CURRENT = 'typora-find-current'
const MAX_HIGHLIGHT_MATCHES = 2000

function highlightRegistry(): HighlightRegistry | null {
  const registry = (CSS as unknown as { highlights?: HighlightRegistry }).highlights
  return registry === undefined ? null : registry
}

function createHighlight(ranges: Range[]): unknown | null {
  const ctor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
  if (ctor === undefined) return null
  return new ctor(...ranges)
}

/** Rewrites the visible text only, so link targets and fence info strings stay intact. */
function replaceInSpans(spans: TextSpan[], needle: string, replacement: string): number {
  const lower = needle.toLowerCase()
  if (lower === '') return 0
  let changed = 0
  for (const span of spans) {
    const value = span.node.nodeValue ?? ''
    const haystack = value.toLowerCase()
    let out = ''
    let cursor = 0
    let index = haystack.indexOf(lower)
    while (index !== -1) {
      out += value.slice(cursor, index) + replacement
      cursor = index + needle.length
      changed += 1
      index = haystack.indexOf(lower, cursor)
    }
    if (cursor === 0) continue
    span.node.nodeValue = out + value.slice(cursor)
  }
  return changed
}

function createButton(label: string, title: string, action: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'typora-find-button'
  button.textContent = label
  button.title = title
  button.dataset.action = action
  return button
}

/**
 * Typora-style find/replace chrome for the WYSIWYG surface. Matches are located on
 * the rendered text nodes; replace-all rewrites those text nodes and commits once.
 *
 * Selecting a match puts the document selection inside `#write`, which makes Chromium
 * hand focus to the contenteditable. Every path that selects therefore re-focuses the
 * originating field, otherwise the next keystroke lands in the document.
 */
export function createFindBar(handlers: FindBarHandlers): FindBar {
  const bar = document.createElement('div')
  bar.className = 'typora-find-bar'
  bar.hidden = true

  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'typora-find-input'
  input.placeholder = 'Find'
  const replaceInput = document.createElement('input')
  replaceInput.type = 'text'
  replaceInput.className = 'typora-find-replace'
  replaceInput.placeholder = 'Replace'
  const counter = document.createElement('span')
  counter.className = 'typora-find-counter'

  bar.append(
    input,
    counter,
    createButton('\u2191', 'Previous match', 'prev'),
    createButton('\u2193', 'Next match', 'next'),
    replaceInput,
    createButton('All', 'Replace all', 'replace-all'),
    createButton('\u00d7', 'Close', 'close')
  )

  let index = -1
  /** true while the last interaction happened inside the bar (see the document mousedown hook) */
  let barHasFocus = false

  const refocus = (element: HTMLInputElement): void => {
    const start = element.selectionStart ?? element.value.length
    const end = element.selectionEnd ?? start
    // a selection inside the contenteditable keeps document.activeElement on the field but
    // hands the editing pipeline to the editor; only a fresh focus (blur first) takes it back
    if (document.activeElement === element) element.blur()
    element.focus({ preventScroll: true })
    element.setSelectionRange(start, end)
  }

  /**
   * Selecting a match inside the contenteditable makes Chromium hand focus to it - partially
   * on a queued task, i.e. after this handler returns. So the field is re-focused now and
   * once more on the next task/frame, unless the user has since moved into the document.
   */
  const restoreFocus = (element: HTMLInputElement): void => {
    if (document.activeElement !== element) refocus(element)
    const again = (): void => {
      if (!barHasFocus || document.activeElement === element) return
      refocus(element)
    }
    window.setTimeout(again, 0)
    window.requestAnimationFrame(again)
  }

  /**
   * Matches are painted with the Custom Highlight API. Putting a *selection* inside the
   * contenteditable instead would hand the editing pipeline to the editor: the field keeps
   * document.activeElement but every following keystroke is swallowed (measured: typing
   * with no match reaches the field, typing right after a match selection stops after one
   * character, and a real re-click repairs it). Painting leaves the field's pipeline alone.
   */
  const paint = (spans: TextSpan[], matches: Match[], current: number): boolean => {
    const registry = highlightRegistry()
    if (registry === null) return false
    const ranges: Range[] = []
    const currentRanges: Range[] = []
    for (
      let position = 0;
      position < matches.length && position < MAX_HIGHLIGHT_MATCHES;
      position += 1
    ) {
      const range = rangeOf(spans, matches[position])
      if (range === null) continue
      ranges.push(range)
      if (position === current) currentRanges.push(range.cloneRange())
    }
    const all = createHighlight(ranges)
    const active = createHighlight(currentRanges)
    if (all === null || active === null) return false
    registry.set(HIGHLIGHT_ALL, all)
    registry.set(HIGHLIGHT_CURRENT, active)
    return true
  }

  const clearPaint = (): void => {
    const registry = highlightRegistry()
    if (registry === null) return
    registry.delete(HIGHLIGHT_ALL)
    registry.delete(HIGHLIGHT_CURRENT)
  }

  const refresh = (restore?: HTMLInputElement): Match[] => {
    const { text, spans } = buildTextMap(handlers.root)
    const matches = findMatches(text, input.value)
    if (matches.length === 0) {
      index = -1
      counter.textContent = input.value === '' ? '' : '0/0'
      clearPaint()
      if (restore !== undefined) restoreFocus(restore)
      return matches
    }
    if (index < 0 || index >= matches.length) index = 0
    if (!paint(spans, matches, index)) {
      selectMatch(spans, matches[index])
      if (restore !== undefined) restoreFocus(restore)
    }
    counter.textContent = index + 1 + '/' + matches.length
    return matches
  }

  const step = (delta: number, restore?: HTMLInputElement): void => {
    const { text, spans } = buildTextMap(handlers.root)
    const matches = findMatches(text, input.value)
    if (matches.length === 0) {
      index = -1
      counter.textContent = input.value === '' ? '' : '0/0'
      clearPaint()
      if (restore !== undefined) restoreFocus(restore)
      return
    }
    index = (index + delta + matches.length) % matches.length
    if (!paint(spans, matches, index)) {
      selectMatch(spans, matches[index])
      if (restore !== undefined) restoreFocus(restore)
    }
    counter.textContent = index + 1 + '/' + matches.length
  }

  const replaceAll = (): void => {
    const query = input.value
    if (query === '') return
    const { spans } = buildTextMap(handlers.root)
    const changed = replaceInSpans(spans, query, replaceInput.value)
    if (changed === 0) {
      counter.textContent = '0/0'
      restoreFocus(input)
      return
    }
    handlers.commit()
    index = -1
    refresh(input)
    restoreFocus(input)
  }

  const close = (): void => {
    bar.hidden = true
    barHasFocus = false
    clearPaint()
    handlers.root.focus()
  }

  const onDocumentMouseDown = (event: MouseEvent): void => {
    const target = event.target
    barHasFocus = target instanceof Node && bar.contains(target)
  }
  document.addEventListener('mousedown', onDocumentMouseDown, true)

  bar.addEventListener('click', (event: MouseEvent): void => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const action = target.dataset.action
    if (action === 'next') step(1, input)
    else if (action === 'prev') step(-1, input)
    else if (action === 'replace-all') replaceAll()
    else if (action === 'close') close()
  })

  input.addEventListener('input', (): void => {
    index = -1
    refresh(input)
  })

  bar.addEventListener('keydown', (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      step(event.shiftKey ? -1 : 1, input)
    }
  })

  document.body.appendChild(bar)

  return {
    open: (options): void => {
      bar.hidden = false
      if (options?.query !== undefined) input.value = options.query
      replaceInput.hidden = options?.replace !== true
      index = -1
      barHasFocus = true
      input.focus()
      input.select()
      refresh(input)
    },
    close,
    next: (): void => step(1),
    previous: (): void => step(-1),
    replaceAll,
    destroy: (): void => {
      document.removeEventListener('mousedown', onDocumentMouseDown, true)
      bar.remove()
    }
  }
}
