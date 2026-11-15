export interface CaretPosition {
  block: number
  offset: number
}

const BLOCK_SELECTOR =
  'p,h1,h2,h3,h4,h5,h6,li,pre,hr,blockquote,ul,ol,table,div.md-math-block,div.md-diagram,div.md-table'

function isElement(node: Node): node is HTMLElement {
  return node.nodeType === Node.ELEMENT_NODE
}

/** The direct child of `root` that contains `node`, if any. */
export function topLevelBlockAt(root: Element, node: Node | null): HTMLElement | null {
  let current = node
  while (current && current.parentNode !== root) {
    current = current.parentNode
  }
  return current && isElement(current) ? current : null
}

/** The closest block-ish element around `node` (a paragraph inside a quote, a list item...). */
export function nearestBlockAt(root: Element, node: Node | null): HTMLElement | null {
  let current = node
  while (current && current !== root) {
    if (isElement(current) && current.matches(BLOCK_SELECTOR)) return current
    current = current.parentNode
  }
  return null
}

export function currentRange(): Range | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  return selection.getRangeAt(0)
}

export function selectRange(range: Range): void {
  const selection = window.getSelection()
  if (!selection) return
  selection.removeAllRanges()
  selection.addRange(range)
}

export function placeCaretAtEnd(element: Element): void {
  const range = document.createRange()
  range.selectNodeContents(element)
  range.collapse(false)
  selectRange(range)
}

function textOffsetWithin(block: Element, container: Node, offset: number): number {
  try {
    const measure = document.createRange()
    measure.selectNodeContents(block)
    measure.setEnd(container, offset)
    return measure.toString().length
  } catch {
    return 0
  }
}

export function currentCaretPosition(root: Element): CaretPosition | null {
  const range = currentRange()
  if (!range) return null
  if (!root.contains(range.startContainer)) return null
  const block = topLevelBlockAt(root, range.startContainer)
  if (!block) return null
  const index = Array.prototype.indexOf.call(root.children, block)
  if (index < 0) return null
  return { block: index, offset: textOffsetWithin(block, range.startContainer, range.startOffset) }
}

export function placeCaretWithin(element: Element, offset: number): void {
  const range = document.createRange()
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let remaining = Math.max(0, offset)
  let placed = false
  let node = walker.nextNode()
  while (node) {
    const length = (node.nodeValue ?? '').length
    // an empty text node can never hold a caret: Blink would then insert text outside the block
    if (length > 0) {
      if (remaining <= length) {
        range.setStart(node, remaining)
        range.collapse(true)
        placed = true
        break
      }
      remaining -= length
    }
    node = walker.nextNode()
  }
  if (!placed) {
    range.selectNodeContents(element)
    // offset 0 in an empty block means "before the placeholder", not "after it"
    range.collapse(remaining > 0)
  }
  selectRange(range)
}

export function setCaretPosition(root: Element, position: CaretPosition): void {
  const blocks = Array.from(root.children)
  if (blocks.length === 0) return
  const index = Math.max(0, Math.min(blocks.length - 1, position.block))
  placeCaretWithin(blocks[index], position.offset)
}

function textNodesOf(element: Element): Text[] {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let node = walker.nextNode()
  while (node) {
    nodes.push(node as Text)
    node = walker.nextNode()
  }
  return nodes
}

function locateOffset(nodes: Text[], offset: number): { node: Text; offset: number } | null {
  let remaining = Math.max(0, offset)
  for (const node of nodes) {
    const length = (node.nodeValue ?? '').length
    if (remaining <= length) return { node, offset: remaining }
    remaining -= length
  }
  const last = nodes[nodes.length - 1]
  return last ? { node: last, offset: (last.nodeValue ?? '').length } : null
}

export function rangeForOffsets(element: Element, start: number, end: number): Range | null {
  const nodes = textNodesOf(element)
  const from = locateOffset(nodes, start)
  const to = locateOffset(nodes, end)
  if (!from || !to) return null
  const range = document.createRange()
  range.setStart(from.node, from.offset)
  range.setEnd(to.node, to.offset)
  return range
}

export function deleteOffsets(element: Element, start: number, end: number): boolean {
  const range = rangeForOffsets(element, start, end)
  if (!range) return false
  range.deleteContents()
  const caret = range.cloneRange()
  caret.collapse(true)
  selectRange(caret)
  return true
}

export function caretOffsetIn(block: Element): number | null {
  const range = currentRange()
  if (!range || !block.contains(range.startContainer)) return null
  return textOffsetWithin(block, range.startContainer, range.startOffset)
}

/** Nearest scrollable ancestor, so typewriter mode can centre the caret block. */
export function findScrollParent(element: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = element.parentElement
  while (current) {
    const overflow = getComputedStyle(current).overflowY
    if (
      (overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') &&
      current.scrollHeight > current.clientHeight
    ) {
      return current
    }
    current = current.parentElement
  }
  return null
}

export function centerElementInView(block: HTMLElement): void {
  const scroller = findScrollParent(block)
  const blockRect = block.getBoundingClientRect()
  const viewportCenter = scroller
    ? scroller.getBoundingClientRect().top + scroller.clientHeight / 2
    : window.innerHeight / 2
  const delta = blockRect.top + blockRect.height / 2 - viewportCenter
  if (Math.abs(delta) < 4) return
  const target: HTMLElement | Element | null = scroller ?? document.scrollingElement
  if (!target) return
  target.scrollTop += delta
}
