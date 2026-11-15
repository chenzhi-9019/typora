import { reactive, watch } from 'vue'
import { resolveLocale, t, type Locale, type MsgKey } from '@shared/i18n'
import { THEME_LABELS, THEME_NAMES } from '@shared/menu'
import type { EditorSettings } from '@shared/types'
import { settings } from './windowsApi'

/**
 * The preferences window's content, transcribed from Typora's own panel
 * (tmp/typora-app/app/resources/dist/static/js/Preferences.*.js) with the Chinese
 * wording taken from locales/zh-Hans.lproj/Panel.json and the English one from
 * locales/Base.lproj/Panel.json.
 *
 * Every row is a live preference: it reads its `key` out of EditorSettings and writes
 * it back through window.api.settings, so no row is greyed out. A row whose control only
 * makes sense under one value of another setting declares that with `dependsOn` and is
 * hidden — never greyed — while the condition does not hold.
 *
 * The panels follow the order of Typora's own sidebar tab list
 * (`ve=["Files","Editor","Image","Markdown","Export","Appearance","General"]`), minus the
 * file-tree tab this app does not have.
 *
 * The table below is language-neutral: every wording is a key into `shared/i18n`, and
 * `localize()` turns it into the rendered `PANELS` for the current locale. `PANELS` is
 * reactive because the language picker itself lives in this window, so switching it
 * relabels the panel in place instead of waiting for a restart.
 */

export interface PrefOption {
  /** the value stored in EditorSettings once this option is picked */
  value: string
  label: string
}

export interface PrefRow {
  kind: 'checkbox' | 'select' | 'number' | 'text'
  label: string
  key: keyof EditorSettings
  options?: PrefOption[]
  /** the row only shows while `settings[field]` still equals `equals` */
  dependsOn?: { field: keyof EditorSettings; equals: string }
  min?: number
  max?: number
  step?: number
  unit?: string
  placeholder?: string
  /** rendered under this row only */
  hint?: string
}

export interface PrefGroup {
  /** the left, bold column */
  label: string
  /** rendered under the rows */
  hint?: string
  rows: PrefRow[]
}

export interface PrefSection {
  header: string
  groups: PrefGroup[]
}

export interface PrefPanel {
  id: string
  label: string
  sections: PrefSection[]
}

/** A label that reads the same in every language, e.g. the theme names. */
interface RawLiteralOption {
  value: string
  text: string
}

type RawOption = { value: string; label: MsgKey } | RawLiteralOption

interface RawRow {
  kind: PrefRow['kind']
  label: MsgKey
  key: keyof EditorSettings
  options?: RawOption[]
  dependsOn?: { field: keyof EditorSettings; equals: string }
  min?: number
  max?: number
  step?: number
  unit?: string
  /** placeholder that is data, not wording, e.g. a path or a command */
  placeholder?: string
  /** placeholder that has to be translated */
  placeholderText?: MsgKey
  hint?: MsgKey
}

interface RawGroup {
  /** '' marks a group that shows no heading */
  label: MsgKey | ''
  hint?: MsgKey
  rows: RawRow[]
}

interface RawSection {
  header: MsgKey
  groups: RawGroup[]
}

interface RawPanel {
  id: string
  label: MsgKey
  sections: RawSection[]
}

const THEME_OPTIONS: RawOption[] = THEME_NAMES.map((name) => ({
  value: name,
  text: THEME_LABELS[name]
}))

