import { ALERT_TYPES } from './md-extensions'

const BLOCK_SEPARATOR = '\n\n'

let preserveLineBreakEnabled = false
let smartPunctuationEnabled = true

export interface SerializationOptions {
  /** mirrors HeadingStyle in shared/types.ts */
  headingStyle: 'atx' | 'setext' | 'hybrid'
  unorderedMarker: '-' | '*' | '+'
  orderedMarker: '.' | ')'
}

const serialization: SerializationOptions = {
  headingStyle: 'atx',
  unorderedMarker: '-',
  orderedMarker: '.'
}

export function setSerializationOptions(patch: Partial<SerializationOptions>): boolean {
  let changed = false
  if (patch.headingStyle !== undefined && patch.headingStyle !== serialization.headingStyle) {
    serialization.headingStyle = patch.headingStyle
    changed = true
  }
  if (
    patch.unorderedMarker !== undefined &&
    patch.unorderedMarker !== serialization.unorderedMarker
  ) {
    serialization.unorderedMarker = patch.unorderedMarker
    changed = true
  }
  if (patch.orderedMarker !== undefined && patch.orderedMarker !== serialization.orderedMarker) {
    serialization.orderedMarker = patch.orderedMarker
    changed = true
  }
  return changed
}

export function currentSerializationOptions(): SerializationOptions {
  return serialization
}

/** Typographic characters that the renderer produced must not leak into the source. */
const SMART_REVERSE: [RegExp, string][] = [
  [/[\u201C\u201D\u201E]/g, '"'],
  [/[\u2018\u2019\u201A]/g, "'"],
  [/\u2014/g, '---'],
  [/\u2013/g, '--'],
  [/\u2026/g, '...']
]

export function setSmartPunctuation(enabled: boolean): boolean {
  if (enabled === smartPunctuationEnabled) return false
  smartPunctuationEnabled = enabled
  return true
}

function reverseSmartPunctuation(text: string): string {
  let output = text
  for (const [pattern, replacement] of SMART_REVERSE) output = output.replace(pattern, replacement)
  return output
}

/**
 * With "preserve single line break" on, a soft break is written back as a Markdown hard
 * break (`  \n`) so it survives the round-trip; otherwise it stays a plain newline.
 */
export function setPreserveLineBreak(enabled: boolean): boolean {
  if (enabled === preserveLineBreakEnabled) return false
  preserveLineBreakEnabled = enabled
  return true
}
const HEADING_TAG_RE = /^H([1-6])$/

interface ListMarker {
  ordered: boolean
  index: number
}

