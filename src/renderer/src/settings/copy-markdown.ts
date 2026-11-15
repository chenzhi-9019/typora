import { serializeSelection } from '@renderer/editor/dom-to-markdown'

/**
 * `copyMarkdownOnCopy`: a copy inside `#write` puts the Markdown source on the clipboard
 * instead of the rendered text.
 */
export function installCopyMarkdown(
  isEnabled: () => boolean,
  writeRoot: () => HTMLElement | null
): () => void {
  const handler = (event: ClipboardEvent): void => {
    if (!isEnabled()) return
    const data = event.clipboardData
    const root = writeRoot()
    if (!data || !root) return
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return
    const range = selection.getRangeAt(0)
    if (!root.contains(range.commonAncestorContainer)) return
    const markdown = serializeSelection(range.cloneContents().childNodes).trim()
    if (markdown === '') return
    data.setData('text/plain', markdown)
    event.preventDefault()
  }
  document.addEventListener('copy', handler, true)
  return () => document.removeEventListener('copy', handler, true)
}
