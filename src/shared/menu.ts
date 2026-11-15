import type { EditorSettings } from './types'

/**
 * The application menu, transcribed from Typora 1.14.15.
 *
 * Top-level labels carry the accelerator suffix as literal text ("文件(F)") because
 * Chromium strips "(&F)" from rendered CJK menu titles — Typora's own build shows the
 * parentheses, so they have to be part of the string. `labelEn` carries the English
 * wording of the same command (`File(&F)`); the main process picks one by the
 * resolved `settings.language`.
 *
 * Source of truth: the label strings recovered from the main process bytecode
 * (`atom.compiled.dist.jsc`, constant pool) give the item order, accelerators and
 * nesting; `resources/locales/zh-Hans.lproj/Menu.json` gives the Chinese wording.
 * Both live under tmp/ after unpacking and are not shipped.
 *
 * Every entry carries the id the renderer receives through `menu:command`.
 */

export type MenuItemKind = 'normal' | 'separator' | 'checkbox' | 'radio'

export type MenuRole = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll' | 'toggleDevTools'

export interface MenuItem {
  /** command id sent to the renderer; 'separator' for rules */
  id: string
  label: string
  /** English wording, used when settings.language resolves to `en` */
  labelEn: string
  accelerator?: string
  kind?: MenuItemKind
  role?: MenuRole
  /** checkbox / radio items reflect this settings field */
  setting?: keyof EditorSettings
  submenu?: MenuItem[]
}

export interface TopMenu {
  id: string
  label: string
  labelEn: string
  items: MenuItem[]
}

const sep: MenuItem = { id: 'separator', label: '', labelEn: '', kind: 'separator' }

const ENCODINGS: string[] = [
  'UTF-8',
  'UTF-16 LE',
  'UTF-16 BE',
  'Western (windows-1252)',
  'Cyrillic (windows-1251)',
  'Cyrillic (ISO-8859-2)',
  'Cyrillic (IBM866)',
  'Cyrillic (IBM855)',
  'Cyrillic (KOI8-R)',
  'Cyrillic (MacCyrillic)',
  'Central European (windows-1250)',
  'Central European (ISO-8859-2)',
  'Greek (windows-1253)',
  'Greek (ISO-8859-7)',
  'Hebrew (windows-1255)',
  'Hebrew (ISO-8859-8)',
  'Chinese Simplified (GB2312)',
  'Chinese Simplified (GB18030)',
  'Chinese Traditional (Big5)',
  'Japanese (SHIFT_JIS)',
  'Japanese (EUC-JP)',
  'Korean (EUC-KR)',
  'Thai (TIS-620)'
]

const ALERTS: MenuItem[] = [
  { id: 'paragraph.alertNote', label: '提醒内容', labelEn: 'Note Block' },
  { id: 'paragraph.alertTip', label: '建议内容', labelEn: 'Tip Block' },
  { id: 'paragraph.alertImportant', label: '重要内容', labelEn: 'Important Block' },
  { id: 'paragraph.alertWarning', label: '警告内容', labelEn: 'Warning Block' },
  { id: 'paragraph.alertCaution', label: '注意内容', labelEn: 'Caution Block' }
]

const IMAGE_ZOOMS = ['25%', '33%', '50%', '67%', '80%', '100%']

export const THEME_NAMES = ['github', 'night', 'newsprint', 'pixyll', 'whitey'] as const

export const THEME_LABELS: Record<string, string> = {
  github: 'Github',
  night: 'Night',
  newsprint: 'Newsprint',
  pixyll: 'Pixyll',
  whitey: 'Whitey'
}

