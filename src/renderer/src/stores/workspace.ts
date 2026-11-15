import { reactive } from 'vue'
import type { FileNode, SidebarTab } from '@shared/types'
import { patchSettings, settings } from './settings'
import { syncDocumentPath } from './document'

/** Name handed to the main process for a new file; it uniquifies ("Untitled 1.md", ...). */
const NEW_FILE_NAME = 'Untitled.md'
/** Name handed to the main process for a new folder. */
const NEW_FOLDER_NAME = 'New Folder'

export const workspace = reactive({
  root: null as FileNode | null,
  /** flattened rows of the currently expanded tree, in render order */
  rows: [] as FileRow[],
  loading: false,
  /** row the tree highlights as selected; survives refreshFolder() */
  selectedPath: null as string | null,
  /** row whose name is being edited in place, null when nothing is being renamed */
  editingPath: null as string | null
})

export interface FileRow {
  node: FileNode
  depth: number
}

const expanded = reactive(new Set<string>())

export function isExpanded(path: string): boolean {
  return expanded.has(path)
}

export function expand(path: string): void {
  expanded.add(path)
  rebuildRows()
}

export function collapse(path: string): void {
  expanded.delete(path)
  rebuildRows()
}

export function toggleExpanded(path: string): void {
  if (expanded.has(path)) collapse(path)
  else expand(path)
}

function rebuildRows(): void {
  const rows: FileRow[] = []
  const walk = (node: FileNode, depth: number): void => {
    rows.push({ node, depth })
    if (!node.isDirectory || !expanded.has(node.path)) return
    for (const child of node.children ?? []) walk(child, depth + 1)
  }
  for (const child of workspace.root?.children ?? []) walk(child, 0)
  workspace.rows = rows
}

export async function openFolder(): Promise<void> {
  const path = await window.api.dialog.openFolder()
  if (!path) return
  await setFolder(path)
}

export async function setFolder(path: string): Promise<void> {
  workspace.loading = true
  try {
    workspace.root = await window.api.fs.readDir(path, 8)
    expanded.clear()
    expanded.add(path)
    rebuildRows()
    await patchSettings({ lastOpenedFolder: path, sidebarVisible: true })
    await window.api.fs.watchFolder(path)
  } finally {
    workspace.loading = false
  }
}

export async function refreshFolder(): Promise<void> {
  if (!workspace.root) return
  const keep = new Set(expanded)
  workspace.root = await window.api.fs.readDir(workspace.root.path, 8)
  expanded.clear()
  for (const p of keep) expanded.add(p)
  rebuildRows()
}

/** Opens the sidebar on the file tree and expands every folder above `path`. */
export function revealInSidebar(path: string | null): void {
  if (!path || !workspace.root) return
  const normalise = (value: string): string => value.replace(/\\/g, '/')
  const target = normalise(path)
  const walk = (node: FileNode): boolean => {
    if (normalise(node.path) === target) return true
    if (!node.isDirectory) return false
    for (const child of node.children ?? []) {
      if (walk(child)) {
        expanded.add(node.path)
        return true
      }
    }
    return false
  }
  walk(workspace.root)
  rebuildRows()
  void patchSettings({ sidebarVisible: true, sidebarTab: 'files' })
}

export function setSidebarTab(tab: SidebarTab): void {
  void patchSettings({ sidebarTab: tab })
}

export function toggleSidebar(): void {
  void patchSettings({ sidebarVisible: !settings.sidebarVisible })
}

/* ------------------------------------------------------------ file manager
 * Operations behind the tree's context menu, its F2 key and the File menu.
 * Each one talks to the main process, refreshes the tree and leaves the new or
 * moved entry selected, so the caller does not have to know about the tree.
 */

function normalise(path: string): string {
  return path.replace(/\\/g, '/')
}

function separatorOf(path: string): string {
  return path.includes('\\') ? '\\' : '/'
}

/** Directory part of a path; `C:\\a.txt` -> `C:\\`, `/a/b` -> `/a`. */
export function parentPath(path: string): string {
  const index = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  if (index < 0) return ''
  const parent = path.slice(0, index)
  return /^[a-zA-Z]:$/.test(parent) ? parent + separatorOf(path) : parent
}

export function joinPath(directory: string, name: string): string {
  if (directory === '') return name
  if (directory.endsWith('\\') || directory.endsWith('/')) return directory + name
  return directory + separatorOf(directory) + name
}

/** The folder a new entry belongs to for a row: the folder itself, or its parent. */
export function targetFolder(path: string, isDirectory: boolean): string {
  return isDirectory ? path : parentPath(path)
}

/** Expands `path` and every folder above it so the refreshed tree shows the new entry. */
function expandInto(path: string): void {
  const root = workspace.root
  if (!root) return
  const target = normalise(path)
  const walk = (node: FileNode): boolean => {
    const key = normalise(node.path)
    if (key === target) return true
    if (!node.isDirectory || !target.startsWith(key + '/')) return false
    for (const child of node.children ?? []) {
      if (walk(child)) {
        expanded.add(node.path)
        return true
      }
    }
    return false
  }
  if (walk(root)) expanded.add(path)
}