function isElement(node: Node): node is HTMLElement {
  return node.nodeType === Node.ELEMENT_NODE
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeText(input: string): string {
  const text = smartPunctuationEnabled ? reverseSmartPunctuation(input) : input
  return text
    .split('\\')
    .join('\\\\')
    .split('`')
    .join('\\`')
    .replace(/[*_~[\]$<&]/g, '\\$&')
}

function serializeCellText(cell: Element): string {
  const parts: string[] = []
  for (const child of Array.from(cell.childNodes)) {
    if (isElement(child) && child.tagName === 'BR') {
      parts.push('\n')
      continue
    }
    parts.push(serializeInlineNode(child))
  }
  const text = parts.join('').trim()
  if (text === '') return ''
  return text.replace(/\|/g, '\\|').replace(/\n/g, '<br>')
}

function serializeInlineCode(text: string): string {
  const runs = text.match(/`+/g) ?? []
  const longest = runs.reduce((length, run) => Math.max(length, run.length), 0)
  const fence = '`'.repeat(longest + 1)
  const needsPadding = /^[` ]|[ `]$/.test(text)
  return fence + (needsPadding ? ' ' + text + ' ' : text) + fence
}

function serializeInlineNodes(nodes: ArrayLike<Node>): string {
  let out = ''
  for (const node of Array.from(nodes)) out += serializeInlineNode(node)
  return out
}

function serializeChildren(element: HTMLElement): string {
  return serializeInlineNodes(element.childNodes)
}

function serializeInlineNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeText(node.nodeValue ?? '')
  if (!isElement(node)) return ''
  const element = node
  // chrome that must never become Markdown (the fence language pill, for one)
  if (element.classList.contains('md-tooltip-remove')) return ''
  switch (element.tagName) {
    case 'STRONG':
    case 'B': {
      const inner = serializeChildren(element)
      return inner.trim() === '' ? inner : '**' + inner + '**'
    }
    case 'EM':
    case 'I': {
      const inner = serializeChildren(element)
      return inner.trim() === '' ? inner : '*' + inner + '*'
    }
    case 'DEL':
    case 'S':
    case 'STRIKE': {
      const inner = serializeChildren(element)
      return inner.trim() === '' ? inner : '~~' + inner + '~~'
    }
    case 'U':
      return '<u>' + serializeChildren(element) + '</u>'
    case 'MARK': {
      const inner = serializeChildren(element)
      return inner.trim() === '' ? inner : '==' + inner + '=='
    }
    case 'SUP': {
      if (element.classList.contains('md-footnote')) {
        return '[^' + (element.textContent ?? '').trim() + ']'
      }
      const marked = serializeChildren(element)
      return marked.trim() === '' ? marked : '^' + marked + '^'
    }
    case 'SUB': {
      const inner = serializeChildren(element)
      return inner.trim() === '' ? inner : '~' + inner + '~'
    }
    case 'CODE':
      return serializeInlineCode(extractPreText(element, false))
    case 'A': {
      const href = element.getAttribute('href') ?? ''
      const title = element.getAttribute('title')
      const label = serializeChildren(element) || escapeText(href)
      const target = /[\s()<>]/.test(href) ? '<' + href + '>' : href
      return '[' + label + '](' + target + (title ? ' "' + title + '"' : '') + ')'
    }
    case 'IMG': {
      const src = element.getAttribute('src') ?? ''
      const alt = element.getAttribute('alt') ?? ''
      const title = element.getAttribute('title')
      const width = element.style.width || element.getAttribute('width')
      if (width) {
        // a sized image can only survive the round-trip as inline HTML, like Typora does
        return (
          '<img src="' +
          escapeAttribute(src) +
          '" alt="' +
          escapeAttribute(alt) +
          '" style="width:' +
          escapeAttribute(width) +
          '">'
        )
      }
      const target = /[\s()<>]/.test(src) ? '<' + src + '>' : src
      return '![' + escapeText(alt) + '](' + target + (title ? ' "' + title + '"' : '') + ')'
    }
    case 'SPAN': {
      if (element.classList.contains('md-inline-math')) {
        return '$' + (element.getAttribute('data-math') ?? '') + '$'
      }
      if (element.classList.contains('md-comment')) {
        return '<!--' + (element.textContent ?? '') + '-->'
      }
      return serializeChildren(element)
    }
    case 'BR': {
      if (!element.classList.contains('md-softbreak')) return '  \n'
      return preserveLineBreakEnabled ? '  \n' : '\n'
    }
    case 'INPUT':
      return ''
    case 'SCRIPT':
    case 'STYLE':
      return ''
    case 'DIV':
    case 'P':
      return '\n' + serializeChildren(element)
    default:
      return serializeChildren(element)
  }
}

/**
 * Reads the literal text of a `pre` block, turning the `<br>`/`<div>` lines the
 * browser produces inside a contenteditable into newlines.
 */
function extractPreText(element: Element, stripTrailingNewline: boolean): string {
  const target: Element = element.querySelector(':scope > code') ?? element
  // an empty fence carries one <br> so the caret has somewhere to sit; it is not content
  const only = target.firstChild
  if (target.childNodes.length === 1 && only !== null && isElement(only) && only.tagName === 'BR') {
    return ''
  }
  let text = ''
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.nodeValue ?? ''
      return
    }
    if (!isElement(node)) return
    if (node.tagName === 'BR') {
      text += '\n'
      return
    }
    const isLineBreak = node.tagName === 'DIV' || node.tagName === 'P'
    if (isLineBreak) text += '\n'
    for (const child of Array.from(node.childNodes)) walk(child)
  }
  walk(target)
  return stripTrailingNewline ? text.replace(/\n$/, '') : text
}

