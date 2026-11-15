<script setup lang="ts">
import { ref, watch } from 'vue'
import { resolveLocale, t, type MsgKey, type MsgParams } from '@shared/i18n'
import type { FileNode } from '@shared/types'
import { openFile } from '@renderer/stores/document'
import { settings } from '@renderer/stores/settings'
import { workspace } from '@renderer/stores/workspace'

interface Hit {
  path: string
  name: string
  line: number
  preview: string
}

/** Reads the reactive locale, so the panel follows a language switch. */
const tr = (key: MsgKey, params?: MsgParams): string =>
  t(resolveLocale(settings.language, navigator.languages), key, params)

const query = ref('')
const caseSensitive = ref(false)
const wholeWord = ref(false)
const regexp = ref(false)
const hits = ref<Hit[]>([])
const searching = ref(false)
const errorMessage = ref('')

const MAX_FILES = 500
const MAX_HITS = 300

function collectFiles(root: FileNode | null): { path: string; name: string }[] {
  const files: { path: string; name: string }[] = []
  if (!root) return files
  const stack: FileNode[] = [...(root.children ?? [])]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) continue
    if (node.isDirectory) {
      stack.push(...(node.children ?? []))
    } else if (files.length < MAX_FILES) {
      files.push({ path: node.path, name: node.name })
    }
  }
  return files
}

function buildMatcher(): RegExp | null {
  errorMessage.value = ''
  if (!query.value) return null
  let pattern = regexp.value ? query.value : query.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (wholeWord.value) pattern = '\\b' + pattern + '\\b'
  try {
    return new RegExp(pattern, caseSensitive.value ? '' : 'i')
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
    return null
  }
}

async function runSearch(): Promise<void> {
  hits.value = []
  const matcher = buildMatcher()
  if (!matcher) return
  searching.value = true
  try {
    for (const file of collectFiles(workspace.root)) {
      const content = await window.api.fs.readFile(file.path).catch(() => null)
      if (!content) continue
      const lines = content.content.split(/\r?\n/)
      for (let i = 0; i < lines.length; i++) {
        if (matcher.test(lines[i])) {
          hits.value.push({
            path: file.path,
            name: file.name,
            line: i + 1,
            preview: lines[i].trim().slice(0, 120)
          })
          if (hits.value.length >= MAX_HITS) return
        }
      }
    }
  } finally {
    searching.value = false
  }
}

let timer: number | undefined
watch([query, caseSensitive, wholeWord, regexp], () => {
  window.clearTimeout(timer)
  timer = window.setTimeout(() => void runSearch(), 250)
})
</script>

<template>
  <div id="file-library-search-panel">
    <div class="search-input-wrap">
      <input
        id="file-library-search-input"
        v-model="query"
        type="text"
        :placeholder="tr('search.placeholder')"
        spellcheck="false"
      />
      <button
        class="search-option-btn"
        :class="{ on: caseSensitive }"
        :title="tr('search.matchCase')"
        @click="caseSensitive = !caseSensitive"
      >
        Aa
      </button>
      <button
        class="search-option-btn"
        :class="{ on: wholeWord }"
        :title="tr('search.wholeWord')"
        @click="wholeWord = !wholeWord"
      >
        \b
      </button>
      <button
        class="search-option-btn"
        :class="{ on: regexp }"
        :title="tr('search.regexp')"
        @click="regexp = !regexp"
      >
        .*
      </button>
    </div>
    <div v-if="errorMessage" class="search-error">{{ errorMessage }}</div>
    <div class="search-summary">
      <span v-if="searching">{{ tr('search.searching') }}</span>
      <span v-else-if="query">{{ tr('search.results', { count: hits.length }) }}</span>
    </div>
    <ul id="file-library-search-result">
      <li
        v-for="hit in hits"
        :key="hit.path + ':' + hit.line"
        class="search-result-item"
        @click="openFile(hit.path)"
      >
        <div class="file-list-item-file-name">
          {{ hit.name }}<span class="search-line">:{{ hit.line }}</span>
        </div>
        <div class="file-list-item-summary">{{ hit.preview }}</div>
      </li>
    </ul>
  </div>
</template>
