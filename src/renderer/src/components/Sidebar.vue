<script setup lang="ts">
import { computed } from 'vue'
import { resolveLocale, t, type MsgKey } from '@shared/i18n'
import type { SidebarTab } from '@shared/types'
import { settings } from '@renderer/stores/settings'
import { newFile } from '@renderer/stores/document'
import { openFolder, refreshFolder, setSidebarTab, workspace } from '@renderer/stores/workspace'
import FileTree from './FileTree.vue'
import Outline from './Outline.vue'
import SidebarSearch from './SidebarSearch.vue'

/** Reads the reactive locale, so the tabs follow a language switch. */
const tr = (key: MsgKey): string => t(resolveLocale(settings.language, navigator.languages), key)

const tab = computed(() => settings.sidebarTab)
const width = computed(() => `${settings.sidebarWidth}px`)

function setTab(next: SidebarTab): void {
  setSidebarTab(next)
}

function onNewFile(): void {
  void newFile()
}

const emit = defineEmits<{ menu: [] }>()
</script>

<template>
  <aside id="typora-sidebar" :style="{ width }">
    <div class="sidebar-tabs" role="tablist">
      <button
        class="sidebar-tab"
        :class="{ active: tab === 'files' }"
        role="tab"
        @click="setTab('files')"
      >
        {{ tr('sidebar.files') }}
      </button>
      <button
        class="sidebar-tab"
        :class="{ active: tab === 'outline' }"
        role="tab"
        @click="setTab('outline')"
      >
        {{ tr('sidebar.outline') }}
      </button>
      <button
        class="sidebar-tab"
        :class="{ active: tab === 'search' }"
        role="tab"
        @click="setTab('search')"
      >
        {{ tr('sidebar.search') }}
      </button>
    </div>

    <div id="sidebar-content" class="sidebar-content">
      <FileTree v-if="tab === 'files'" />
      <Outline v-else-if="tab === 'outline'" />
      <SidebarSearch v-else />
    </div>

    <footer id="ty-sidebar-footer">
      <button id="sidebar-new-file-btn" class="sidebar-footer-btn" :title="tr('sidebar.newFile')" @click="onNewFile">
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      </button>
      <button
        id="sidebar-menu-btn"
        class="sidebar-footer-btn"
        :title="tr('sidebar.more')"
        @click="emit('menu')"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
          />
        </svg>
      </button>
      <span class="sidebar-footer-spacer" />
      <button
        v-if="workspace.root"
        class="sidebar-footer-btn"
        :title="tr('sidebar.refresh')"
        @click="refreshFolder"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5V6h-3.4"
            fill="none"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <button v-else class="sidebar-footer-btn" :title="tr('sidebar.openFolder')" @click="openFolder">
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M1.8 4.2h4l1.3 1.6h7.1v6.8H1.8z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.3"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </footer>
  </aside>
</template>
