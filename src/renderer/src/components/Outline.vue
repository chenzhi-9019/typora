<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { outline } from '@renderer/stores/outline'

/** Rendered heading blocks of the article (#write), in document order. */
const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6'
/** How far below the viewport top a heading has to reach to become the current one. */
const ACTIVE_MARGIN = 8

const root = ref<HTMLElement | null>(null)
const activeLine = ref<number | null>(null)

let writeRoot: HTMLElement | null = null
let writeObserver: MutationObserver | null = null
let frame = 0

function jump(line: number): void {
  activeLine.value = line
  window.dispatchEvent(new CustomEvent('typora:goto-line', { detail: line }))
}

/** Nearest scrollable ancestor, i.e. the box whose top edge is the visible top. */
function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node
  }
  return null
}

/** Rebinds to #write when the editor mounts later or replaces its root. */
function ensureWrite(): HTMLElement | null {
  if (writeRoot?.isConnected) return writeRoot
  writeObserver?.disconnect()
  writeObserver = null
  const element = document.querySelector<HTMLElement>('#write')
  writeRoot = element
  if (element) {
    // the engine moves .md-focus from block to block and hides #write in source mode
    writeObserver = new MutationObserver(schedule)
    writeObserver.observe(element, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'hidden']
    })
  }
  return element
}

/** Line of the heading that owns the top of the editor viewport, null when there is none. */
function currentLine(): number | null {
  const items = outline.value
  const write = ensureWrite()
  if (items.length === 0 || !write || write.hidden) return null
  const blocks = Array.from(write.querySelectorAll<HTMLElement>(HEADING_SELECTOR))
  if (blocks.length === 0) return null
  const viewportTop = (scrollParent(write)?.getBoundingClientRect().top ?? 0) + ACTIVE_MARGIN
  const limit = Math.min(items.length, blocks.length) - 1
  let index = 0
  for (let i = 0; i <= limit; i += 1) {
    if (blocks[i].getBoundingClientRect().top > viewportTop) break
    index = i
  }
  return items[index].line
}

/** Scrolls the current item into view, but only when the list overflows the panel. */
function revealCurrent(): void {
  const container = root.value
  if (!container || container.scrollHeight <= container.clientHeight) return
  container.querySelector<HTMLElement>('.outline-active')?.scrollIntoView({ block: 'nearest' })
}

function sync(): void {
  const line = currentLine()
  if (line === activeLine.value) return
  activeLine.value = line
  void nextTick(revealCurrent)
}

/** Coalesces scroll, caret and mutation bursts into at most one pass per frame. */
function schedule(): void {
  if (frame !== 0) return
  frame = requestAnimationFrame(() => {
    frame = 0
    sync()
  })
}

onMounted(() => {
  window.addEventListener('scroll', schedule, { capture: true, passive: true })
  document.addEventListener('selectionchange', schedule, { passive: true })
  schedule()
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', schedule, { capture: true })
  document.removeEventListener('selectionchange', schedule)
  writeObserver?.disconnect()
  writeObserver = null
  writeRoot = null
  if (frame !== 0) cancelAnimationFrame(frame)
  frame = 0
})

watch(outline, () => schedule())
</script>

<template>
  <div id="outline-content" ref="root">
    <div v-if="outline.length === 0" class="outline-empty">暂无大纲</div>
    <ul v-else class="outline-list">
      <li
        v-for="(item, index) in outline"
        :key="`${item.line}-${index}`"
        class="outline-item"
        :class="['outline-h' + item.level, { 'outline-active': activeLine === item.line }]"
        :title="item.text"
        @click="jump(item.line)"
      >
        {{ item.text }}
      </li>
    </ul>
  </div>
</template>
