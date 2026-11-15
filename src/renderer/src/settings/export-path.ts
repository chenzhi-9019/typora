import { settings } from '@renderer/stores/settings'
import { joinPath, splitPath, stripExtension } from './paths'

export interface ExportTargetRequest {
  /** Path of the document being exported; '' for an untitled document. */
  suggestedPath: string
  /** Target format without a dot: 'pdf', 'html', 'docx', ... */
  format: string
}

/**
 * `exportFolder` / `exportKeepExtensions` / `exportNoDialog` / `exportAfter`: where an
 * export lands, and what the caller does with it.
 *
 * Caller contract:
 * 1. `const path = resolveExportPath({ suggestedPath: doc.path ?? '', format })`
 * 2. `exportNoDialog` true -> write straight to `path`; false -> open the save dialog with
 *    `path` as its `defaultPath` and use what the dialog returns.
 * 3. `exportAfter` 'reveal' -> `window.api.fs.reveal(path)`; 'open' ->
 *    `window.api.app.openExternal(path)`; 'none' -> nothing.
 */
export function resolveExportPath(request: ExportTargetRequest): string {
  const suggested = request.suggestedPath.trim()
  const { dir, name } = splitPath(suggested)
  const format = request.format.trim().replace(/^\./, '').toLowerCase()
  const base =
    name === '' ? 'Untitled' : settings.exportKeepExtensions ? name : stripExtension(name)
  const fileName = format === '' ? base : base + '.' + format
  const folder = settings.exportFolder.trim() || dir
  return joinPath(folder, fileName)
}
