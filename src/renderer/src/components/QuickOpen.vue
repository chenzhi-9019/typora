<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { FileNode } from '@shared/types'
import { doc, openFile } from '@renderer/stores/document'
import { settings } from '@renderer/stores/settings'
import { workspace } from '@renderer/stores/workspace'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const query = ref('')
const activeIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLElement | null>(null)

interface Entry {
  path: string
  name: string
  hint: string
}

function collect(): Entry[] {
  const entries: Entry[] = []
  const seen = new Set<string>()
  const stack: FileNode[] = workspace.root ? [...(workspace.root.children ?? [])] : []
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) continue
    if (node.isDirectory) {
      stack.push(...(node.children ?? []))
      continue
    }
    if (seen.has(node.path)) continue
    seen.add(node.path)
    entries.push({ path: node.path, name: node.name, hint: '文件树' })
  }
  for (const path of settings.recentFiles) {
    if (seen.has(path)) continue
    seen.add(path)
    entries.push({ path, name: path.split(/[\\/]/).pop() ?? path, hint: '最近打开' })
  }
  return entries
}

const results = computed<Entry[]>(() => {
  const all = collect()
  const q = query.value.trim().toLowerCase()
  if (!q) return all.slice(0, 60)
  return all
    .filter((entry) => entry.path.toLowerCase().includes(q))
    .sort((a, b) => {
      const an = a.name.toLowerCase().indexOf(q)
      const bn = b.name.toLowerCase().indexOf(q)
      return an - bn
    })
    .slice(0, 60)
})

watch(results, () => {
  activeIndex.value = 0
})

watch(
  () => doc.path,
  () => {
    activeIndex.value = 0
  }
)

function choose(entry: Entry | undefined): void {
  if (!entry) return
  void openFile(entry.path)
  emit('close')
}

function move(step: number): void {
  if (results.value.length === 0) return
  const next = (activeIndex.value + step + results.value.length) % results.value.length
  activeIndex.value = next
  void nextTick(() => {
    const node = listRef.value?.querySelector<HTMLElement>('[data-active="true"]')
    node?.scrollIntoView({ block: 'nearest' })
  })
}

onMounted(() => inputRef.value?.focus())
watch(
  () => inputRef.value,
  (element) => element?.focus()
)
</script>

<template>
  <div v-if="open" class="ty-quick-open-overlay" @click.self="emit('close')">
    <div id="typora-quick-open" class="ty-quick-open">
      <input
        id="typora-quick-open-input"
        ref="inputRef"
        v-model="query"
        type="text"
        placeholder="搜索文件"
        spellcheck="false"
        @keydown.down.prevent="move(1)"
        @keydown.up.prevent="move(-1)"
        @keydown.enter.prevent="choose(results[activeIndex])"
        @keydown.esc.prevent="emit('close')"
      />
      <ul id="typora-quick-open-list" ref="listRef">
        <li
          v-for="(entry, index) in results"
          :key="entry.path"
          class="ty-quick-open-item"
          :data-active="index === activeIndex"
          :title="entry.path"
          @mouseenter="activeIndex = index"
          @click="choose(entry)"
        >
          <span class="ty-quick-open-name">{{ entry.name }}</span>
          <span class="ty-quick-open-hint">{{ entry.hint }}</span>
        </li>
        <li v-if="results.length === 0" class="ty-quick-open-empty">没有匹配的文件</li>
      </ul>
    </div>
  </div>
</template>
