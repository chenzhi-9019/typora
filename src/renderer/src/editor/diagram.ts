interface MermaidApi {
  initialize: (config: Record<string, unknown>) => void
  render: (id: string, code: string) => Promise<{ svg: string }>
}

/**
 * Mermaid's `base` theme is the only one that honours themeVariables, so every diagram
 * colour is read back from the very same CSS variables the article uses.
 */
const THEME_TOKEN_MAP: Record<string, string[]> = {
  background: ['--bg-color'],
  mainBkg: ['--md-diagram-node-fill', '--item-hover-bg-color', '--active-file-bg-color'],
  primaryColor: ['--md-diagram-node-fill', '--item-hover-bg-color', '--active-file-bg-color'],
  primaryTextColor: ['--text-color'],
  primaryBorderColor: ['--md-diagram-line-color', '--md-char-color', '--control-text-color'],
  secondaryColor: ['--side-bar-bg-color', '--item-hover-bg-color'],
  tertiaryColor: ['--bg-color'],
  nodeBorder: ['--md-diagram-line-color', '--md-char-color', '--control-text-color'],
  clusterBkg: ['--side-bar-bg-color'],
  clusterBorder: ['--md-diagram-line-color', '--control-text-color'],
  lineColor: ['--md-diagram-line-color', '--md-char-color', '--control-text-color'],
  textColor: ['--text-color'],
  titleColor: ['--text-color'],
  edgeLabelBackground: ['--bg-color'],
  noteBkgColor: ['--item-hover-bg-color'],
  noteTextColor: ['--text-color'],
  noteBorderColor: ['--md-diagram-line-color', '--control-text-color'],
  actorBkg: ['--item-hover-bg-color'],
  actorBorder: ['--md-diagram-line-color', '--control-text-color'],
  actorTextColor: ['--text-color'],
  actorLineColor: ['--md-diagram-line-color', '--control-text-color'],
  signalColor: ['--text-color'],
  signalTextColor: ['--text-color'],
  labelBoxBkgColor: ['--item-hover-bg-color'],
  labelTextColor: ['--text-color'],
  loopTextColor: ['--text-color'],
  activationBkgColor: ['--item-hover-bg-color'],
  activationBorderColor: ['--md-diagram-line-color', '--control-text-color'],
  fontFamily: ['--ui-font', '--monospace']
}

const THEME_REFRESH_DELAY = 120

const observedRoots = new Set<ParentNode>()
let mermaidApi: Promise<MermaidApi> | null = null
let diagramSequence = 0
let themeObserver: MutationObserver | null = null
let refreshHandle: number | null = null

function readVariable(names: string[]): string | null {
  const computed = getComputedStyle(document.documentElement)
  for (const name of names) {
    const value = computed.getPropertyValue(name).trim()
    if (value !== '') return value
  }
  return null
}

function buildThemeVariables(): Record<string, string> {
  const variables: Record<string, string> = {}
  for (const [key, names] of Object.entries(THEME_TOKEN_MAP)) {
    const value = readVariable(names)
    if (value !== null) variables[key] = value
  }
  const fontSize = getComputedStyle(document.documentElement).fontSize.trim()
  if (fontSize !== '') variables.fontSize = fontSize
  return variables
}

function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidApi) {
    mermaidApi = import('mermaid').then((module) => {
      const api = (module.default ?? module) as unknown as MermaidApi
      api.initialize({
        startOnLoad: false,
        securityLevel: 'loose',
        theme: 'base',
        themeVariables: buildThemeVariables()
      })
      return api
    })
  }
  return mermaidApi
}

/** Keeps wide diagrams inside the article column instead of letting them overflow. */
function applySvgSizing(node: HTMLElement): void {
  const svg = node.querySelector('svg')
  if (!svg) return
  svg.classList.add('mermaid-svg')
  svg.style.maxWidth = '100%'
  svg.style.height = 'auto'
}

function ensureThemeWatcher(): void {
  if (themeObserver !== null || typeof MutationObserver === 'undefined') return
  themeObserver = new MutationObserver((): void => {
    if (refreshHandle !== null) window.clearTimeout(refreshHandle)
    refreshHandle = window.setTimeout((): void => {
      refreshHandle = null
      mermaidApi = null
      for (const root of observedRoots) {
        if (root instanceof Element && !root.isConnected) {
          observedRoots.delete(root)
          continue
        }
        void renderDiagrams(root)
      }
    }, THEME_REFRESH_DELAY)
  })
  const filter = { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] }
  themeObserver.observe(document.documentElement, filter)
  if (document.body) themeObserver.observe(document.body, filter)
}

/**
 * Renders every `div.md-diagram[data-mermaid]` of `root` into inline SVG. Failures
 * fall back to the raw fence text so the document never silently loses content.
 */
export async function renderDiagrams(root: ParentNode): Promise<void> {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>('div.md-diagram[data-mermaid]'))
  if (nodes.length === 0) return
  observedRoots.add(root)
  ensureThemeWatcher()

  let api: MermaidApi
  try {
    api = await loadMermaid()
  } catch {
    return
  }

  for (const node of nodes) {
    const code = node.getAttribute('data-mermaid') ?? ''
    if (code.trim() === '') continue
    diagramSequence += 1
    try {
      const result = await api.render('md-diagram-' + diagramSequence, code)
      node.innerHTML = result.svg
      node.classList.remove('md-diagram-error')
      applySvgSizing(node)
    } catch {
      node.textContent = code
      node.classList.add('md-diagram-error')
    }
  }
}