export const MENU: TopMenu[] = [
  {
    id: 'file',
    label: '文件(F)', labelEn: 'File(&F)',
    items: [
      { id: 'file.new', label: '新建', labelEn: 'New', accelerator: 'CmdOrCtrl+N' },
      { id: 'file.newTab', label: '新建标签页', labelEn: 'New Tab', accelerator: 'CmdOrCtrl+T' },
      { id: 'file.newWindow', label: '新建窗口', labelEn: 'New Window', accelerator: 'CmdOrCtrl+Shift+N' },
      { id: 'file.open', label: '打开', labelEn: 'Open', accelerator: 'CmdOrCtrl+O' },
      { id: 'file.openFolder', label: '打开文件夹', labelEn: 'Open Folder' },
      { id: 'file.quickOpen', label: '快速打开', labelEn: 'Open Quickly', accelerator: 'CmdOrCtrl+P' },
      {
        id: 'file.openRecent',
        label: '打开最近文件', labelEn: 'Open Recent',
        submenu: [
          { id: 'file.recentLocations', label: '最近使用的目录', labelEn: 'Recent Locations' },
          { id: 'file.clearRecent', label: '清除最近文件', labelEn: 'Clear Items' }
        ]
      },
      {
        id: 'file.reopenEncoding',
        label: '选择编码重新打开', labelEn: 'Reopen with Encoding',
        submenu: ENCODINGS.map((name) => ({
          id: 'file.reopenEncoding:' + name,
          label: name, labelEn: name
        }))
      },
      { id: 'file.reloadFromDisk', label: '从磁盘重新加载', labelEn: 'Reload from Disk' },
      sep,
      { id: 'file.save', label: '保存', labelEn: 'Save', accelerator: 'CmdOrCtrl+S' },
      { id: 'file.saveAs', label: '另存为', labelEn: 'Save As', accelerator: 'CmdOrCtrl+Shift+S' },
      { id: 'file.saveAll', label: '保存全部打开的文件', labelEn: 'Save All' },
      sep,
      { id: 'file.openFileLocation', label: '打开文件位置', labelEn: 'Open File Location' },
      { id: 'file.revealInSidebar', label: '在侧边栏中显示', labelEn: 'Reveal in Sidebar' },
      sep,
      { id: 'file.import', label: '导入', labelEn: 'Import' },
      {
        id: 'file.export',
        label: '导出', labelEn: 'Export',
        accelerator: 'Shift+Alt+P',
        submenu: [
          { id: 'export.html', label: 'HTML', labelEn: 'HTML' },
          { id: 'export.pdf', label: 'PDF', labelEn: 'PDF' },
          { id: 'export.image', label: '图像', labelEn: 'Image' },
          { id: 'export.docx', label: 'Word (.docx)', labelEn: 'Word (.docx)' },
          { id: 'export.epub', label: 'ePub', labelEn: 'ePub' },
          { id: 'export.latex', label: 'LaTeX', labelEn: 'LaTeX' },
          { id: 'export.rst', label: 'reStructuredText', labelEn: 'reStructuredText' },
          { id: 'export.textile', label: 'Textile', labelEn: 'Textile' },
          { id: 'export.opml', label: 'OPML', labelEn: 'OPML' },
          { id: 'export.rtf', label: 'RTF', labelEn: 'RTF' },
          { id: 'export.mediawiki', label: 'MediaWiki', labelEn: 'MediaWiki' },
          { id: 'export.org', label: 'Org', labelEn: 'Org' }
        ]
      },
      sep,
      { id: 'file.preferences', label: '偏好设置…', labelEn: 'Preferences…', accelerator: 'CmdOrCtrl+,' },
      { id: 'file.close', label: '关闭', labelEn: 'Close', accelerator: 'CmdOrCtrl+Shift+W' },
      sep,
      { id: 'file.newFile', label: '新建文件', labelEn: 'New File' },
      { id: 'file.newFolder', label: '新建文件夹', labelEn: 'New Folder' },
      { id: 'file.rename', label: '重命名', labelEn: 'Rename', accelerator: 'F2' },
      { id: 'file.duplicate', label: '创建副本', labelEn: 'Duplicate' },
      { id: 'file.moveTo', label: '移动到', labelEn: 'Move To' },
      { id: 'file.copyPath', label: '复制文件路径', labelEn: 'Copy File Path' },
      { id: 'file.openInNewWindow', label: '在新窗口中打开', labelEn: 'Open in New Window' },
      sep,
      { id: 'file.pageSetup', label: '页面设置', labelEn: 'Page Setup' },
      { id: 'file.print', label: '打印', labelEn: 'Print', accelerator: 'CmdOrCtrl+P' },
      sep,
      { id: 'app.quit', label: '退出', labelEn: 'Exit', accelerator: 'CmdOrCtrl+Q' }
    ]
  },
  {
    id: 'edit',
    label: '编辑(E)', labelEn: 'Edit(&E)',
    items: [
      { id: 'edit.undo', label: '撤消', labelEn: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
      { id: 'edit.redo', label: '重做', labelEn: 'Redo', accelerator: 'CmdOrCtrl+Y', role: 'redo' },
      sep,
      { id: 'edit.cut', label: '剪切', labelEn: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' },
      { id: 'edit.copy', label: '复制', labelEn: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
      { id: 'edit.paste', label: '粘贴', labelEn: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' },
      { id: 'edit.copyImage', label: '拷贝图片', labelEn: 'Copy Image Content' },
      { id: 'edit.copyPlain', label: '复制为纯文本', labelEn: 'Copy as Plain Text' },
      { id: 'edit.copyMarkdown', label: '复制为 Markdown', labelEn: 'Copy as Markdown', accelerator: 'CmdOrCtrl+Shift+C' },
      { id: 'edit.copyHtml', label: '复制为 HTML 代码', labelEn: 'Copy as HTML Code' },
      { id: 'edit.copySemantic', label: '复制内容并简化格式', labelEn: 'Copy without Theme Styling' },
      sep,
      { id: 'edit.pastePlain', label: '粘贴为纯文本', labelEn: 'Paste as Plain Text', accelerator: 'CmdOrCtrl+Shift+V' },
      sep,
      { id: 'edit.selectAll', label: '全选', labelEn: 'Select All', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
      { id: 'edit.selectBlock', label: '选择段落或块', labelEn: 'Select Paragraph / Block', accelerator: 'CmdOrCtrl+Alt+P' },
      { id: 'edit.selectLine', label: '选中当前行或句', labelEn: 'Select Line / Sentence', accelerator: 'CmdOrCtrl+L' },
      { id: 'edit.selectPhrase', label: '选中当前格式文本', labelEn: 'Select Styled Scope', accelerator: 'CmdOrCtrl+E' },
      { id: 'edit.selectWord', label: '选中当前词', labelEn: 'Select Word', accelerator: 'CmdOrCtrl+D' },
      sep,
      {
        id: 'edit.jumpTo',
        label: '跳转到', labelEn: 'Jump To',
        submenu: [
          { id: 'edit.jumpTop', label: '跳转到文首', labelEn: 'Jump to Top', accelerator: 'Ctrl+Home' },
          { id: 'edit.jumpSelection', label: '跳转到所选内容', labelEn: 'Jump to Selection', accelerator: 'CmdOrCtrl+J' },
          { id: 'edit.jumpBottom', label: '跳转到文末', labelEn: 'Jump to Bottom', accelerator: 'Ctrl+End' },
          sep,
          { id: 'edit.jumpLineStart', label: '跳转到行首', labelEn: 'Jump to Line Start', accelerator: 'Home' },
          { id: 'edit.jumpLineEnd', label: '跳转到行尾', labelEn: 'Jump to Line End', accelerator: 'End' },
          sep,
          { id: 'edit.extendTop', label: '扩展选中到文首', labelEn: 'Extend Selection to Top', accelerator: 'Ctrl+Shift+Home' },
          { id: 'edit.extendBottom', label: '扩展选中到文末', labelEn: 'Extend Selection to Bottom', accelerator: 'Ctrl+Shift+End' },
          { id: 'edit.extendLineStart', label: '扩展选中到行首', labelEn: 'Extend Selection to Line Start', accelerator: 'Shift+Home' },
          { id: 'edit.extendLineEnd', label: '扩展选中到行尾', labelEn: 'Extend Selection to End of Line', accelerator: 'Shift+End' }
        ]
      },
      sep,
      { id: 'edit.delete', label: '删除', labelEn: 'Delete' },
      { id: 'edit.deleteRange', label: '删除范围', labelEn: 'Delete Range' },
      {
        id: 'edit.deleteBlock',
        label: '删除块', labelEn: 'Delete Block',
        accelerator: 'Shift+CmdOrCtrl+Alt+P'
      },
      {
        id: 'edit.deleteLine',
        label: '删除当前行或句', labelEn: 'Delete Line / Sentence',
        accelerator: 'Shift+CmdOrCtrl+Alt+L'
      },
      {
        id: 'edit.deleteScope',
        label: '删除当前格式文本', labelEn: 'Delete Styled Scope',
        accelerator: 'Shift+CmdOrCtrl+Alt+E'
      },
      { id: 'edit.deleteWord', label: '删除当前词', labelEn: 'Delete Word', accelerator: 'Shift+Ctrl+D' },
      sep,
      {
        id: 'edit.mathTools',
        label: '数学工具', labelEn: 'Math Tools',
        submenu: [{ id: 'edit.refreshMath', label: '刷新所有数学公式', labelEn: 'Refresh All Math Expressions' }]
      },
      {
        id: 'edit.smartPunctuation',
        label: '智能标点', labelEn: 'Smart Punctuation',
        submenu: [
          { id: 'edit.smartOnInput', label: '输入时转换', labelEn: 'Convert on Input' },
          { id: 'edit.smartOnRender', label: '渲染时转换', labelEn: 'Convert on Rendering' },
          sep,
          { id: 'edit.smartQuotes', label: '智能引号', labelEn: 'Smart Quotes' },
          { id: 'edit.smartDashes', label: '智能破折号', labelEn: 'Smart Dashes' },
          { id: 'edit.remapPunctuation', label: '解析 Markdown 时允许并转化 Unicode 标点', labelEn: 'Remap Unicode Punctuation on Parse' }
        ]
      },
      {
        id: 'edit.whitespace',
        label: '空格与换行', labelEn: 'Whitespace and Line Breaks',
        submenu: [
          {
            id: 'edit.lineEndings',
            label: '换行符', labelEn: 'Line Endings',
            submenu: [
              { id: 'edit.lineEndingCrlf', label: 'Windows 换行符 (CRLF)', labelEn: 'Windows Line Endings (CRLF)' },
              { id: 'edit.lineEndingLf', label: 'Unix 换行符 (LF)', labelEn: 'Unix Line Endings (LF)' }
            ]
          },
          { id: 'edit.finalNewline', label: '保存时在文末添加空行', labelEn: 'Insert Final New Line On Save' },
          sep,
          { id: 'edit.showBr', label: '显示 <br/>', labelEn: 'Visible <br/>' },
          { id: 'edit.preserveLineBreak', label: '保留单换行符', labelEn: 'Preserve single line break' },
          { id: 'edit.indentFirstLine', label: '首行缩进', labelEn: 'Indent first line of paragraphs' }
        ]
      },
      sep,
      { id: 'edit.find', label: '查找和替换', labelEn: 'Find and Replace', accelerator: 'CmdOrCtrl+F' },
      { id: 'edit.googleSearch', label: '使用 Google 搜索', labelEn: 'Search with Google', accelerator: 'CmdOrCtrl+Shift+G' },
      sep,
      { id: 'edit.spellCheck', label: '检查拼写', labelEn: 'Check Spelling', setting: 'spellcheck' },
      { id: 'edit.autoCorrect', label: '自动纠正拼写', labelEn: 'Auto Correct Spelling', setting: 'autoCorrect' },
      { id: 'edit.findNext', label: '查找下一个', labelEn: 'Find Next' },
      { id: 'edit.findPrevious', label: '查找上一个', labelEn: 'Find Previous', accelerator: 'Shift+F3' },
      { id: 'edit.replace', label: '替换', labelEn: 'Replace', accelerator: 'Ctrl+H' },
      sep,
      {
        id: 'edit.spelling',
        label: '拼写和语法检查', labelEn: 'Spelling and Grammar',
        submenu: [
          { id: 'edit.spellNow', label: '立即检查文稿', labelEn: 'Check Document Now' },
          { id: 'edit.spellWhileTyping', label: '键入时检查拼写', labelEn: 'Check Spelling While Typing', setting: 'spellcheck', kind: 'checkbox' }
        ]
      }
    ]
  },
  {
    id: 'paragraph',
    label: '段落(P)', labelEn: 'Paragraph(&P)',
    items: [
      { id: 'paragraph.h1', label: '标题 1', labelEn: 'Heading 1', accelerator: 'Ctrl+1' },
      { id: 'paragraph.h2', label: '标题 2', labelEn: 'Heading 2', accelerator: 'Ctrl+2' },
      { id: 'paragraph.h3', label: '标题 3', labelEn: 'Heading 3', accelerator: 'Ctrl+3' },
      { id: 'paragraph.h4', label: '标题 4', labelEn: 'Heading 4', accelerator: 'Ctrl+4' },
      { id: 'paragraph.h5', label: '标题 5', labelEn: 'Heading 5', accelerator: 'Ctrl+5' },
      { id: 'paragraph.h6', label: '标题 6', labelEn: 'Heading 6', accelerator: 'Ctrl+6' },
      { id: 'paragraph.moveUp', label: '上移段落', labelEn: 'Move Paragraph Up', accelerator: 'Alt+Up' },
      { id: 'paragraph.moveDown', label: '下移段落', labelEn: 'Move Paragraph Down', accelerator: 'Alt+Down' },
      sep,
      { id: 'paragraph.p', label: '段落', labelEn: 'Paragraph', accelerator: 'Ctrl+0' },
      { id: 'paragraph.headingUp', label: '提升标题级别', labelEn: 'Increase Heading Level', accelerator: 'Ctrl+=' },
      { id: 'paragraph.headingDown', label: '降低标题级别', labelEn: 'Decrease Heading Level', accelerator: 'Ctrl+-' },
      sep,
      { id: 'paragraph.table', label: '插入表格', labelEn: 'Insert Table', accelerator: 'Ctrl+T' },
      { id: 'paragraph.tableRowAbove', label: '上方插入行', labelEn: 'Add Row Above' },
      { id: 'paragraph.tableRowBelow', label: '下方插入行', labelEn: 'Add Row Below', accelerator: 'Ctrl+Return' },
      { id: 'paragraph.tableColBefore', label: '左侧插入列', labelEn: 'Add Column Before' },
      { id: 'paragraph.tableColAfter', label: '右侧插入列', labelEn: 'Add Column After' },
      { id: 'paragraph.tableDeleteRow', label: '删除行', labelEn: 'Delete Row', accelerator: 'Shift+Ctrl+Backspace' },
      { id: 'paragraph.tableDeleteCol', label: '删除列', labelEn: 'Delete Column' },
      { id: 'paragraph.tableCopy', label: '复制表格', labelEn: 'Copy Table' },
      { id: 'paragraph.tableFormat', label: '格式化表格源码', labelEn: 'Prettify Source Code' },
      { id: 'paragraph.tableDelete', label: '删除表格', labelEn: 'Delete Table' },
      sep,
      { id: 'paragraph.math', label: '公式块', labelEn: 'Math Block', accelerator: 'Ctrl+Shift+M' },
      { id: 'paragraph.fences', label: '代码块', labelEn: 'Code Fences', accelerator: 'Ctrl+Shift+K' },
      {
        id: 'paragraph.codeTools',
        label: '代码工具', labelEn: 'Code Tools',
        submenu: [
          { id: 'paragraph.codeCopy', label: '复制代码块内容', labelEn: 'Copy Code Content' },
          { id: 'paragraph.codeIndent', label: '为整个代码块调整缩进', labelEn: 'Auto Indent Whole Code' }
        ]
      },
      sep,
      { id: 'paragraph.alert', label: '警告框', labelEn: 'Alert', submenu: ALERTS },
      { id: 'paragraph.quote', label: '引用', labelEn: 'Quote', accelerator: 'Ctrl+Shift+Q' },
      { id: 'paragraph.ol', label: '有序列表', labelEn: 'Ordered List', accelerator: 'Ctrl+Shift+[' },
      { id: 'paragraph.ul', label: '无序列表', labelEn: 'Unordered List', accelerator: 'Ctrl+Shift+]' },
      { id: 'paragraph.taskList', label: '任务列表', labelEn: 'Task List', accelerator: 'Ctrl+Shift+X' },
      {
        id: 'paragraph.taskStatus',
        label: '任务状态', labelEn: 'Task Status',
        submenu: [
          { id: 'paragraph.taskToggle', label: '切换任务状态', labelEn: 'Toggle Task Status' },
          { id: 'paragraph.taskDone', label: '标记为已完成', labelEn: 'Mark as Complete' },
          { id: 'paragraph.taskTodo', label: '标记为未完成', labelEn: 'Mark as Incomplete' }
        ]
      },
      {
        id: 'paragraph.listIndent',
        label: '列表缩进', labelEn: 'List Indentation',
        submenu: [
          { id: 'paragraph.indent', label: '增加缩进', labelEn: 'Indent', accelerator: 'CmdOrCtrl+]' },
          { id: 'paragraph.outdent', label: '减少缩进', labelEn: 'Outdent', accelerator: 'CmdOrCtrl+[' }
        ]
      },
      sep,
      { id: 'paragraph.insertBefore', label: '在上方插入段落', labelEn: 'Insert Paragraph Before' },
      { id: 'paragraph.insertAfter', label: '在下方插入段落', labelEn: 'Insert Paragraph After' },
      sep,
      { id: 'paragraph.linkReference', label: '链接引用', labelEn: 'Link Reference' },
      { id: 'paragraph.footnote', label: '脚注', labelEn: 'Footnotes' },
      { id: 'paragraph.hr', label: '水平分割线', labelEn: 'Horizontal Line' },
      { id: 'paragraph.toc', label: '内容目录', labelEn: 'Table of Contents' },
      { id: 'paragraph.frontMatter', label: 'YAML Front Matter', labelEn: 'YAML Front Matter' }
    ]
  },
  {
    id: 'format',
    label: '格式(O)', labelEn: 'Format(&O)',
    items: [
      { id: 'format.strong', label: '加粗', labelEn: 'Strong', accelerator: 'CmdOrCtrl+B' },
      { id: 'format.em', label: '斜体', labelEn: 'Emphasis', accelerator: 'CmdOrCtrl+I' },
      { id: 'format.underline', label: '下划线', labelEn: 'Underline', accelerator: 'CmdOrCtrl+U' },
      { id: 'format.code', label: '代码', labelEn: 'Code', accelerator: 'CmdOrCtrl+Shift+`' },
      { id: 'format.inlineMath', label: '内联公式', labelEn: 'Inline Math' },
      { id: 'format.strike', label: '删除线', labelEn: 'Strike', accelerator: 'Alt+Shift+5' },
      { id: 'format.highlight', label: '高亮', labelEn: 'Highlight' },
      { id: 'format.superscript', label: '上标', labelEn: 'Superscript' },
      { id: 'format.subscript', label: '下标', labelEn: 'Subscript' },
      { id: 'format.comment', label: '注释', labelEn: 'Comment' },
      sep,
      { id: 'format.link', label: '超链接', labelEn: 'Hyperlink', accelerator: 'Ctrl+K' },
      {
        id: 'format.linkActions',
        label: '链接操作', labelEn: 'Hyperlink Actions',
        submenu: [
          { id: 'format.openLink', label: '打开链接', labelEn: 'Open Link' },
          { id: 'format.copyLink', label: '复制链接地址', labelEn: 'Copy Link Address' }
        ]
      },
      sep,
      { id: 'format.image', label: '插入图片', labelEn: 'Insert Image', accelerator: 'CmdOrCtrl+Shift+I' },
      {
        id: 'format.imageTools',
        label: '图像工具', labelEn: 'Image Tools',
        submenu: [
          { id: 'format.insertLocalImage', label: '插入本地图片', labelEn: 'Insert Local Images' },
          { id: 'format.imageRoot', label: '设置图片根目录', labelEn: 'Use Image Root Path' },
          sep,
          ...IMAGE_ZOOMS.map((z) => ({
            id: 'format.zoomImage:' + z,
            label: '缩放图片 ' + z, labelEn: 'Zoom Image ' + z
          }))
        ]
      },
      sep,
      { id: 'format.clear', label: '清除样式', labelEn: 'Clear Format', accelerator: 'CmdOrCtrl+\\' }
    ]
  },
  {
    id: 'view',
    label: '视图(V)', labelEn: 'View(&V)',
    items: [
      { id: 'view.sidebar', label: '显示／隐藏侧边栏', labelEn: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+Shift+L', setting: 'sidebarVisible', kind: 'checkbox' },
      { id: 'view.outline', label: '大纲', labelEn: 'Outline', accelerator: 'CmdOrCtrl+Shift+1' },
      { id: 'view.fileList', label: '文档列表', labelEn: 'Articles', accelerator: 'CmdOrCtrl+Shift+2' },
      { id: 'view.closeTab', label: '关闭标签页', labelEn: 'Close Tab', accelerator: 'CmdOrCtrl+W' },
      { id: 'view.fileTree', label: '文件树', labelEn: 'File Tree', accelerator: 'CmdOrCtrl+Shift+3' },
      { id: 'view.search', label: '搜索', labelEn: 'Search', accelerator: 'CmdOrCtrl+Shift+F' },
      sep,
      { id: 'view.sourceCodeMode', label: '源代码模式', labelEn: 'Source Code Mode', accelerator: 'CmdOrCtrl+/', setting: 'sourceCodeMode', kind: 'checkbox' },
      { id: 'view.readonlyMode', label: '只读模式', labelEn: 'Readonly Mode', setting: 'readonlyMode', kind: 'checkbox' },
      { id: 'view.focusMode', label: '专注模式', labelEn: 'Focus Mode', setting: 'focusMode', kind: 'checkbox' },
      { id: 'view.typewriterMode', label: '打字机模式', labelEn: 'Typewriter Mode', setting: 'typewriterMode', kind: 'checkbox' },
      sep,
      { id: 'view.statusBar', label: '状态栏', labelEn: 'Status Bar', setting: 'showStatusBar', kind: 'checkbox' },
      { id: 'view.toolbar', label: '工具栏', labelEn: 'Toolbar', setting: 'showToolbar', kind: 'checkbox' },
      { id: 'view.wordCountPopover', label: '字数统计窗口', labelEn: 'Toggle Word Count Popover' },
      sep,
      { id: 'view.fullscreen', label: '切换全屏', labelEn: 'Toggle Fullscreen', accelerator: 'F11' },
      sep,
      { id: 'view.inspectElement', label: '检查元素', labelEn: 'Inspect Element', accelerator: 'CmdOrCtrl+Shift+I' },
      { id: 'view.alwaysOnTop', label: '保持窗口在最前端', labelEn: 'Always on Top', setting: 'alwaysOnTop', kind: 'checkbox' },
      sep,
      { id: 'view.actualSize', label: '实际大小', labelEn: 'Actual Size', accelerator: 'Ctrl+Shift+9' },
      { id: 'view.zoomIn', label: '放大', labelEn: 'Zoom In', accelerator: 'Ctrl+Shift+=' },
      { id: 'view.zoomOut', label: '缩小', labelEn: 'Zoom Out', accelerator: 'Ctrl+Shift+-' },
      { id: 'view.switchDocument', label: '应用内窗口切换', labelEn: 'Switch Between Opened Documents', accelerator: 'Ctrl+Tab' },
      { id: 'view.devTools', label: '开发者工具', labelEn: 'Toggle DevTools', accelerator: 'Shift+F12', role: 'toggleDevTools' }
    ]
  },
  {
    id: 'themes',
    label: '主题(T)', labelEn: 'Themes(&T)',
    items: THEME_NAMES.map((name) => ({
      id: 'theme.set:' + name,
      label: THEME_LABELS[name], labelEn: THEME_LABELS[name],
      kind: 'radio' as const
    }))
  },
  {
    id: 'help',
    label: '帮助(H)', labelEn: 'Help(&H)',
    items: [
      { id: 'help.quickStart', label: 'Quick Start', labelEn: 'Quick Start' },
      { id: 'help.markdownReference', label: 'Markdown Reference', labelEn: 'Markdown Reference' },
      { id: 'help.pandoc', label: 'Install and Use Pandoc', labelEn: 'Install and Use Pandoc' },
      { id: 'help.customThemes', label: 'Custom Themes', labelEn: 'Custom Themes' },
      { id: 'help.images', label: 'Use Images in Typora', labelEn: 'Use Images in Typora' },
      { id: 'help.recovery', label: 'Data Recovery and Version Control', labelEn: 'Data Recovery and Version Control' },
      sep,
      { id: 'help.whatsNew', label: "What's New", labelEn: "What's New" },
      { id: 'help.credits', label: '鸣谢', labelEn: 'Credits' },
      { id: 'help.changelog', label: '更新日志', labelEn: 'Change Log' },
      sep,
      { id: 'help.checkUpdates', label: '检查更新', labelEn: 'Check for Updates' },
      { id: 'help.website', label: '官方网站', labelEn: 'Official Website' },
      { id: 'help.feedback', label: '反馈', labelEn: 'Feedback' },
      { id: 'help.privacy', label: '隐私条款', labelEn: 'Privacy Policy' },
      sep,
      { id: 'help.about', label: '关于', labelEn: 'About' }
    ]
  }
]

/** Flat list of every leaf command id, used to type the renderer dispatcher. */
export const MENU_COMMAND_IDS: string[] = MENU.flatMap((top) =>
  top.items.flatMap(function flatten(item: MenuItem): string[] {
    return item.submenu ? item.submenu.flatMap(flatten) : [item.id]
  })
).filter((id) => id !== 'separator')
