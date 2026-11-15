/**
 * Presentation owned by the settings-effects layer.
 *
 * The rules live here — injected at install time — instead of under
 * `src/renderer/src/styles/**` so the effects stay a single deletable unit.
 */
export const SETTINGS_EFFECTS_STYLE_ID = 'typora-settings-effects'

export const SETTINGS_EFFECTS_CSS = [
  /* indentSize + indentFirstLine: the editor only adds the class, the width is ours. */
  '#write.indent-first-line > p,',
  '#write.indent-first-line > ul > li > p,',
  '#write.indent-first-line > ol > li > p,',
  '#write.indent-first-line > blockquote > p {',
  '  text-indent: calc(var(--ty-indent-size, 2) * 1ch);',
  '}',
  '',
  /* showSourceOfActiveBlock: the markdown source rides on the block as an attribute
     and is painted by a pseudo element, so the editor DOM is never touched. */
  '.md-focus[data-ty-source]::before {',
  '  content: attr(data-ty-source);',
  '  display: block;',
  '  margin: 0 0 0.15em;',
  '  padding-left: 0.55em;',
  '  border-left: 2px solid currentColor;',
  '  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;',
  '  font-size: 0.82em;',
  '  line-height: 1.5;',
  '  white-space: pre-wrap;',
  '  opacity: 0.55;',
  '  pointer-events: none;',
  '  user-select: none;',
  '}',
  '',
  /* emojiAutocomplete */
  '.typora-emoji-popup {',
  '  position: fixed;',
  '  z-index: 9500;',
  '  min-width: 150px;',
  '  max-height: 220px;',
  '  overflow: auto;',
  '  padding: 4px;',
  '  border: 1px solid rgba(128, 128, 128, 0.45);',
  '  border-radius: 6px;',
  '  background: var(--bg-color, #fff);',
  '  color: var(--text-color, #1f2328);',
  '  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.18);',
  '  font: 13px/1.6 system-ui, -apple-system, Segoe UI, sans-serif;',
  '}',
  '',
  '.typora-emoji-popup .emoji-candidate {',
  '  display: flex;',
  '  gap: 8px;',
  '  align-items: center;',
  '  padding: 2px 6px;',
  '  border-radius: 4px;',
  '  cursor: pointer;',
  '}',
  '',
  '.typora-emoji-popup .emoji-candidate.active {',
  '  background: rgba(128, 128, 128, 0.22);',
  '}',
  '',
  '.typora-emoji-popup .emoji-shortcode {',
  '  opacity: 0.6;',
  '  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;',
  '}',
  '',
  /* collapsibleOutline */
  '.collapsible-outline .outline-item {',
  '  display: flex;',
  '  align-items: center;',
  '  gap: 2px;',
  '}',
  '',
  '.outline-fold-toggle {',
  '  flex: 0 0 auto;',
  '  width: 12px;',
  '  padding: 0;',
  '  border: 0;',
  '  background: transparent;',
  '  color: inherit;',
  '  font-size: 9px;',
  '  line-height: 1;',
  '  opacity: 0.65;',
  '  cursor: pointer;',
  '}',
  '',
  ".outline-fold-toggle::before { content: '▾'; }",
  ".outline-fold-toggle[aria-expanded='false']::before { content: '▸'; }",
  '',
  /* debugMode: a corner marker so the flag is visible without the console. */
  '.debug-mode::after {',
  "  content: 'debug';",
  '  position: fixed;',
  '  right: 6px;',
  '  bottom: 4px;',
  '  z-index: 9600;',
  '  font: 10px/1 ui-monospace, monospace;',
  '  opacity: 0.5;',
  '  pointer-events: none;',
  '}',
  ''
].join('\n')

/** Idempotently adds the effects stylesheet to `doc`. */
export function ensureEffectsStyle(doc: Document): void {
  if (doc.getElementById(SETTINGS_EFFECTS_STYLE_ID)) return
  const style = doc.createElement('style')
  style.id = SETTINGS_EFFECTS_STYLE_ID
  style.textContent = SETTINGS_EFFECTS_CSS
  doc.head.appendChild(style)
}

export function removeEffectsStyle(doc: Document): void {
  doc.getElementById(SETTINGS_EFFECTS_STYLE_ID)?.remove()
}
