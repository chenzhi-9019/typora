const LEVEL_RE = /outline-h(\d)/

/**
 * `collapsibleOutline`: turns the flat outline list the sidebar renders into a foldable
 * tree without editing the component.
 *
 * Contract for the component if it ever renders nesting itself: put `collapsible-outline`
 * on the list (or on `.typora-app`) and this layer stops injecting toggles.
 */
export class CollapsibleOutline {
  private readonly resolveRoot: () => HTMLElement | null
  private readonly collapsed = new Set<number>()
  private observer: MutationObserver | null = null
  private attached = false
  private scheduled = false

  constructor(resolveRoot: () => HTMLElement | null) {
    this.resolveRoot = resolveRoot
  }

  attach(): void {
    if (this.attached) return
    this.attached = true
    this.observer = new MutationObserver(this.onMutations)
    this.observer.observe(document.body, { subtree: true, childList: true })
    document.addEventListener('click', this.onClick, true)
    this.decorate()
  }

  detach(): void {
    if (!this.attached) return
    this.attached = false
    this.observer?.disconnect()
    this.observer = null
    document.removeEventListener('click', this.onClick, true)
    this.collapsed.clear()
    this.undecorate()
  }

  private list(): HTMLElement | null {
    return document.querySelector<HTMLElement>('#outline-content .outline-list')
  }

  private decorate(): void {
    const list = this.list()
    if (!list) return
    list.classList.add('collapsible-outline')
    this.resolveRoot()?.classList.add('collapsible-outline')
    const items = Array.from(list.querySelectorAll<HTMLElement>('.outline-item'))
    const levels = items.map(levelOf)

    items.forEach((item, index) => {
      const hasChildren = index + 1 < items.length && levels[index + 1] > levels[index]
      const existing = item.querySelector<HTMLElement>(':scope > .outline-fold-toggle')
      if (hasChildren && !existing) {
        const toggle = document.createElement('button')
        toggle.type = 'button'
        toggle.className = 'outline-fold-toggle'
        toggle.setAttribute('aria-label', '折叠')
        toggle.setAttribute('data-fold', String(index))
        item.prepend(toggle)
      } else if (!hasChildren && existing) {
        existing.remove()
        this.collapsed.delete(index)
      }
      const toggle = item.querySelector<HTMLElement>(':scope > .outline-fold-toggle')
      if (toggle) {
        toggle.setAttribute('aria-expanded', this.collapsed.has(index) ? 'false' : 'true')
        toggle.setAttribute('data-fold', String(index))
      }
    })

    this.applyVisibility(items, levels)
  }

  /** Hides every item that sits under a collapsed heading. */
  private applyVisibility(items: HTMLElement[], levels: number[]): void {
    const stack: number[] = []
    items.forEach((item, index) => {
      while (stack.length > 0 && stack[stack.length - 1] >= levels[index]) stack.pop()
      item.hidden = stack.length > 0
      if (this.collapsed.has(index)) stack.push(levels[index])
    })
  }

  private undecorate(): void {
    const list = this.list()
    this.resolveRoot()?.classList.remove('collapsible-outline')
    if (!list) return
    list.classList.remove('collapsible-outline')
    for (const toggle of Array.from(list.querySelectorAll('.outline-fold-toggle'))) toggle.remove()
    for (const item of Array.from(list.querySelectorAll<HTMLElement>('.outline-item'))) {
      item.hidden = false
      item.classList.remove('collapsed')
    }
  }

  private readonly onMutations = (): void => {
    if (this.scheduled) return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      if (this.attached) this.decorate()
    })
  }

  private readonly onClick = (event: MouseEvent): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    const toggle = target.closest('.outline-fold-toggle')
    if (!toggle) return
    const index = Number(toggle.getAttribute('data-fold'))
    if (!Number.isInteger(index)) return
    event.preventDefault()
    event.stopPropagation()
    if (this.collapsed.has(index)) this.collapsed.delete(index)
    else this.collapsed.add(index)
    const item = toggle.closest('.outline-item')
    if (item) item.classList.toggle('collapsed', this.collapsed.has(index))
    this.decorate()
  }
}

function levelOf(item: HTMLElement): number {
  const match = LEVEL_RE.exec(item.className)
  return match ? Number(match[1]) : 1
}
