import type { EditorSettings } from '../shared/types'

/** CRLF is normalised away first, so CRLF mode can never emit `\r\r\n`. */
export function applyEol(text: string, eol: EditorSettings['eol']): string {
  const normalized = text.replace(/\r\n/g, '\n')
  return eol === 'crlf' ? normalized.replace(/\n/g, '\r\n') : normalized
}
