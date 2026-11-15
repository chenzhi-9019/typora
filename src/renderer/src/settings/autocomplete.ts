import { emojiCandidates, type EmojiCandidate } from './emoji'

/** `:sm` typed after whitespace (or at the start of a block) opens the popup. */
const TRIGGER_RE = /(?:^|[\s\u00a0(（[【"']):([a-z0-9_+-]{1,32})$/i

export interface EmojiAutocompleteHosts {
  /** `.typora-app`; the popup is appended there so it is never inside the contenteditable. */
  resolveRoot: () => HTMLElement | null
  /** `#write`; only typing inside it triggers the popup. */
  writeRoot: () => HTMLElement | null
}

/**
 * `emojiAutocomplete`: `:shortcode` inside the editor, Tab/Enter completes the top hit.
 */
export class EmojiAutocomplete {
  private readonly hosts: EmojiAutocompleteHosts
  private popup: HTMLElement | null = null
  private candidates: EmojiCandidate[] = []
  private active = 0
  private trigger: Range | null = null
  private attached = false

  constructor(hosts: EmojiAutocompleteHosts) {
    this.hosts = hosts
  }

  attach(): void {
    if (this.attached) return
    this.attached = true
    document.addEventListener('input', this.onInput, true)
    document.addEventListener('keydown', this.onKeydown, true)
  }

  detach(): void {
    if (!this.attached) return
    this.attached = false
    document.removeEventListener('input', this.onInput, true)
    document.removeEventListener('keydown', this.onKeydown, true)
    this.close()
  }

  /** Candidates for the caret position right now; empty when no `:query` is open. */
  current(): EmojiCandidate[] {
    return this.candidates
  }

  private readonly onInput = (event: Event): void => {
    const write = this.hosts.writeRoot()
    const target = event.target
    if (!write || !(target instanceof Node) || !write.contains(target)) {
      this.close()
      return
    }
    this.refresh()
  }

  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (this.popup === null || event.ctrlKey || event.metaKey || event.altKey) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.close()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (this.candidates.length === 0) return
      event.preventDefault()
      event.stopPropagation()
      const step = event.key === 'ArrowDown' ? 1 : -1
      this.active = (this.active + step + this.candidates.length) % this.candidates.length
      this.paint()
      return
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
      event.preventDefault()
      event.stopPropagation()
      this.commit(this.active)
    }
  }

  /** Re-reads the `:query` in front of the caret and re-renders the popup. */
  private refresh(): void {
    const found = caretTrigger()
    if (!found) {
      this.close()
      return
    }
    const candidates = emojiCandidates(found.query)
    if (candidates.length === 0) {
      this.close()
      return
    }
    this.trigger = found.range
    this.candidates = candidates
    this.active = 0
    this.render()
  }

  private render(): void {
    const popup = this.ensurePopup()
    this.paint()
    const rect = this.trigger?.getBoundingClientRect()
    const host = this.hosts.resolveRoot()
    const anchor = rect && rect.height > 0 ? rect : host?.getBoundingClientRect()
    popup.style.left = Math.round(anchor?.left ?? 0) + 'px'
    popup.style.top = Math.round((anchor?.bottom ?? 0) + 4) + 'px'
  }

  private paint(): void {
    const popup = this.popup
    if (!popup) return
    const rows = this.candidates.map((candidate, index) => {
      const row = document.createElement('div')
      row.className = 'emoji-candidate' + (index === this.active ? ' active' : '')
      row.setAttribute('role', 'option')
      row.setAttribute('aria-selected', index === this.active ? 'true' : 'false')
      const glyph = document.createElement('span')
      glyph.className = 'emoji-glyph'
      glyph.textContent = candidate.emoji
      const code = document.createElement('span')
      code.className = 'emoji-shortcode'
      code.textContent = ':' + candidate.shortcode + ':'
      row.append(glyph, code)
      return row
    })
    popup.replaceChildren(...rows)
  }

  private ensurePopup(): HTMLElement {
    const host = this.hosts.resolveRoot() ?? document.body
    const popup = this.popup ?? document.createElement('div')
    if (this.popup === null) {
      popup.className = 'typora-emoji-popup'
      popup.setAttribute('role', 'listbox')
      popup.setAttribute('contenteditable', 'false')
      popup.addEventListener('mousedown', this.onPointerDown)
    }
    if (popup.parentElement !== host) host.appendChild(popup)
    this.popup = popup
    return popup
  }

  private readonly onPointerDown = (event: Event): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    const row = target.closest('.emoji-candidate')
    if (!row) return
    event.preventDefault()
    const index = Array.from(row.parentElement?.children ?? []).indexOf(row)
    if (index >= 0) this.commit(index)
  }

  /** Replaces the `:query` with the chosen emoji and lets the editor commit it. */
  private commit(index: number): void {
    const candidate = this.candidates[index]
    const range = this.trigger
    if (!candidate || !range) {
      this.close()
      return
    }
    range.deleteContents()
    const node = document.createTextNode(candidate.emoji)
    range.insertNode(node)
    const caret = document.createRange()
    caret.setStart(node, candidate.emoji.length)
    caret.collapse(true)
    const selection = window.getSelection()
    if (selection) {
      selection.removeAllRanges()
      selection.addRange(caret)
    }
    const write = this.hosts.writeRoot()
    this.close()
    write?.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText', data: candidate.emoji })
    )
  }

  private close(): void {
    this.trigger = null
    this.candidates = []
    this.active = 0
    if (this.popup) {
      this.popup.remove()
      this.popup = null
    }
  }
}

/** The `:query` in front of a collapsed caret, with the range it occupies. */
function caretTrigger(): { query: string; range: Range } | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const selectionRange = selection.getRangeAt(0)
  if (!selectionRange.collapsed) return null
  const node = selectionRange.startContainer
  if (node.nodeType !== Node.TEXT_NODE) return null
  const offset = selectionRange.startOffset
  const before = (node.nodeValue ?? '').slice(0, offset)
  const match = TRIGGER_RE.exec(before)
  if (!match) return null
  const query = match[1]
  const range = document.createRange()
  range.setStart(node, offset - query.length - 1)
  range.setEnd(node, offset)
  return { query, range }
}
