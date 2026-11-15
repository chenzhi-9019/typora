<script setup lang="ts">
import { computed } from 'vue'
import { resolveLocale, t, type MsgKey } from '@shared/i18n'
import { settings } from '@renderer/stores/settings'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; command: [command: string, arg?: string] }>()

/** Reads the reactive locale, so the entries relabel themselves on a language switch. */
const tr = (key: MsgKey): string => t(resolveLocale(settings.language, navigator.languages), key)

const themes = ['github', 'night', 'newsprint', 'pixyll', 'whitey'] as const

interface Entry {
  command: string
  label: string
  shortcut?: string
  arg?: string
  divider?: boolean
}

const entries = computed<Entry[]>(() => [
  { command: 'file.new', label: tr('mega.new'), shortcut: 'Ctrl+N' },
  { command: 'file.open', label: tr('mega.open'), shortcut: 'Ctrl+O' },
  { command: 'file.openFolder', label: tr('mega.openFolder'), shortcut: 'Ctrl+Shift+O' },
  { command: 'file.save', label: tr('mega.save'), shortcut: 'Ctrl+S' },
  { command: 'file.saveAs', label: tr('mega.saveAs'), shortcut: 'Ctrl+Shift+S' },
  { command: 'file.duplicate', label: tr('mega.duplicate'), divider: true },
  { command: 'export.html', label: tr('mega.exportHtml') },
  { command: 'export.pdf', label: tr('mega.exportPdf') },
  { command: 'file.preferences', label: tr('mega.preferences'), shortcut: 'Ctrl+,', divider: true },
  { command: 'help.about', label: tr('mega.about') }
])

function pick(entry: Entry): void {
  emit('command', entry.command, entry.arg)
  emit('close')
}

function pickTheme(name: string): void {
  emit('command', 'theme.set', name)
  emit('close')
}
</script>

<template>
  <div v-if="open" class="mega-menu-overlay" @click.self="emit('close')">
    <div id="megamenu-menu-sidebar" class="mega-menu-panel">
      <header class="megamenu-menu-header">
        <span id="megamenu-menu-header-title">Typora</span>
      </header>
      <ul class="megamenu-menu-list">
        <li v-for="entry in entries" :key="entry.command">
          <div v-if="entry.divider" class="megamenu-divider" />
          <button class="megamenu-item" @click="pick(entry)">
            <span class="megamenu-item-label">{{ entry.label }}</span>
            <span v-if="entry.shortcut" class="megamenu-item-shortcut">{{ entry.shortcut }}</span>
          </button>
        </li>
      </ul>
      <div class="megamenu-divider" />
      <ul class="megamenu-menu-list megamenu-theme-list">
        <li class="megamenu-group-title">{{ tr('mega.themes') }}</li>
        <li v-for="name in themes" :key="name">
          <button
            class="megamenu-item"
            :class="{ checked: settings.theme === name }"
            @click="pickTheme(name)"
          >
            <span class="megamenu-item-label">{{ name }}</span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>