const RAW: RawPanel[] = [
  {
    id: 'editor',
    label: 'prefs.tab.editor',
    sections: [
      {
        header: 'prefs.section.editorBehavior',
        groups: [
          {
            label: '',
            rows: [
              { kind: 'checkbox', label: 'prefs.row.wordWrap', key: 'wordWrap' },
              { kind: 'checkbox', label: 'prefs.row.focusMode', key: 'focusMode' },
              { kind: 'checkbox', label: 'prefs.row.typewriterMode', key: 'typewriterMode' },
              { kind: 'checkbox', label: 'prefs.row.readonlyMode', key: 'readonlyMode' }
            ]
          }
        ]
      },
      {
        header: 'prefs.section.liveRendering',
        groups: [
          {
            label: 'prefs.group.liveRendering',
            hint: 'prefs.hint.liveRendering',
            rows: [
              { kind: 'checkbox', label: 'prefs.row.sourceCodeMode', key: 'sourceCodeMode' },
              {
                kind: 'checkbox',
                label: 'prefs.row.showSourceOfActiveBlock',
                key: 'showSourceOfActiveBlock'
              }
            ]
          }
        ]
      },
      {
        header: 'prefs.section.autoPair',
        groups: [
          {
            label: 'prefs.group.autoPair',
            rows: [
              { kind: 'checkbox', label: 'prefs.row.autoPairBracket', key: 'autoPairBracket' },
              { kind: 'checkbox', label: 'prefs.row.autoPairMarkdown', key: 'autoPairMarkdown' }
            ]
          }
        ]
      },
      {
        header: 'prefs.section.spellCheck',
        groups: [
          {
            label: 'prefs.group.spellCheck',
            rows: [
              { kind: 'checkbox', label: 'prefs.row.spellcheck', key: 'spellcheck' },
              { kind: 'checkbox', label: 'prefs.row.autoCorrect', key: 'autoCorrect' }
            ]
          }
        ]
      },
      {
        header: 'prefs.section.indent',
        groups: [
          {
            label: 'prefs.group.indent',
            hint: 'prefs.hint.indent',
            rows: [
              {
                kind: 'select',
                label: 'prefs.row.indentSize',
                key: 'indentSize',
                options: [
                  { value: '2', label: 'prefs.option.indent2' },
                  { value: '3', label: 'prefs.option.indent3' },
                  { value: '4', label: 'prefs.option.indent4' }
                ]
              }
            ]
          }
        ]
      },
      {
        header: 'prefs.section.copyBehavior',
        groups: [
          {
            label: 'prefs.group.copyBehavior',
            rows: [
              {
                kind: 'checkbox',
                label: 'prefs.row.copyMarkdownOnCopy',
                key: 'copyMarkdownOnCopy'
              }
            ]
          }
        ]
      },
      {
        header: 'prefs.section.autocomplete',
        groups: [
          {
            label: 'prefs.group.autocomplete',
            hint: 'prefs.hint.autocomplete',
            rows: [
              { kind: 'checkbox', label: 'prefs.row.emojiAutocomplete', key: 'emojiAutocomplete' }
            ]
          }
        ]
      },
      {
        header: 'prefs.section.lineEnding',
        groups: [
          {
            label: 'prefs.group.lineEnding',
            hint: 'prefs.hint.lineEnding',
            rows: [
              {
                kind: 'select',
                label: 'prefs.row.eol',
                key: 'eol',
                options: [
                  { value: 'lf', label: 'prefs.option.eolLf' },
                  { value: 'crlf', label: 'prefs.option.eolCrlf' }
                ]
              }
            ]
          }
        ]
      },
      {
        header: 'prefs.section.whitespace',
        groups: [
          {
            label: 'prefs.group.whitespace',
            hint: 'prefs.hint.whitespace',
            rows: [
              { kind: 'checkbox', label: 'prefs.row.indentFirstLine', key: 'indentFirstLine' },
              { kind: 'checkbox', label: 'prefs.row.showBr', key: 'showBr' },
              { kind: 'checkbox', label: 'prefs.row.preserveLineBreak', key: 'preserveLineBreak' }
            ]
          }
        ]
      },
      {
        header: 'prefs.section.smartPunctuation',
        groups: [
          {
            label: 'prefs.group.smartPunctuation',
            hint: 'prefs.hint.smartPunctuation',
            rows: [
              { kind: 'checkbox', label: 'prefs.row.smartPunctuation', key: 'smartPunctuation' },
              { kind: 'checkbox', label: 'prefs.row.remapPunctuation', key: 'remapPunctuation' }
            ]
          }
        ]
      }
    ]
  },
  {
    id: 'image',
    label: 'prefs.tab.image',
    sections: [
      {
        header: 'prefs.section.insertImage',
        groups: [
          {
            label: 'prefs.group.insertImage',
            rows: [
              {
                kind: 'select',
                label: 'prefs.row.insertImageRule',
                key: 'insertImageRule',
                options: [
                  { value: 'none', label: 'prefs.option.insertNone' },
                  { value: 'current', label: 'prefs.option.insertCurrent' },
                  { value: 'assets', label: 'prefs.option.insertAssets' },
                  { value: 'filename', label: 'prefs.option.insertFilename' },
                  { value: 'custom', label: 'prefs.option.insertCustom' }
                ]
              },
              {
                kind: 'text',
                label: 'prefs.row.imageRoot',
                key: 'imageRoot',
                placeholder: './${filename}.assets',
                dependsOn: { field: 'insertImageRule', equals: 'custom' },
                hint: 'prefs.hint.imageRoot'
              }
            ]
          }
        ]
      },
      {
        header: 'prefs.section.applyScope',
        groups: [
          {
            label: '',
            rows: [
              {
                kind: 'checkbox',
                label: 'prefs.row.applyToLocalImages',
                key: 'applyToLocalImages'
              },
              {
                kind: 'checkbox',
                label: 'prefs.row.applyToRemoteImages',
                key: 'applyToRemoteImages'
              }
            ]
          }
        ]
      },
      {
        header: 'prefs.section.upload',
        groups: [
          {
            label: 'prefs.group.upload',
            rows: [
              {
                kind: 'select',
                label: 'prefs.row.uploadService',
                key: 'uploadService',
                options: [
                  { value: 'none', label: 'prefs.option.uploadNone' },
                  { value: 'picgo-app', label: 'prefs.option.picgoApp' },
                  { value: 'picgo-core', label: 'prefs.option.picgoCore' },
                  { value: 'custom', label: 'prefs.option.uploadCustom' }
                ]
              },
              { kind: 'checkbox', label: 'prefs.row.uploadOnInsert', key: 'uploadOnInsert' },
              {
                kind: 'text',
                label: 'prefs.row.uploadCommand',
                key: 'uploadCommand',
                placeholder: 'picgo upload',
                dependsOn: { field: 'uploadService', equals: 'custom' },
                hint: 'prefs.hint.uploadCommand'
              }
            ]
          }
        ]
      },
      {
        header: 'prefs.section.misc',
        groups: [
          {
            label: 'prefs.group.misc',
            hint: 'prefs.hint.escapeImageUrl',
            rows: [{ kind: 'checkbox', label: 'prefs.row.escapeImageUrl', key: 'escapeImageUrl' }]
          }
        ]
      }
    ]
  },
  {
    id: 'markdown',
    label: 'prefs.tab.markdown',
    sections: [
      {
        header: 'prefs.section.strictMode',
        groups: [
          {
            label: '',
            hint: 'prefs.hint.strictMode',
            rows: [{ kind: 'checkbox', label: 'prefs.row.strictMode', key: 'strictMode' }]
          }
        ]
      },
      {
        header: 'prefs.section.syntax',
        groups: [
          {
            label: 'prefs.group.syntax',
            hint: 'prefs.hint.syntax',
            rows: [
              { kind: 'checkbox', label: 'prefs.row.inlineMath', key: 'inlineMath' },
              { kind: 'checkbox', label: 'prefs.row.subscript', key: 'subscript' },
              { kind: 'checkbox', label: 'prefs.row.superscript', key: 'superscript' },
              { kind: 'checkbox', label: 'prefs.row.highlight', key: 'highlight' },
              { kind: 'checkbox', label: 'prefs.row.diagrams', key: 'diagrams' }
            ]
          }
        ]
      },
      {
        header: 'prefs.section.headingStyle',
        groups: [
          {
            label: 'prefs.group.headingStyle',
            rows: [
              {
                kind: 'select',
                label: 'prefs.row.headingStyle',
                key: 'headingStyle',
                options: [
                  { value: 'atx', label: 'prefs.option.headingAtx' },
                  { value: 'setext', label: 'prefs.option.headingSetext' },
                  { value: 'hybrid', label: 'prefs.option.headingHybrid' }
                ]
              }
            ]
          }
        ]
      },
      {
        header: 'prefs.section.math',
        groups: [
          {
            label: 'prefs.group.math',
            hint: 'prefs.hint.math',
            rows: [{ kind: 'checkbox', label: 'prefs.row.autoNumber', key: 'autoNumber' }]
          }
        ]
      },
      {
        header: 'prefs.section.codeFences',
        groups: [
          {
            label: 'prefs.group.codeFences',
            rows: [
              { kind: 'checkbox', label: 'prefs.row.codeLineNumbers', key: 'codeLineNumbers' },
              { kind: 'checkbox', label: 'prefs.row.codeWrap', key: 'codeWrap' }
            ]
          }
        ]
      },
      {
        header: 'prefs.section.syntaxPreference',
        groups: [
          {
            label: 'prefs.group.syntaxPreference',
            hint: 'prefs.hint.syntaxPreference',
            rows: [
              {
                kind: 'select',
                label: 'prefs.row.unorderedMarker',
                key: 'unorderedMarker',
                options: [
                  { value: '-', label: 'prefs.option.markerDash' },
                  { value: '*', label: 'prefs.option.markerStar' },
                  { value: '+', label: 'prefs.option.markerPlus' }
                ]
              },
              {
                kind: 'select',
                label: 'prefs.row.orderedMarker',
                key: 'orderedMarker',
                options: [
                  { value: '.', label: 'prefs.option.markerDot' },
                  { value: ')', label: 'prefs.option.markerParen' }
                ]
              }
            ]
          }
        ]
      }
    ]
  },
  {
    id: 'export',
    label: 'prefs.tab.export',
    sections: [
      {
        header: 'prefs.section.exportFolder',
        groups: [
          {
            label: 'prefs.group.exportFolder',
            hint: 'prefs.hint.exportFolder',
            rows: [
              {
                kind: 'text',
                label: 'prefs.row.exportFolder',
                key: 'exportFolder',
                placeholderText: 'prefs.placeholder.exportFolder',
                hint: 'prefs.hint.exportFolderRow'
              }
            ]
          }
        ]
      },
      {
        header: 'prefs.section.afterExport',
        groups: [
          {
            label: 'prefs.group.afterExport',
            rows: [
              {
                kind: 'select',
                label: 'prefs.row.exportAfter',
                key: 'exportAfter',
                options: [
                  { value: 'none', label: 'prefs.option.uploadNone' },
                  { value: 'reveal', label: 'prefs.option.afterReveal' },
                  { value: 'open', label: 'prefs.option.afterOpen' }
                ]
              }
            ]
          }
        ]
      },
      {
        header: 'prefs.section.pandoc',
        groups: [
          {
            label: 'prefs.group.pandoc',
            hint: 'prefs.hint.pandoc',
            rows: [
              {
                kind: 'text',
                label: 'prefs.row.exportArgs',
                key: 'exportArgs',
                placeholder: '--pdf-engine=xelatex',
                hint: 'prefs.hint.exportArgs'
              },
              {
                kind: 'checkbox',
                label: 'prefs.row.exportShowCommandOutput',
                key: 'exportShowCommandOutput'
              }
            ]
          }
        ]
      },
      {
        header: 'prefs.section.exportExtensions',
        groups: [
          {
            label: 'prefs.group.exportExtensions',
            rows: [
              {
                kind: 'checkbox',
                label: 'prefs.row.exportKeepExtensions',
                key: 'exportKeepExtensions'
              }
            ]
          }
        ]
      },
      {
        header: 'prefs.section.saveDialog',
        groups: [
          {
            label: 'prefs.group.saveDialog',
            rows: [
              {
                kind: 'checkbox',
                label: 'prefs.row.exportNoDialog',
                key: 'exportNoDialog'
              }
            ]
          }
        ]
      }
    ]
  },
  {
    id: 'appearance',
    label: 'prefs.tab.appearance',
    sections: [
      {
        header: 'prefs.section.windowStyle',
        groups: [
          {
            label: 'prefs.group.windowStyle',
            hint: 'prefs.hint.windowStyle',
            rows: [
              {
                kind: 'select',
                label: 'prefs.row.windowStyle',
                key: 'windowStyle',
                options: [
                  { value: 'classic', label: 'prefs.option.classic' },
                  { value: 'seamless', label: 'prefs.option.seamless' }
                ]
              }
            ]
          }
        ]
      },
      {
        header: 'prefs.section.statusBar',
        groups: [
          {
            label: '',
            rows: [
              { kind: 'checkbox', label: 'prefs.row.showStatusBar', key: 'showStatusBar' },
              { kind: 'checkbox', label: 'prefs.row.showToolbar', key: 'showToolbar' }
            ]
          }
        ]
      },
      {
        header: 'prefs.section.typography',
        groups: [
          {
            label: 'prefs.group.content',
            hint: 'prefs.hint.content',
            rows: [
              {
                kind: 'number',
                label: 'prefs.row.lineHeight',
                key: 'lineHeight',
                min: 0,
                max: 3,
                step: 0.1
              },
              {
                kind: 'number',
                label: 'prefs.row.maxWidth',
                key: 'maxWidth',
                min: 0,
                max: 2000,
                unit: 'px'
              }
            ]
          },
          {
            label: 'prefs.group.leftPanel',
            rows: [
              {
                kind: 'number',
                label: 'prefs.row.sidebarWidth',
                key: 'sidebarWidth',
                min: 120,
                max: 600,
                unit: 'px'
              }
            ]
          }
        ]
      },
      {
        header: 'prefs.section.advanced',
        groups: [
          {
            label: 'prefs.group.advanced',
            hint: 'prefs.hint.advanced',
            rows: [{ kind: 'checkbox', label: 'prefs.row.debugMode', key: 'debugMode' }]
          }
        ]
      }
    ]
  },
  {
    id: 'general',
    label: 'prefs.tab.general',
    sections: [
      {
        header: 'prefs.section.themes',
        groups: [
          {
            label: 'prefs.group.themes',
            hint: 'prefs.hint.themes',
            rows: [
              { kind: 'select', label: 'prefs.row.theme', key: 'theme', options: THEME_OPTIONS }
            ]
          }
        ]
      },
      {
        header: 'prefs.section.wordCount',
        groups: [
          {
            label: 'prefs.group.fontSize',
            hint: 'prefs.hint.fontSize',
            rows: [
              {
                kind: 'number',
                label: 'prefs.row.fontSize',
                key: 'fontSize',
                min: 0,
                max: 96,
                unit: 'px'
              }
            ]
          },
          {
            label: 'prefs.group.wordCount',
            rows: [
              {
                kind: 'checkbox',
                label: 'prefs.row.alwaysShowWordCount',
                key: 'alwaysShowWordCount'
              }
            ]
          }
        ]
      },
      {
        header: 'prefs.section.leftPanel',
        groups: [
          {
            label: 'prefs.group.leftPanel',
            hint: 'prefs.hint.leftPanel',
            rows: [
              { kind: 'checkbox', label: 'prefs.row.sidebarVisible', key: 'sidebarVisible' },
              {
                kind: 'select',
                label: 'prefs.row.sidebarTab',
                key: 'sidebarTab',
                options: [
                  { value: 'files', label: 'prefs.option.tabFiles' },
                  { value: 'outline', label: 'prefs.option.tabOutline' },
                  { value: 'search', label: 'prefs.option.tabSearch' }
                ]
              },
              {
                kind: 'checkbox',
                label: 'prefs.row.collapsibleOutline',
                key: 'collapsibleOutline'
              },
              {
                kind: 'checkbox',
                label: 'prefs.row.autoSaveOnSwitch',
                key: 'autoSaveOnSwitch'
              }
            ]
          }
        ]
      },
      {
        header: 'prefs.section.language',
        groups: [
          {
            label: 'prefs.group.language',
            hint: 'prefs.hint.language',
            rows: [
              {
                kind: 'select',
                label: 'prefs.row.language',
                key: 'language',
                options: [
                  { value: 'system', label: 'prefs.option.systemLanguage' },
                  { value: 'zh-Hans', label: 'prefs.option.zhHans' },
                  { value: 'en', label: 'prefs.option.en' }
                ]
              }
            ]
          }
        ]
      },
      {
        header: 'prefs.section.startup',
        groups: [
          {
            label: 'prefs.group.startup',
            hint: 'prefs.hint.startup',
            rows: [
              {
                kind: 'select',
                label: 'prefs.row.startupMode',
                key: 'startupMode',
                options: [
                  { value: 'new', label: 'prefs.option.startupNew' },
                  { value: 'folder', label: 'prefs.option.startupFolder' },
                  { value: 'recent', label: 'prefs.option.startupRecent' },
                  { value: 'custom', label: 'prefs.option.startupCustom' }
                ]
              },
              {
                kind: 'text',
                label: 'prefs.row.startupFolder',
                key: 'startupFolder',
                placeholder: 'D:\\notes',
                dependsOn: { field: 'startupMode', equals: 'custom' },
                hint: 'prefs.hint.startupFolder'
              }
            ]
          }
        ]
      },
      {
        header: 'prefs.section.quit',
        groups: [
          {
            label: 'prefs.group.quit',
            rows: [{ kind: 'checkbox', label: 'prefs.row.autoQuit', key: 'autoQuit' }]
          }
        ]
      },
      {
        header: 'prefs.section.window',
        groups: [
          {
            label: 'prefs.group.window',
            rows: [
              { kind: 'checkbox', label: 'prefs.row.autoHideMenuBar', key: 'autoHideMenuBar' },
              { kind: 'checkbox', label: 'prefs.row.alwaysOnTop', key: 'alwaysOnTop' }
            ]
          }
        ]
      }
    ]
  }
]