/** Keeps the expanded folders pointing at the entry after it was renamed or moved. */
function remapExpanded(from: string, to: string): void {
  const fromKey = normalise(from)
  const next: string[] = []
  for (const path of expanded) {
    const key = normalise(path)
    if (key === fromKey) next.push(to)
    else if (key.startsWith(fromKey + '/')) {
      next.push(joinPath(to, path.slice(from.length + 1)))
    } else next.push(path)
  }
  expanded.clear()
  for (const path of next) expanded.add(path)
}

async function reportFailure(message: string, error: unknown): Promise<void> {
  const detail = error instanceof Error ? error.message : String(error)
  await window.api.dialog.message({ type: 'error', message, detail, buttons: ['确定'] })
}

export function selectRow(path: string | null): void {
  workspace.selectedPath = path
}

export function beginRename(path: string): void {
  workspace.selectedPath = path
  workspace.editingPath = path
}

export function endRename(): void {
  workspace.editingPath = null
}

/** Creates a file inside `folderPath`; without a name the tree offers an inline rename. */
export async function createFileIn(folderPath: string, name?: string): Promise<string | null> {
  const trimmed = name?.trim() ?? ''
  try {
    const created = await window.api.fs.createFile(joinPath(folderPath, trimmed || NEW_FILE_NAME))
    expandInto(folderPath)
    await refreshFolder()
    workspace.selectedPath = created
    workspace.editingPath = trimmed ? null : created
    return created
  } catch (error) {
    await reportFailure('新建文件失败', error)
    return null
  }
}

/** Creates a folder inside `folderPath`; without a name the tree offers an inline rename. */
export async function createFolderIn(folderPath: string, name?: string): Promise<string | null> {
  const trimmed = name?.trim() ?? ''
  try {
    const created = await window.api.fs.createFolder(folderPath, trimmed || NEW_FOLDER_NAME)
    expandInto(folderPath)
    await refreshFolder()
    workspace.selectedPath = created
    workspace.editingPath = trimmed ? null : created
    return created
  } catch (error) {
    await reportFailure('新建文件夹失败', error)
    return null
  }
}

/** Renames one entry in place; `nextName` may not contain a path separator. */
export async function renameEntry(path: string, nextName: string): Promise<string | null> {
  const trimmed = nextName.trim()
  if (trimmed === '' || /[\\/]/.test(trimmed)) {
    workspace.editingPath = null
    return null
  }
  const nextPath = joinPath(parentPath(path), trimmed)
  if (normalise(nextPath) === normalise(path)) {
    workspace.editingPath = null
    return path
  }
  try {
    await window.api.fs.rename(path, nextPath)
    syncDocumentPath(path, nextPath)
    remapExpanded(path, nextPath)
    await refreshFolder()
    workspace.selectedPath = nextPath
    workspace.editingPath = null
    return nextPath
  } catch (error) {
    workspace.editingPath = null
    await reportFailure('重命名失败', error)
    return null
  }
}

/** Copies a file next to itself; the main process owns the "- 副本" naming. */
export async function duplicateEntry(path: string): Promise<string | null> {
  try {
    const copy = await window.api.fs.duplicate(path)
    expandInto(parentPath(path))
    await refreshFolder()
    workspace.selectedPath = copy
    return copy
  } catch (error) {
    await reportFailure('创建副本失败', error)
    return null
  }
}

/** Moves an entry into `directory`; the main process rejects a name clash. */
export async function moveEntryTo(path: string, directory: string): Promise<string | null> {
  try {
    const moved = await window.api.fs.moveTo(path, directory)
    syncDocumentPath(path, moved)
    remapExpanded(path, moved)
    expandInto(directory)
    await refreshFolder()
    workspace.selectedPath = moved
    return moved
  } catch (error) {
    await reportFailure('移动失败', error)
    return null
  }
}

/** Deletes one entry after the caller confirmed; the tree refreshes afterwards. */
export async function deleteEntry(path: string): Promise<boolean> {
  try {
    await window.api.fs.remove(path)
    await refreshFolder()
    if (workspace.selectedPath === path) workspace.selectedPath = null
    return true
  } catch (error) {
    await reportFailure('删除失败', error)
    return false
  }
}

/** Shows an entry in the platform file manager. */
export async function revealEntry(path: string): Promise<void> {
  try {
    await window.api.fs.reveal(path)
  } catch (error) {
    await reportFailure('无法在文件管理器中显示', error)
  }
}

let unwatch: (() => void) | null = null

export function installWorkspaceListeners(): void {
  unwatch?.()
  unwatch = window.api.fs.onFolderChanged((node) => {
    if (workspace.root && node.path === workspace.root.path) {
      workspace.root = node
      rebuildRows()
    }
  })
}
