<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { resolveLocale, t, type MsgKey, type MsgParams } from '@shared/i18n'
import { doc, openFile } from '@renderer/stores/document'
import { settings } from '@renderer/stores/settings'
import type { FileRow } from '@renderer/stores/workspace'
import {
  beginRename,
  createFileIn,
  createFolderIn,
  deleteEntry,
  duplicateEntry,
  endRename,
  isExpanded,
  moveEntryTo,
  renameEntry,
  revealEntry,
  selectRow,
  targetFolder,
  toggleExpanded,
  workspace
} from '@renderer/stores/workspace'

const rows = computed(() => workspace.rows)
/** Reads the reactive locale, so the tree's wording follows a language switch. */
const locale = computed(() => resolveLocale(settings.language, navigator.languages))
const tr = (key: MsgKey, params?: MsgParams): string => t(locale.value, key, params)

interface MenuState {
  x: number
  y: number
  row: FileRow
}

interface MenuEntry {
  id: string
  label: string
  disabled?: boolean
  run: () => void
}

const tree = ref<HTMLElement | null>(null)
const menu = ref<MenuState | null>(null)
const draft = ref('')
let submitting = false

function isActive(path: string): boolean {
  return doc.path === path
}

function isEditing(path: string): boolean {
  return workspace.editingPath === path
}

function onRowClick(row: FileRow): void {
  selectRow(row.node.path)
  tree.value?.focus()
  if (row.node.isDirectory) toggleExpanded(row.node.path)
  else void openFile(row.node.path)
}

function openMenu(event: MouseEvent, row: FileRow): void {
  selectRow(row.node.path)
  menu.value = {
    x: Math.min(event.clientX, window.innerWidth - 180),
    y: Math.min(event.clientY, window.innerHeight - 216),
    row
  }
}

function closeMenu(): void {
  menu.value = null
}

function runAndClose(action: () => void): void {
  closeMenu()
  action()
}

const menuItems = computed<MenuEntry[]>(() => {
  const row = menu.value?.row
  if (!row) return []
  const folder = targetFolder(row.node.path, row.node.isDirectory)
  return [
    { id: 'newFile', label: tr('sidebar.newFile'), run: () => void createFileIn(folder) },
    { id: 'newFolder', label: tr('sidebar.newFolder'), run: () => void createFolderIn(folder) },
    { id: 'rename', label: tr('sidebar.rename'), run: () => beginRename(row.node.path) },
    {
      id: 'duplicate',
      label: tr('sidebar.duplicate'),
      disabled: row.node.isDirectory,
      run: () => void duplicateEntry(row.node.path)
    },
    {
      id: 'moveTo',
      label: tr('sidebar.moveTo'),
      run: () => void pickMoveTarget(row.node.path)
    },
    { id: 'reveal', label: tr('sidebar.reveal'), run: () => void revealEntry(row.node.path) },
    { id: 'remove', label: tr('sidebar.remove'), run: () => void confirmRemove(row.node.path) }
  ].map((entry) => ({ ...entry, run: () => runAndClose(entry.run) }))
})

async function pickMoveTarget(path: string): Promise<void> {
  const directory = await window.api.dialog.openFolder()
  if (directory) await moveEntryTo(path, directory)
}

/** Deletes only after the second click: the dialog's first button cancels. */
async function confirmRemove(path: string): Promise<void> {
  closeMenu()
  const name = path.split(/[\\/]/).pop() ?? path
  const answer = await window.api.dialog.message({
    type: 'warning',
    message: tr('sidebar.deleteConfirm', { name }),
    buttons: ['取消', '删除']
  })
  if (answer === 1) await deleteEntry(path)
}

function openSelected(): void {
  const path = workspace.selectedPath ?? doc.path
  if (!path) return
  const row = workspace.rows.find((candidate) => candidate.node.path === path)
  if (!row) return
  if (row.node.isDirectory) toggleExpanded(row.node.path)
  else void openFile(row.node.path)
}

function onKeydown(event: KeyboardEvent): void {
  if (workspace.editingPath) return
  if (event.key === 'F2') {
    event.preventDefault()
    const path = workspace.selectedPath ?? doc.path
    if (path) beginRename(path)
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    openSelected()
    return
  }
  if (event.key === 'Delete') {
    event.preventDefault()
    const path = workspace.selectedPath ?? doc.path
    if (path) void confirmRemove(path)
    return
  }
  if (event.key === 'Escape') closeMenu()
}

async function commitEdit(row: FileRow): Promise<void> {
  if (submitting || workspace.editingPath !== row.node.path) return
  submitting = true
  try {
    await renameEntry(row.node.path, draft.value)
  } finally {
    submitting = false
  }
}

function cancelEdit(): void {
  endRename()
  void nextTick(() => tree.value?.focus())
}

function onDocumentPointer(): void {
  if (menu.value) closeMenu()
}

watch(
  () => workspace.editingPath,
  async (path) => {
    if (!path) return
    draft.value = path.split(/[\\/]/).pop() ?? ''
    await nextTick()
    const input = tree.value?.querySelector<HTMLInputElement>('.file-tree-rename-input')
    input?.focus()
    input?.select()
  }
)