function protectLine(line: string): string {
  if (/^[-+*](\s|$)/.test(line) || /^>/.test(line) || /^#{1,6}(\s|$)/.test(line)) {
    return '\\' + line
  }
  if (/^\d+[.)](\s|$)/.test(line)) return line.replace(/^(\d+)/, '\\$1')
  if (/^(`{3,}|~{3,})/.test(line)) return '\\' + line
  if (/^(=+|-{3,})\s*$/.test(line)) return '\\' + line
  return line
}

function protectLineStarts(text: string, skipFirst: boolean): string {
  const lines = text.split('\n')
  const start = skipFirst ? 1 : 0
  for (let i = start; i < lines.length; i += 1) lines[i] = protectLine(lines[i])
  return lines.join('\n')
}

function serializeParagraph(text: string): string {
  if (text.replace(/\s/g, '') === '') return ''
  return protectLineStarts(text, false).replace(/[ \t]+$/, '')
}

function serializeBlockquote(element: HTMLElement): string {
  const alert = ALERT_TYPES.find((type) => element.classList.contains('md-alert-' + type))
  const children = Array.from(element.childNodes).filter(
    (node) => !(isElement(node) && node.classList.contains('md-alert-text'))
  )
  const inner = serializeBlocks(children)
  const body = inner
    .split('\n')
    .filter((line, index, lines) => !(line === '' && lines.length === 1 && index === 0))
    .map((line) => (line === '' ? '>' : '> ' + line))
  if (alert) return ['> [!' + alert.toUpperCase() + ']', ...body].join('\n')
  if (body.length === 0) return '>'
  return body.join('\n')
}

function serializeList(element: HTMLElement, indent: string): string {
  const ordered = element.tagName === 'OL'
  const start = Number(element.getAttribute('start') ?? '1')
  const lines: string[] = []
  let index = Number.isFinite(start) && start > 0 ? start : 1
  for (const child of Array.from(element.children)) {
    if (child.tagName !== 'LI') continue
    const marker: ListMarker = { ordered, index }
    lines.push(serializeListItem(child, marker, indent))
    index += 1
  }
  return lines.join('\n')
}

function serializeListItem(item: Element, marker: ListMarker, indent: string): string {
  const checkbox = Array.from(item.children).find(
    (child) => child.tagName === 'INPUT' && (child as HTMLInputElement).type === 'checkbox'
  ) as HTMLInputElement | undefined
  const prefix = marker.ordered
    ? marker.index + serialization.orderedMarker + ' '
    : serialization.unorderedMarker + ' '
  const itemPrefix = checkbox ? prefix + '[' + (checkbox.checked ? 'x' : ' ') + '] ' : prefix
  const continuation = indent + ' '.repeat(itemPrefix.length)

  const inlineParts: string[] = []
  const nestedParts: string[] = []
  let inlineText = ''
  const flushInline = (): void => {
    if (inlineText !== '') {
      inlineParts.push(inlineText)
      inlineText = ''
    }
  }
  for (const child of Array.from(item.childNodes)) {
    if (isElement(child) && (child.tagName === 'UL' || child.tagName === 'OL')) {
      flushInline()
      nestedParts.push(serializeList(child, continuation))
      continue
    }
    if (isElement(child) && child.tagName === 'INPUT') continue
    if (isElement(child) && (child.tagName === 'P' || child.tagName === 'DIV')) {
      flushInline()
      inlineParts.push(serializeInlineNodes(child.childNodes))
      continue
    }
    // adjacent text nodes are one line of text, not several
    inlineText += serializeInlineNode(child)
  }
  flushInline()

  const content = protectLineStarts(inlineParts.join('\n'), true)
    .replace(/^\s+/, '')
    .replace(/\s+$/, '')
  const firstLine = indent + itemPrefix + content.split('\n')[0]
  const rest = content.split('\n').slice(1)
  const lines = [firstLine, ...rest.map((line) => (line === '' ? '' : continuation + line))]
  return lines.join('\n') + (nestedParts.length > 0 ? '\n' + nestedParts.join('\n') : '')
}

function alignMarker(cell: Element): string {
  const align = (cell as HTMLElement).style.textAlign
  if (align === 'center') return ':---:'
  if (align === 'right') return '---:'
  if (align === 'left') return ':---'
  return '---'
}

function serializeTable(table: Element): string {
  const rows = Array.from(table.querySelectorAll('tr'))
  if (rows.length === 0) return ''
  const toLine = (cells: Array<Element>): string =>
    '| ' + cells.map((cell) => serializeCellText(cell)).join(' | ') + ' |'

  const headerCells = Array.from(rows[0].children)
  const lines = [toLine(headerCells)]
  lines.push('| ' + headerCells.map((cell) => alignMarker(cell)).join(' | ') + ' |')
  for (const row of rows.slice(1)) lines.push(toLine(Array.from(row.children)))
  return lines.join('\n')
}

function serializePre(element: HTMLElement): string {
  if (element.classList.contains('md-meta-block')) {
    const meta = extractPreText(element, true)
    return '---\n' + meta + '\n---'
  }
  const lang = (element.getAttribute('lang') ?? '').trim()
  const code = extractPreText(element, true)
  return '```' + lang + '\n' + code + '\n```'
}

function serializeDiv(element: HTMLElement): string {
  if (element.classList.contains('md-toc')) return '[TOC]'
  if (element.classList.contains('md-def-footnote')) {
    const label = element.getAttribute('data-label') ?? '1'
    return '[^' + label + ']: ' + (element.textContent ?? '').trim()
  }
  if (element.classList.contains('md-def-link')) return (element.textContent ?? '').trim()
  if (element.classList.contains('md-math-block')) {
    return '$$\n' + (element.getAttribute('data-math') ?? '') + '\n$$'
  }
  if (element.classList.contains('md-diagram')) {
    return (
      '```mermaid\n' + (element.getAttribute('data-mermaid') ?? '').replace(/\n$/, '') + '\n```'
    )
  }
  if (element.classList.contains('md-table')) {
    const table = element.querySelector('table')
    return table ? serializeTable(table) : ''
  }
  return serializeParagraph(serializeChildren(element))
}

function serializeBlock(node: Node): string | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = escapeText(node.nodeValue ?? '')
    return text.trim() === '' ? null : serializeParagraph(text)
  }
  if (!isElement(node)) return null
  const element = node
  const heading = HEADING_TAG_RE.exec(element.tagName)
  if (heading) {
    const level = Number(heading[1])
    const inner = serializeChildren(element).replace(/\s+/g, ' ').trim()
    const useSetext =
      level <= 2 &&
      inner !== '' &&
      (serialization.headingStyle === 'setext' || serialization.headingStyle === 'hybrid')
    if (useSetext) return inner + '\n' + (level === 1 ? '===' : '---')
    return '#'.repeat(level) + (inner === '' ? '' : ' ' + inner)
  }
  switch (element.tagName) {
    case 'P':
      return serializeParagraph(serializeChildren(element))
    case 'BLOCKQUOTE':
      return serializeBlockquote(element)
    case 'UL':
    case 'OL':
      return serializeList(element, '')
    case 'PRE':
      return serializePre(element)
    case 'HR':
      return '---'
    case 'DIV':
      return serializeDiv(element)
    case 'TABLE':
      return serializeTable(element)
    case 'FIGURE': {
      const inner = serializeBlocks(element.childNodes)
      return inner === '' ? null : inner
    }
    default:
      return serializeParagraph(serializeChildren(element))
  }
}

function serializeBlocks(nodes: ArrayLike<Node>): string {
  const blocks: string[] = []
  for (const node of Array.from(nodes)) {
    const block = serializeBlock(node)
    if (block !== null && block !== '') blocks.push(block)
  }
  return blocks.join(BLOCK_SEPARATOR)
}

const BLOCK_TAGS = new Set([
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'UL',
  'OL',
  'PRE',
  'HR',
  'BLOCKQUOTE',
  'DIV',
  'TABLE',
  'FIGURE'
])

/** Serialises an arbitrary DOM fragment (selection, clipboard payload). */
export function serializeSelection(nodes: ArrayLike<Node>): string {
  const list = Array.from(nodes)
  const hasBlock = list.some((node) => isElement(node) && BLOCK_TAGS.has(node.tagName))
  const text = hasBlock ? serializeBlocks(list) : serializeParagraph(serializeInlineNodes(list))
  return text.replace(/\s+$/, '')
}

/** Converts the contenteditable DOM back into Markdown source. */
export function serializeDocument(root: Element): string {
  const body = serializeBlocks(root.childNodes)
  const trimmed = body.replace(/\s+$/, '')
  return trimmed === '' ? '' : trimmed + '\n'
}
