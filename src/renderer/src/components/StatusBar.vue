<script setup lang="ts">
import { computed } from 'vue'
import { resolveLocale, t, type MsgKey, type MsgParams } from '@shared/i18n'
import { doc } from '@renderer/stores/document'
import { charCount, nonSpaceCharCount, wordCount } from '@renderer/stores/outline'
import { settings, toggleSetting } from '@renderer/stores/settings'
import { toggleSidebar } from '@renderer/stores/workspace'

/** Reads the reactive locale, so every call re-renders when the language changes. */
const tr = (key: MsgKey, params?: MsgParams): string =>
  t(resolveLocale(settings.language, navigator.languages), key, params)

/** The popover lives in App.vue's dialog state, so the status bar only asks for it. */
const emit = defineEmits<{ wordCount: [] }>()

const pathLabel = computed(() => doc.path ?? tr('status.unsaved'))
const counts = computed(() =>
  tr('status.counts', {
    words: wordCount.value,
    chars: charCount.value,
    nonSpace: nonSpaceCharCount.value
  })
)

function toggleSourceMode(): void {
  toggleSetting('sourceCodeMode')
}
</script>

<template>
  <footer class="ty-footer">
    <div class="footer-left">
      <button
        class="footer-icon-btn"
        :class="{ on: settings.sidebarVisible }"
        :title="tr('status.sidebar')"
        @click="toggleSidebar"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.3" />
          <circle cx="8" cy="8" r="2" fill="currentColor" />
        </svg>
      </button>
      <button
        class="footer-icon-btn"
        :class="{ on: settings.sourceCodeMode }"
        :title="tr('status.sourceCodeMode')"
        @click="toggleSourceMode"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M5.6 4.4 2 8l3.6 3.6M10.4 4.4 14 8l-3.6 3.6"
            fill="none"
            stroke="currentColor"
            stroke-width="1.35"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </div>
    <div class="footer-right">
      <span
        class="footer-stat"
        role="button"
        tabindex="0"
        :title="counts"
        @click="emit('wordCount')"
        @keydown.enter.prevent="emit('wordCount')"
        @keydown.space.prevent="emit('wordCount')"
        >{{ tr('status.words', { count: wordCount }) }}</span
      >
    </div>
    <span class="footer-path" :title="pathLabel">{{ pathLabel }}</span>
  </footer>
</template>
