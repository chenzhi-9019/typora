<script setup lang="ts">
import { resolveLocale, t, type MsgKey } from '@shared/i18n'
import { activeTabId, closeTab, cycleTab, save, switchTo, tabs } from '@renderer/stores/document'
import { settings } from '@renderer/stores/settings'

/** Reads the reactive locale, so the bar relabels itself when the language changes. */
const tr = (key: MsgKey): string => t(resolveLocale(settings.language, navigator.languages), key)

function onWheel(event: WheelEvent): void {
  if (tabs.length < 2) return
  cycleTab(event.deltaY > 0 ? 1 : -1)
}

/** Closes a tab, asking first when it holds unsaved edits. */
async function closeWithConfirm(id: string): Promise<void> {
  const tab = tabs.find((entry) => entry.id === id)
  if (!tab) return
  if (tab.content === tab.saved) {
    await closeTab(id)
    return
  }
  const index = await window.api.dialog.message({
    type: 'warning',
    message: '当前文档有未保存的修改',
    detail: '是否先保存？',
    buttons: ['保存', '放弃', '取消']
  })
  if (index === 2) return
  if (index === 0) {
    // save() writes the document, so bring this tab forward when it is not the active one
    if (id !== activeTabId.value) switchTo(id)
    if (!(await save())) return
  }
  await closeTab(id)
}
</script>

<template>
  <div v-if="tabs.length > 1" class="ty-tabbar" @wheel.prevent="onWheel">
    <div
      v-for="tab in tabs"
      :key="tab.id"
      class="ty-tab"
      :class="{ active: tab.id === activeTabId, dirty: tab.content !== tab.saved }"
      :title="tab.path ?? tab.title"
      @click="switchTo(tab.id)"
    >
      <span class="ty-tab-title">{{ tab.title || tr('tab.untitled') }}</span>
      <button
        class="ty-tab-close"
        :title="tr('tab.close')"
        @click.stop="void closeWithConfirm(tab.id)"
      >
        <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
          <path
            d="M1 1 9 9M9 1 1 9"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-linecap="round"
          />
        </svg>
      </button>
    </div>
  </div>
</template>
