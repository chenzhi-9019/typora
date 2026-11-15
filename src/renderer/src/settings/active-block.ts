import { serializeSelection } from '@renderer/editor/dom-to-markdown'

/** Attribute the markdown source is published on; the stylesheet paints it as ::before. */
export const SOURCE_ATTRIBUTE = 'data-ty-source'

/**
 * Keeps the `::before` source line of the block the caret sits in (`.md-focus`) current.
 *
 * The source travels as an attribute and is rendered by CSS, so the contenteditable DOM
 * the editor serialises back to markdown never contains it.
 */
export class ActiveBlockSource {
  private readonly writeRoot: () => HTMLElement | null
  private observer: MutationObserver | null = null
  private attached = false

  constructor(writeRoot: () => HTMLElement | null) {
    this.writeRoot = writeRoot
  }

  attach(): void {
    if (this.attached) return
    this.attached = true
    const root = this.writeRoot()
    if (!root) return
    this.observer = new MutationObserver(this.onMutations)
    this.observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class']
    })
    this.sync()
  }

  detach(): void {
    this.observer?.disconnect()
    this.observer = null
    this.attached = false
    this.clear()
  }

  /** Re-publishes the source of the focused block and drops it from every other one. */
  sync(): void {
    const root = this.writeRoot()
    if (!root) return
    const focused = Array.from(root.querySelectorAll('.md-focus'))
    for (const element of Array.from(root.querySelectorAll('[' + SOURCE_ATTRIBUTE + ']'))) {
      if (!focused.includes(element)) element.removeAttribute(SOURCE_ATTRIBUTE)
    }
    for (const block of focused) {
      const source = describeBlock(block)
      if (source === '') {
        block.removeAttribute(SOURCE_ATTRIBUTE)
        continue
      }
      if (block.getAttribute(SOURCE_ATTRIBUTE) !== source)
        block.setAttribute(SOURCE_ATTRIBUTE, source)
    }
  }

  clear(): void {
    const root = this.writeRoot()
    if (!root) return
    for (const element of Array.from(root.querySelectorAll('[' + SOURCE_ATTRIBUTE + ']'))) {
      element.removeAttribute(SOURCE_ATTRIBUTE)
    }
  }

  private readonly onMutations = (): void => {
    this.sync()
  }
}

/** Markdown source of one rendered block, via the editor's own serialiser. */
function describeBlock(block: Element): string {
  try {
    const source = serializeSelection([block]).trim()
    if (source !== '') return source
  } catch {
    // a partially rendered block can defeat the serialiser; the text below still shows
  }
  return (block.textContent ?? '').trim()
}