function localize(locale: Locale): [PrefPanel, ...PrefPanel[]] {
  const option = (raw: RawOption): PrefOption =>
    'label' in raw
      ? { value: raw.value, label: t(locale, raw.label) }
      : { value: raw.value, label: raw.text }

  const row = (raw: RawRow): PrefRow => {
    const rendered: PrefRow = {
      kind: raw.kind,
      label: t(locale, raw.label),
      key: raw.key
    }
    if (raw.options) rendered.options = raw.options.map(option)
    if (raw.dependsOn) rendered.dependsOn = raw.dependsOn
    if (raw.min !== undefined) rendered.min = raw.min
    if (raw.max !== undefined) rendered.max = raw.max
    if (raw.step !== undefined) rendered.step = raw.step
    if (raw.unit !== undefined) rendered.unit = raw.unit
    if (raw.placeholder !== undefined) rendered.placeholder = raw.placeholder
    if (raw.placeholderText !== undefined) rendered.placeholder = t(locale, raw.placeholderText)
    if (raw.hint !== undefined) rendered.hint = t(locale, raw.hint)
    return rendered
  }

  const panel = (raw: RawPanel): PrefPanel => ({
    id: raw.id,
    label: t(locale, raw.label),
    sections: raw.sections.map((section) => ({
      header: t(locale, section.header),
      groups: section.groups.map((group) => ({
        label: group.label === '' ? '' : t(locale, group.label),
        hint: group.hint === undefined ? undefined : t(locale, group.hint),
        rows: group.rows.map(row)
      }))
    }))
  })

  return RAW.map(panel) as [PrefPanel, ...PrefPanel[]]
}

const currentLocale = (): Locale => resolveLocale(settings.language, navigator.languages)

/** Rendered panels; spliced in place when the locale changes so identity is stable. */
export const PANELS = reactive(localize(currentLocale())) as [PrefPanel, ...PrefPanel[]]

watch(currentLocale, (locale) => {
  PANELS.splice(0, PANELS.length, ...localize(locale))
})