onMounted(() => {
  document.addEventListener('mousedown', onDocumentPointer)
  window.addEventListener('scroll', onDocumentPointer, true)
  window.addEventListener('resize', onDocumentPointer)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentPointer)
  window.removeEventListener('scroll', onDocumentPointer, true)
  window.removeEventListener('resize', onDocumentPointer)
})
</script>

<template>
  <div id="file-library">
    <div v-if="!workspace.root" class="file-library-empty">
      <p>文件(F) &gt; 打开文件夹</p>
      <p class="hint">打开一个文件夹以开始</p>
    </div>
    <ul
      v-else
      id="file-library-tree"
      ref="tree"
      tabindex="0"
      @keydown="onKeydown"
      @contextmenu.prevent
    >
      <li
        v-for="row in rows"
        :key="row.node.path"
        class="file-library-node"
        :class="{
          'is-directory': row.node.isDirectory,
          active: isActive(row.node.path),
          selected: workspace.selectedPath === row.node.path,
          'on-edit': isEditing(row.node.path)
        }"
        :style="'--tree-depth: ' + row.depth"
        :title="row.node.name"
        @click="onRowClick(row)"
        @contextmenu.prevent="openMenu($event, row)"
      >
        <span v-if="row.node.isDirectory" class="file-node-icon">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path
              v-if="!isExpanded(row.node.path)"
              d="M4 2.5 L8.5 6 L4 9.5 Z"
              fill="currentColor"
            />
            <path v-else d="M2.5 4 L9.5 4 L6 8.5 Z" fill="currentColor" />
          </svg>
        </span>
        <span v-else class="file-node-icon file-icon">
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3 1.5h6L13 5v9.5H3z" fill="none" stroke="currentColor" stroke-width="1.1" />
            <path d="M9 1.5V5h4" fill="none" stroke="currentColor" stroke-width="1.1" />
          </svg>
        </span>
        <input
          v-if="isEditing(row.node.path)"
          v-model="draft"
          class="file-tree-rename-input"
          spellcheck="false"
          @click.stop
          @keydown.enter.prevent="void commitEdit(row)"
          @keydown.esc.prevent="cancelEdit()"
          @blur="void commitEdit(row)"
        />
        <span v-else class="file-node-name">{{ row.node.name }}</span>
      </li>
    </ul>
    <div
      v-if="menu"
      class="file-context-menu"
      role="menu"
      :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
      @mousedown.stop
      @contextmenu.prevent
    >
      <button
        v-for="entry in menuItems"
        :key="entry.id"
        class="file-context-menu-item"
        :class="{ disabled: entry.disabled }"
        :disabled="entry.disabled"
        role="menuitem"
        :data-action="entry.id"
        @click="entry.run()"
      >
        {{ entry.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* base-control.css: .dropdown-menu{padding:0;background-color:var(--bg-color)};
   #sidebar-files-menu{padding-top:4px;border:var(--window-border)};
   bootstrap .dropdown-menu{min-width:160px} */
.file-context-menu {
  position: fixed;
  z-index: 40;
  min-width: 160px;
  padding: 4px 0;
  background: var(--bg-color);
  border: var(--window-border);
  box-shadow:
    0 3px 6px 0 color-mix(in srgb, var(--text-color) 4%, transparent),
    0 9px 24px 0 color-mix(in srgb, var(--text-color) 5%, transparent);
}

/* base-control.css: .context-menu.dropdown-menu>li>a{padding:3pt 24px 2pt 24px;cursor:default}
   #sidebar-files-menu.dropdown-menu>li{font-size:12.5px}  >li>a{line-height:1.42857143};
   .dropdown-menu>li>a:hover{background:var(--item-hover-bg-color);color:var(--item-hover-text-color)} */
.file-context-menu-item {
  display: block;
  width: 100%;
  padding: 4px 24px 3px;
  border: 0;
  background: transparent;
  color: var(--text-color);
  font-family: inherit;
  font-size: 12.5px;
  line-height: 1.42857143;
  text-align: left;
  cursor: default;
}

.file-context-menu-item:hover:not(.disabled) {
  background: var(--item-hover-bg-color);
  color: var(--item-hover-text-color);
}

.file-context-menu-item.disabled {
  opacity: 0.5;
}

/* base-control.css: .file-tree-node.select>.file-node-background{
     outline:1px solid var(--primary-color);outline-offset:-2px} */
.file-library-node.selected {
  outline: 1px solid var(--primary-color);
  outline-offset: -2px;
}

/* base-control.css: input{padding-left:4px;border:1px solid}; the row is a 22px line box */
.file-tree-rename-input {
  flex: 1 1 auto;
  min-width: 0;
  height: 20px;
  padding: 0 4px;
  border: var(--window-border);
  border-radius: 0;
  background: var(--bg-color);
  color: var(--text-color);
  font-family: inherit;
  font-size: inherit;
  outline: none;
}
</style>
