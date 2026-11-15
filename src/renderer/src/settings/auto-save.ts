import { watch } from 'vue'
import { activeTabId, doc, tabs } from '@renderer/stores/document'

interface TrackedDocument {
  id: string
  path: string | null
  content: string
  saved: string
}

/**
 * `autoSaveOnSwitch`: writes the outgoing document before a tab or file switch replaces it.
 *
 * The stores swap `doc` in place, so the state of the leaving document is tracked here and
 * flushed the moment its id or path changes.
 */
export function installAutoSaveOnSwitch(isEnabled: () => boolean): () => void {
  let tracked: TrackedDocument = {
    id: activeTabId.value,
    path: doc.path,
    content: doc.content,
    saved: doc.saved
  }

  const stopContent = watch(
    () => [doc.content, doc.saved] as const,
    () => {
      // a switch swaps `doc` in place; that write belongs to the outgoing document
      if (activeTabId.value !== tracked.id || doc.path !== tracked.path) return
      tracked.content = doc.content
      tracked.saved = doc.saved
    }
  )

  const stopSwitch = watch(
    () => [activeTabId.value, doc.path] as const,
    ([id, path]) => {
      if (id === tracked.id && path === tracked.path) return
      const outgoing = tracked
      tracked = { id, path, content: doc.content, saved: doc.saved }
      if (!isEnabled() || outgoing.path === null) return
      if (outgoing.content === outgoing.saved) return
      void persist(outgoing)
    }
  )

  return () => {
    stopContent()
    stopSwitch()
  }
}

async function persist(outgoing: TrackedDocument): Promise<void> {
  const path = outgoing.path
  if (path === null) return
  try {
    await window.api.fs.writeFile(path, outgoing.content)
  } catch (error) {
    console.warn('[settings] autoSaveOnSwitch: write failed :: ' + String(error))
    return
  }
  const tab = tabs.find((entry) => entry.id === outgoing.id)
  if (tab) tab.saved = outgoing.content
  if (activeTabId.value === outgoing.id) doc.saved = outgoing.content
}
