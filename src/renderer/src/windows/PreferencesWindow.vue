<script setup lang="ts">
import { computed, ref } from 'vue'
import type { EditorSettings } from '@shared/types'
import { PANELS, type PrefGroup, type PrefRow, type PrefSection } from './prefsSchema'
import { closeWindow, patchSettings, resetSettings, settings } from './windowsApi'

/** The panel to open on, so a menu entry can deep link. */
const props = defineProps<{ panelId?: string }>()

/** Typora's order puts 通用 last, so the landing tab is named instead of taken from index 0. */
const DEFAULT_PANEL_ID = 'general'
const opened = PANELS.find((entry) => entry.id === (props.panelId ?? DEFAULT_PANEL_ID)) ?? PANELS[0]
const activeId = ref(opened.id)
const query = ref('')

const term = computed(() => query.value.trim().toLowerCase())

function filterSections(sections: PrefSection[], needle: string): PrefSection[] {
  return sections
    .map((section) => ({
      header: section.header,
      groups: section.groups.filter(
        (group) =>
          section.header.toLowerCase().includes(needle) ||
          group.label.toLowerCase().includes(needle) ||
          group.rows.some((row) => row.label.toLowerCase().includes(needle))
      )
    }))
    .filter((section) => section.groups.length > 0)
}

const active = computed(() => PANELS.find((entry) => entry.id === activeId.value) ?? PANELS[0])

const sections = computed<PrefSection[]>(() =>
  term.value === '' ? active.value.sections : filterSections(active.value.sections, term.value)
)

/** Nav entries without a hit dim while searching, as `.no-search-hit` does in Typora. */
const hitIds = computed<string[]>(() => {
  if (term.value === '') return PANELS.map((panel) => panel.id)
  return PANELS.filter((panel) => filterSections(panel.sections, term.value).length > 0).map(
    (panel) => panel.id
  )
})

/** A dependent control is hidden, never greyed, while its condition does not hold. */
function isVisible(row: PrefRow): boolean {
  if (!row.dependsOn) return true
  return String(settings[row.dependsOn.field]) === row.dependsOn.equals
}

function visibleRows(group: PrefGroup): PrefRow[] {
  return group.rows.filter(isVisible)
}

function rawValue(row: PrefRow): unknown {
  return settings[row.key]
}

function isChecked(row: PrefRow): boolean {
  return Boolean(rawValue(row))
}

function stringValue(row: PrefRow): string {
  const raw = rawValue(row)
  return raw === undefined || raw === null ? '' : String(raw)
}

function numberValue(row: PrefRow): number {
  const value = Number(rawValue(row) ?? 0)
  return Number.isFinite(value) ? value : 0
}

/** Selects carry strings, so a numeric preference is written back as a number. */
function write(row: PrefRow, input: string | number | boolean): void {
  const current = settings[row.key]
  const value = typeof current === 'number' ? Number(input) : input
  if (value === current) return
  if (typeof value === 'number' && !Number.isFinite(value)) return
  void patchSettings({ [row.key]: value } as Partial<EditorSettings>)
}

function onCheckbox(row: PrefRow, event: Event): void {
  write(row, (event.target as HTMLInputElement).checked)
}

function onSelect(row: PrefRow, event: Event): void {
  write(row, (event.target as HTMLSelectElement).value)
}

function onText(row: PrefRow, event: Event): void {
  write(row, (event.target as HTMLInputElement).value)
}

function onNumber(row: PrefRow, event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(value)) return
  const min = row.min ?? 0
  const max = row.max ?? Number.MAX_SAFE_INTEGER
  write(row, Math.min(Math.max(value, min), max))
}

function reset(): void {
  void resetSettings()
}

function close(): void {
  void closeWindow()
}
</script>

<template>
  <div class="window">
    <header class="window-header">
      <div class="window-header-content">
        <h2>偏好设置</h2>
      </div>
      <button class="header-action" type="button" title="恢复默认设置" @click="reset">重置</button>
      <button class="header-close" type="button" title="关闭" @click="close">
        <span class="icon">✕</span>
      </button>
    </header>

    <div class="window-content">
      <div class="pane-group">
        <div class="pane-sm sidebar">
          <ul class="list-group">
            <li class="list-group-header">
              <input v-model="query" class="search-input" type="search" placeholder="查找" />
            </li>
            <li class="list-group-content">
              <span
                v-for="panel in PANELS"
                :key="panel.id"
                :class="{
                  'nav-group-item': true,
                  active: panel.id === activeId,
                  'no-search-hit': !hitIds.includes(panel.id)
                }"
                @click="activeId = panel.id"
                >{{ panel.label }}</span
              >
            </li>
          </ul>
        </div>

        <div class="pane">
          <div class="content">
            <template v-for="section in sections" :key="section.header">
              <h3 class="panel-header">{{ section.header }}</h3>
              <div
                v-for="group in section.groups"
                :key="`${section.header}/${group.label}`"
                class="input-group"
              >
                <div class="input-group-header">{{ group.label }}</div>
                <div class="input-group-content">
                  <template v-for="row in visibleRows(group)" :key="row.label">
                    <div class="row">
                      <label v-if="row.kind === 'checkbox'" class="row-check">
                        <input
                          type="checkbox"
                          :checked="isChecked(row)"
                          @change="onCheckbox(row, $event)"
                        />
                        <span>{{ row.label }}</span>
                      </label>
                      <template v-else-if="row.kind === 'select'">
                        <label class="row-label">{{ row.label }}</label>
                        <select :value="stringValue(row)" @change="onSelect(row, $event)">
                          <option
                            v-for="option in row.options ?? []"
                            :key="option.value"
                            :value="option.value"
                          >
                            {{ option.label }}
                          </option>
                        </select>
                      </template>
                      <template v-else-if="row.kind === 'number'">
                        <label class="row-label">{{ row.label }}</label>
                        <input
                          type="number"
                          :value="numberValue(row)"
                          :min="row.min"
                          :max="row.max"
                          :step="row.step"
                          @change="onNumber(row, $event)"
                        />
                        <span v-if="row.unit" class="row-unit">{{ row.unit }}</span>
                      </template>
                      <template v-else>
                        <label class="row-label">{{ row.label }}</label>
                        <input
                          type="text"
                          :value="stringValue(row)"
                          :placeholder="row.placeholder"
                          @change="onText(row, $event)"
                        />
                      </template>
                    </div>
                    <div v-if="row.hint" class="row panel-content-hint">{{ row.hint }}</div>
                  </template>
                  <div v-if="group.hint" class="row panel-content-hint">{{ group.hint }}</div>
                </div>
              </div>
            </template>
            <p v-if="sections.length === 0" class="panel-empty">
              没有找到「{{ query }}」相关的设置。
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
