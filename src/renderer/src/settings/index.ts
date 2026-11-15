import { watch } from 'vue'
import { settings } from '@renderer/stores/settings'
import { ActiveBlockSource } from './active-block'
import { EmojiAutocomplete } from './autocomplete'
import { installAutoSaveOnSwitch } from './auto-save'
import { installCopyMarkdown } from './copy-markdown'
import { CollapsibleOutline } from './outline-fold'
import { ensureEffectsStyle, removeEffectsStyle } from './styles'

/**
 * Everything the effects layer needs from the shell. `App.vue` builds this object next to
 * the `CommandContext` it already has:
 *
 * ```ts
 * const disposeSettings = installSettingsEffects({
 *   root: document.querySelector('.typora-app'),
 *   getEditor: () => editor.value,
 *   setDialog: (next) => { dialog.value = next },
 *   patchSettings: (patch) => patchSettings(patch as Partial<EditorSettings>)
 * })
 * ```
 */
export interface SettingsEffectsContext {
  /** `.typora-app`; effects that live on the shell hang their classes on it. */
  root: HTMLElement | null
  getEditor: () => {
    setOptions(patch: Record<string, unknown>): void
    getValue(): string
  } | null
  setDialog: (dialog: 'none' | 'quickOpen' | 'wordCount') => void
  patchSettings: (patch: Record<string, unknown>) => Promise<void>
}

/**
 * Watches the persisted settings and drives the parts of the UI they own — classes on
 * `.typora-app`, the word-count overlay, the source line of the active block, the emoji
 * popup, the foldable outline, copy-as-markdown, auto-save on switch and `indentSize`.
 *
 * @returns the teardown that removes every listener, class and injected style.
 */
export function installSettingsEffects(ctx: SettingsEffectsContext): () => void {
  const ownerDocument = (): Document => ctx.root?.ownerDocument ?? document
  const resolveRoot = (): HTMLElement | null =>
    ctx.root ?? document.querySelector<HTMLElement>('.typora-app')
  const writeRoot = (): HTMLElement | null =>
    resolveRoot()?.querySelector<HTMLElement>('#write') ??
    document.querySelector<HTMLElement>('#write')

  const autocomplete = new EmojiAutocomplete({ resolveRoot, writeRoot })
  const activeBlock = new ActiveBlockSource(writeRoot)
  const outline = new CollapsibleOutline(resolveRoot)
  const removeCopyHandler = installCopyMarkdown(() => settings.copyMarkdownOnCopy, writeRoot)
  const stopAutoSave = installAutoSaveOnSwitch(() => settings.autoSaveOnSwitch)

  let wordCountOwned = false
  let debugLogged = false
  let mounted: MutationObserver | null = null

  const stopMountObserver = (): void => {
    mounted?.disconnect()
    mounted = null
  }

  /** The editor mounts after the first settings load; wait for it before wiring the DOM. */
  const ensureMounted = (): void => {
    if (mounted || !document.body) return
    if (resolveRoot() !== null && writeRoot() !== null) return
    mounted = new MutationObserver(() => {
      if (resolveRoot() === null || writeRoot() === null) return
      stopMountObserver()
      apply()
    })
    mounted.observe(document.body, { subtree: true, childList: true })
  }

  function apply(): void {
    ensureEffectsStyle(ownerDocument())

    const root = resolveRoot()
    if (root) {
      const style = settings.windowStyle
      root.classList.toggle('window-style-classic', style === 'classic')
      root.classList.toggle('window-style-seamless', style === 'seamless')
      root.classList.toggle('debug-mode', settings.debugMode)
      root.classList.toggle('collapsible-outline', settings.collapsibleOutline)
      root.style.setProperty('--ty-indent-size', String(settings.indentSize))
    }

    const write = writeRoot()
    if (write) write.classList.toggle('indent-first-line', settings.indentFirstLine)
    ctx.getEditor()?.setOptions({ indentSize: settings.indentSize })

    if (settings.alwaysShowWordCount) {
      wordCountOwned = true
      ctx.setDialog('wordCount')
    } else if (wordCountOwned) {
      wordCountOwned = false
      ctx.setDialog('none')
    }

    if (settings.showSourceOfActiveBlock) activeBlock.attach()
    else activeBlock.detach()
    if (settings.collapsibleOutline) outline.attach()
    else outline.detach()
    if (settings.emojiAutocomplete) autocomplete.attach()
    else autocomplete.detach()

    if (settings.debugMode && !debugLogged) {
      debugLogged = true
      console.log('[settings] snapshot', { ...settings })
    } else if (!settings.debugMode && debugLogged) {
      debugLogged = false
      console.log('[settings] debug mode off')
    }

    ensureMounted()
  }

  const stopWatch = watch(settings, apply, { deep: true, immediate: true })

  return () => {
    stopWatch()
    stopMountObserver()
    stopAutoSave()
    removeCopyHandler()
    autocomplete.detach()
    activeBlock.detach()
    outline.detach()
    const root = resolveRoot()
    root?.classList.remove(
      'window-style-classic',
      'window-style-seamless',
      'debug-mode',
      'collapsible-outline'
    )
    root?.style.removeProperty('--ty-indent-size')
    writeRoot()?.classList.remove('indent-first-line')
    if (wordCountOwned) {
      wordCountOwned = false
      ctx.setDialog('none')
    }
    removeEffectsStyle(ownerDocument())
  }
}

export {
  attachImage,
  escapeImageUrl,
  insertImageSource,
  isRemoteImage,
  shouldApplyImageRule,
  uploadImage
} from './images'
export { resolveExportPath, type ExportTargetRequest } from './export-path'
export { startupPlan, type StartupPlan } from './startup'
