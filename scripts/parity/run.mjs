#!/usr/bin/env node
/**
 * Typora parity audit -- runner.
 *
 *   node scripts/parity/run.mjs [--only <area>] [--verbose]
 *
 * Starts the built app (out/) under two debugger endpoints, then runs every check
 * from checks.mjs against it:
 *
 *   - renderer   CDP over --remote-debugging-port. Probes run here.
 *   - main       the Node inspector over --inspect. Native menu + save-to-disk.
 *
 * Contract for one check (see checks.mjs):
 *
 *   { id, area, description, probe, initial?, settings? }
 *
 *   probe     source of a page expression that resolves to { expect, actual }.
 *             compare-by-value decides PASS. It may await the H helpers, which
 *             route real input through the driver (CDP Input.dispatchKeyEvent /
 *             dispatchMouseEvent) -- nothing in a probe writes the DOM.
 *   initial   Markdown the document is loaded with before the check runs.
 *   settings  settings patch applied through the app's own IPC before the reload.
 *
 * Every check starts from Page.reload, so checks cannot pollute each other.
 * Exit code: 0 when everything passed, 1 when at least one check failed.
 */
import { spawn, spawnSync } from 'node:child_process'
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import * as cdpModule from './lib/cdp.mjs'
import { Cdp, clickAt, httpJson, poll, pressChord, pressKey, typeText } from './lib/cdp.mjs'
import { CHECKS } from './checks.mjs'

const REPO = path.resolve(import.meta.dirname, '../..')
const ELECTRON = path.join(REPO, 'node_modules/electron/dist/electron.exe')
const DOC_NAME = 'parity-doc.md'
const PROBE_TIMEOUT_MS = 25000
const READY_TIMEOUT_MS = 25000
const args = process.argv.slice(2)
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null
const verbose = args.includes('--verbose')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/* ------------------------------------------------------------------ helpers */

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

/** Newest mtime under a directory tree, used to spot a build older than its source. */
function newestMtime(directory) {
  let newest = 0
  const walk = (current) => {
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else {
        try {
          newest = Math.max(newest, statSync(full).mtimeMs)
        } catch {
          // a file can vanish mid-walk
        }
      }
    }
  }
  walk(directory)
  return newest
}

/**
 * Refuses to audit a build that is not there, and warns loudly when src/ is newer than
 * out/ -- otherwise every result silently describes an artefact nobody is running.
 */
function preflight() {
  const needed = [
    { path: ELECTRON, hint: 'node_modules/electron (npm install)' },
    { path: path.join(REPO, 'out/main/index.js'), hint: 'out/ (npm run build)' },
    { path: path.join(REPO, 'out/renderer/index.html'), hint: 'out/ (npm run build)' }
  ]
  const missing = needed.filter((entry) => !existsSync(entry.path)).map((entry) => entry.hint)
  if (missing.length > 0) {
    console.error('PARITY: missing ' + missing.join(', ') + ' -- build first, then run again')
    process.exit(2)
  }
  const newestSource = newestMtime(path.join(REPO, 'src'))
  const newestOutput = newestMtime(path.join(REPO, 'out'))
  if (newestSource > newestOutput) {
    const when = (ms) => new Date(ms).toLocaleString()
    console.warn(
      'PARITY WARNING: src/ is newer than out/ (' +
        when(newestSource) +
        ' > ' +
        when(newestOutput) +
        '); these results describe the stale build. Run npm run build first.'
    )
  }
}

function killTree(pid) {
  if (!pid) return
  try {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
  } catch {
    // already gone
  }
}

/** Keys sorted so two structurally equal objects compare equal as strings. */
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return '{' + keys.map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
  }
  return JSON.stringify(value === undefined ? null : value)
}

function clip(value, max = 320) {
  const text = typeof value === 'string' ? value : canonical(value)
  if (text === undefined) return 'undefined'
  return text.length > max ? text.slice(0, max) + '...' : text
}

/* ------------------------------------------------------- page side helpers */

/**
 * Installed into every document before the app boots (Page.addScriptToEvaluateOnNewDocument).
 * It only defines helpers -- every input helper hands the work to the driver over a CDP
 * binding, so a probe never fabricates DOM state.
 */
function parityBootstrap() {
  if (window.__parity) return

  const pending = new Map()
  let seq = 0

  const rpc = function (op, payload) {
    return new Promise(function (resolve, reject) {
      const send = window.__paritySend
      if (typeof send !== 'function') {
        reject(new Error('parity bridge missing (reload did not re-arm Runtime.addBinding)'))
        return
      }
      seq += 1
      const id = seq
      pending.set(id, { resolve: resolve, reject: reject })
      send(JSON.stringify({ id: id, op: op, args: payload === undefined ? null : payload }))
    })
  }

  const write = function () {
    return document.querySelector('#write')
  }

  const api = {
    /** called by the driver to settle one rpc call */
    __resolve: function (id, payload) {
      const entry = pending.get(id)
      if (!entry) return
      pending.delete(id)
      if (payload && payload.error) entry.reject(new Error(payload.error))
      else entry.resolve(payload ? payload.value : undefined)
    },

    /* ---- read side: pure observation of the live DOM ---- */
    write: write,
    q: function (selector) {
      return document.querySelector(selector)
    },
    qa: function (selector) {
      return Array.prototype.slice.call(document.querySelectorAll(selector))
    },
    tags: function (selector) {
      return api.qa(selector).map(function (el) {
        return el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(/\s+/).join('.') : '')
      })
    },
    blocks: function () {
      const root = write()
      if (!root) return []
      return Array.prototype.slice.call(root.children).map(function (el) {
        return {
          tag: el.tagName.toLowerCase(),
          cls: String(el.className || ''),
          text: (el.textContent || '').replace(/\u00a0/g, '[nbsp]').trim()
        }
      })
    },
    text: function (selector) {
      const el = document.querySelector(selector)
      return el ? (el.textContent || '').trim() : null
    },
    html: function (selector) {
      const el = selector ? document.querySelector(selector) : write()
      return el ? el.innerHTML : null
    },
    /** #write text with every NBSP spelled out, so a stray one is visible in a diff. */
    plain: function () {
      const root = write()
      return root ? (root.textContent || '').replace(/\u00a0/g, '[nbsp]') : null
    },
    attr: function (selector, name) {
      const el = document.querySelector(selector)
      return el ? el.getAttribute(name) : null
    },
    exists: function (selector) {
      return !!document.querySelector(selector)
    },
    count: function (selector) {
      return document.querySelectorAll(selector).length
    },

    /* ---- input side: every call goes out to the driver as real input ---- */
    type: function (text) {
      return rpc('type', { text: text })
    },
    key: function (name, modifiers) {
      return rpc('key', { name: name, modifiers: modifiers || [] })
    },
    chord: function (modifier, letter) {
      return rpc('chord', { modifier: modifier, letter: letter })
    },
    click: function (selector, offsetRatio) {
      const el = document.querySelector(selector)
      if (!el) throw new Error('click target missing: ' + selector)
      const rect = el.getBoundingClientRect()
      const ratio = typeof offsetRatio === 'number' ? offsetRatio : 0.5
      return rpc('click', {
        x: rect.left + Math.max(2, Math.min(rect.width - 2, rect.width * 0.5)),
        y: rect.top + Math.max(2, rect.height * ratio)
      })
    },
    /** Puts the caret at the end of the Nth block: a real click, then the End key. */
    focusBlock: async function (index) {
      const root = write()
      if (!root) throw new Error('#write missing')
      const block = root.children[index || 0]
      if (!block) throw new Error('block ' + (index || 0) + ' missing')
      const rect = block.getBoundingClientRect()
      await rpc('click', { x: rect.left + 3, y: rect.top + Math.max(2, rect.height / 2) })
      await rpc('key', { name: 'End', modifiers: [] })
      return true
    },
    focus: function () {
      return api.focusBlock(0)
    },

    /* ---- document level readback (driver saves through the real menu) ---- */
    md: function () {
      return rpc('markdown')
    },
    file: function () {
      return rpc('file')
    },
    menu: function () {
      return rpc('menu')
    },
    menuCount: function () {
      return rpc('menu-count')
    },
    menuClick: function (id) {
      return rpc('menu-click', { id: id })
    },
    menuChecked: function (id) {
      return rpc('menu-checked', { id: id })
    },
    dclick: function (selector) {
      const el = document.querySelector(selector)
      if (!el) throw new Error('double-click target missing: ' + selector)
      const rect = el.getBoundingClientRect()
      return rpc('dclick', {
        x: rect.left + Math.max(2, rect.width / 2),
        y: rect.top + Math.max(2, rect.height / 2)
      })
    },
    /** Double-clicks the first occurrence of a word, so the browser selects exactly it. */
    dclickText: function (word) {
      const walker = document.createTreeWalker(document.querySelector('#write'), NodeFilter.SHOW_TEXT)
      let node = walker.nextNode()
      while (node) {
        const text = node.nodeValue || ''
        const index = text.indexOf(word)
        if (index >= 0) {
          const range = document.createRange()
          range.setStart(node, index)
          range.setEnd(node, index + word.length)
          const box = range.getBoundingClientRect()
          return rpc('dclick', { x: box.left + box.width / 2, y: box.top + box.height / 2 })
        }
        node = walker.nextNode()
      }
      throw new Error('text not found: ' + word)
    },
    selectedText: function () {
      return String(window.getSelection())
    },
    /** Selects exactly N characters from offset F by holding Shift and arrowing: pure keys. */
    selectChars: async function (from, count) {
      await rpc('key', { name: 'Home', modifiers: [] })
      for (let index = 0; index < from; index += 1) {
        await rpc('key', { name: 'ArrowRight', modifiers: [] })
      }
      for (let index = 0; index < count; index += 1) {
        await rpc('key', { name: 'ArrowRight', modifiers: ['Shift'] })
      }
      return String(window.getSelection())
    },
    cssScan: function () {
      return rpc('css-scan')
    },
    stubDialogs: function (options) {
      return rpc('stub-dialogs', options || {})
    },
    dialogLog: function () {
      return rpc('dialog-log')
    },
    exportFile: function (kind) {
      return rpc('export-file', { kind: kind || 'docx' })
    },
    converter: function () {
      return rpc('converter')
    },
    conf: function () {
      return rpc('conf')
    },
    prefsClick: function (label, panel) {
      return rpc('prefs-click', { label: label, panel: panel || null })
    },
    prefsRows: function () {
      return rpc('prefs-rows')
    },
    prefsReset: function () {
      return rpc('prefs-reset')
    },
    fileStat: function (filePath) {
      return rpc('file-stat', { path: filePath })
    },
    readText: function (filePath) {
      return rpc('read-file', { path: filePath })
    },
    /** Absolute path inside the harness scratch dir, for save-as / export targets. */
    scratch: function (name) {
      return rpc('scratch', { name: name })
    },
    /** Walks the CSSOM for the scrollbar rules; computed style cannot see pseudo elements. */
    styles: function () {
      const wanted = {
        '::-webkit-scrollbar': ['width', 'height'],
        '::-webkit-scrollbar-thumb': ['background'],
        '::-webkit-scrollbar-thumb:vertical': ['border-left', 'min-height']
      }
      const found = {}
      const visit = function (rules) {
        for (const rule of Array.prototype.slice.call(rules || [])) {
          if (rule.cssRules) {
            visit(rule.cssRules)
            continue
          }
          const selector = String(rule.selectorText || '').trim()
          if (!wanted[selector]) continue
          for (const property of wanted[selector]) {
            const value = rule.style.getPropertyValue(property)
            if (value) found[selector + ' ' + property] = value.trim()
          }
        }
      }
      for (const sheet of Array.prototype.slice.call(document.styleSheets)) {
        try {
          visit(sheet.cssRules)
        } catch {
          // a cross-origin sheet would throw; every sheet here is same-origin
        }
      }
      return found
    },
    prefs: function () {
      return rpc('prefs')
    },
    settle: function (ms) {
      return rpc('settle', { ms: typeof ms === 'number' ? ms : 150 })
    }
  }

  Object.defineProperty(window, '__parity', { value: api, configurable: true })
}

const BOOTSTRAP = '(' + parityBootstrap.toString() + ')();'

/* ------------------------------------------------------------ application */

class App {
  constructor() {
    this.child = null
    this.page = null
    this.main = null
    this.dir = null
    this.logPath = null
    this.docPath = null
    this.bridgeQueue = []
    this.bridgeBusy = false
  }

  /* -- lifecycle -- */

  async start() {
    this.dir = mkdtempSync(path.join(os.tmpdir(), 'typora-parity-'))
    this.dirs = this.dirs || []
    this.dirs.push(this.dir)
    this.docPath = path.join(this.dir, DOC_NAME)
    this.logPath = path.join(this.dir, 'electron.log')
    writeFileSync(this.docPath, '', 'utf8')

    const webPort = await freePort()
    const nodePort = await freePort()
    const logFd = openSync(this.logPath, 'w')
    this.child = spawn(
      ELECTRON,
      [
        '.',
        '--user-data-dir=' + path.join(this.dir, 'profile'),
        '--remote-debugging-port=' + webPort,
        '--inspect=' + nodePort,
        this.docPath
      ],
      {
        cwd: REPO,
        // belt and braces: --user-data-dir is the switch Electron actually honours,
        // APPDATA keeps anything that resolves %APPDATA% on its own out of the profile
        env: { ...process.env, APPDATA: this.dir },
        stdio: ['ignore', logFd, logFd]
      }
    )
    closeSync(logFd)

    const pageTarget = await poll(
      async () => {
        try {
          const list = await httpJson('http://127.0.0.1:' + webPort + '/json/list')
          return list.find((target) => /index\.html/.test(target.url)) ?? null
        } catch {
          return null
        }
      },
      { timeoutMs: 30000, intervalMs: 150, label: 'renderer debug target' }
    )
    this.page = await Cdp.connect(pageTarget.webSocketDebuggerUrl)
    await this.page.send('Runtime.enable')
    await this.page.send('Page.enable')
    await this.page.send('Page.addScriptToEvaluateOnNewDocument', { source: BOOTSTRAP })
    await this.armBridge()
    this.page.on('Runtime.bindingCalled', (params) => {
      if (params.name !== '__paritySend') return
      this.bridgeQueue.push(params.payload)
      void this.pump()
    })

    const mainTarget = await poll(
      async () => {
        try {
          const list = await httpJson('http://127.0.0.1:' + nodePort + '/json/list')
          return list.find((target) => target.type === 'node') ?? null
        } catch {
          return null
        }
      },
      { timeoutMs: 30000, intervalMs: 150, label: 'main process inspector' }
    )
    this.main = await Cdp.connect(mainTarget.webSocketDebuggerUrl)
    await this.main.send('Runtime.enable')
    this.webPort = webPort
    this.nodePort = nodePort

    await this.waitUntilReady()
  }

  /** A check may close the window on purpose; relaunch so the next check still runs. */
  async ensureAlive() {
    const alive = this.page && !this.page.closed && this.main && !this.main.closed
    if (alive) return false
    await this.stop()
    await this.start()
    await this.evalInPage('window.api.settings.reset().then(() => true)')
    return true
  }

  async stop() {
    this.page?.close()
    this.main?.close()
    killTree(this.child?.pid)
    await sleep(1200)
    const folders = (this.dirs || [this.dir]).filter(Boolean)
    for (let attempt = 0; attempt < 6; attempt += 1) {
      for (const folder of folders) {
        try {
          rmSync(folder, { recursive: true, force: true })
        } catch {
          // a locked file only delays the next attempt
        }
      }
      const remaining = folders.filter((folder) => existsSync(folder))
      if (remaining.length === 0) break
      await sleep(400)
    }
  }

  /* -- main process helpers -- */

  async mainEval(expression) {
    return this.main.evaluate(expression)
  }

  /** Clicks a real application-menu item, the same path a mouse click takes. */
  async clickMenuItem(id) {
    return this.mainEval(
      '(() => {' +
        '  const { Menu } = process.mainModule.require("electron");' +
        '  const menu = Menu.getApplicationMenu();' +
        '  if (!menu) throw new Error("no application menu");' +
        '  const item = menu.getMenuItemById(' + JSON.stringify(id) + ');' +
        '  if (!item) throw new Error("no menu item: ' + id + '");' +
        '  item.click();' +
        '  return true;' +
        '})()'
    )
  }

  async menuLabels() {
    return this.mainEval(
      '(() => {' +
        '  const { Menu } = process.mainModule.require("electron");' +
        '  const menu = Menu.getApplicationMenu();' +
        '  if (!menu) return null;' +
        '  return menu.items.filter((item) => item.label !== "").map((item) => item.label);' +
        '})()'
    )
  }

  /* -- page helpers -- */

  async armBridge() {
    try {
      await this.page.send('Runtime.addBinding', { name: '__paritySend' })
    } catch (error) {
      if (verbose) console.error('[bridge] addBinding: ' + String(error.message ?? error))
    }
  }

  /** Runs an expression in the page; a hung probe fails instead of stalling the run. */
  async evalInPage(expression, { timeoutMs = PROBE_TIMEOUT_MS } = {}) {
    let timer = null
    const expiry = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ __timeout: true }), timeoutMs)
    })
    try {
      const outcome = await Promise.race([
        this.page.evaluate(expression).then((value) => ({ value: value })),
        expiry
      ])
      if (outcome && outcome.__timeout) throw new Error('evaluation timed out after ' + timeoutMs + 'ms')
      return outcome.value
    } finally {
      clearTimeout(timer)
    }
  }

  async reload() {
    await this.page.send('Page.reload', { ignoreCache: false })
    await sleep(120)
    await this.armBridge()
    await this.waitUntilReady()
  }

  async waitUntilReady() {
    await poll(
      async () => {
        try {
          return await this.page.evaluate(
            '(() => {' +
              '  const write = document.querySelector("#write");' +
              '  const host = document.querySelector(".editor-host");' +
              '  if (!write || !host || write.children.length === 0) return false;' +
              '  if (!document.body.dataset.theme) return false;' +
              '  return document.readyState === "complete";' +
              '})()',
            { awaitPromise: false }
          )
        } catch {
          return false
        }
      },
      { timeoutMs: READY_TIMEOUT_MS, intervalMs: 80, label: 'editor ready' }
    )
    await sleep(120)
  }

  /* -- bridge: ops the page asks the driver to perform -- */

  async pump() {
    if (this.bridgeBusy) return
    this.bridgeBusy = true
    while (this.bridgeQueue.length > 0) {
      const raw = this.bridgeQueue.shift()
      let message
      try {
        message = JSON.parse(raw)
      } catch {
        continue
      }
      let payload
      try {
        payload = { value: await this.runOp(message.op, message.args ?? {}) }
      } catch (error) {
        payload = { error: String((error && error.message) || error) }
      }
      try {
        await this.page.evaluate(
          'window.__parity.__resolve(' + message.id + ',' + JSON.stringify(payload) + ')',
          { awaitPromise: false }
        )
      } catch {
        // the document may have been replaced underneath us
      }
    }
    this.bridgeBusy = false
  }

  async runOp(op, args) {
    switch (op) {
      case 'type':
        await typeText(this.page, args.text)
        await sleep(140)
        return true
      case 'key':
        await pressKey(this.page, args.name, args.modifiers ?? [])
        await sleep(140)
        return true
      case 'chord':
        await pressChord(this.page, args.modifier, args.letter)
        await sleep(140)
        return true
      case 'click':
        await clickAt(this.page, args.x, args.y)
        await sleep(140)
        return true
      case 'dclick':
        await cdpModule.dblclickAt(this.page, args.x, args.y)
        await sleep(160)
        return true
      case 'menu-click':
        await this.clickMenuItem(args.id)
        await sleep(220)
        return true
      case 'menu-checked':
        return this.mainEval(
          '(() => {' +
            '  const { Menu } = process.mainModule.require("electron");' +
            '  const menu = Menu.getApplicationMenu();' +
            '  const item = menu && menu.getMenuItemById(' + JSON.stringify(args.id) + ');' +
            '  return item ? Boolean(item.checked) : null;' +
            '})()'
        )
      case 'stub-dialogs':
        return this.stubDialogs(args)
      case 'dialog-log':
        return this.mainEval('(() => (globalThis.__parityDialogs || { calls: [] }).calls)()')
      case 'export-file':
        return this.exportFile(args.kind)
      case 'converter':
        return this.converterProbe()
      case 'conf':
        return this.readConf()
      case 'prefs-click':
        return this.prefsClick(args.label, args.panel)
      case 'prefs-rows':
        return this.prefsSearch()
      case 'prefs-reset':
        return this.prefsReset()
      case 'file-stat':
        return this.fileStat(args.path)
      case 'read-file':
        try {
          return readFileSync(args.path, 'utf8')
        } catch {
          return null
        }
      case 'css-scan':
        return this.cssScan()
      case 'scratch': {
        const target = path.join(this.dir, String(args.name || 'scratch.txt'))
        const dir = path.dirname(target)
        if (dir) mkdirSync(dir, { recursive: true })
        return target
      }
      case 'settle':
        await sleep(args.ms ?? 150)
        return true
      case 'file':
        return readFileSync(this.docPath, 'utf8')
      case 'markdown':
        return this.saveThroughMenu()
      case 'menu':
        return this.menuLabels()
      case 'menu-count':
        return this.mainEval(
          '(() => {' +
            '  const { Menu } = process.mainModule.require("electron");' +
            '  const menu = Menu.getApplicationMenu();' +
            '  if (!menu) return null;' +
            '  const leaves = [];' +
            '  const walk = (items) => { for (const item of items) { if (item.submenu) walk(item.submenu.items); else if (item.id && item.type !== "separator") leaves.push(item.id); } };' +
            '  walk(menu.items);' +
            '  return { tops: menu.items.length, leaves: leaves.length, unique: new Set(leaves).size };' +
            '})()'
        )
      case 'prefs':
        return this.preferencesPanels()
      default:
        throw new Error('unknown bridge op: ' + op)
    }
  }

  /** The keyboard shortcut cannot be used to read the model back: see report.md. */
  async saveThroughMenu() {
    const before = statSync(this.docPath).mtimeMs
    await this.clickMenuItem('file.save')
    await poll(
      async () => {
        const stats = statSync(this.docPath)
        return stats.mtimeMs !== before ? stats : null
      },
      { timeoutMs: 5000, intervalMs: 40, label: 'document saved to disk' }
    ).catch(() => null)
    await sleep(60)
    return readFileSync(this.docPath, 'utf8')
  }

  async preferencesPanels() {
    await this.clickMenuItem('file.preferences')
    const target = await poll(
      async () => {
        const list = await httpJson('http://127.0.0.1:' + this.webPort + '/json/list')
        return list.find((entry) => /preferences\.html/.test(entry.url)) ?? null
      },
      { timeoutMs: 12000, intervalMs: 120, label: 'preferences window' }
    )
    const session = await Cdp.connect(target.webSocketDebuggerUrl)
    try {
      await session.send('Runtime.enable')
      return await poll(
        async () => {
          const labels = await session.evaluate(
            '(() => {' +
              '  const items = Array.prototype.slice.call(document.querySelectorAll(".nav-group-item"));' +
              '  if (items.length === 0) return null;' +
              '  return items.map((item) => (item.textContent || "").trim());' +
              '})()',
            { awaitPromise: false }
          )
          return labels && labels.length > 0 ? labels : null
        },
        { timeoutMs: 10000, intervalMs: 120, label: 'preferences panels' }
      )
    } finally {
      session.close()
    }
  }

  /** Replaces the native dialogs with scripted answers and records what was asked. */
  async stubDialogs(options) {
    const saveAs = options && typeof options.saveAs === 'string' ? options.saveAs : null
    const message = typeof options?.message === 'number' ? options.message : 0
    return this.mainEval(
      '(() => {' +
        '  const { dialog } = process.mainModule.require("electron");' +
        '  const state = (globalThis.__parityDialogs = { calls: [], saveAs: null, message: 0 });' +
        '  state.saveAs = ' + JSON.stringify(saveAs) + ';' +
        '  state.message = ' + JSON.stringify(message) + ';' +
        '  dialog.showSaveDialog = async () => state.saveAs' +
        '    ? { canceled: false, filePath: state.saveAs }' +
        '    : { canceled: true, filePath: undefined };' +
        '  dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });' +
        '  dialog.showMessageBox = async (first, second) => {' +
        '    const box = second || first || {};' +
        '    state.calls.push({ kind: "message", message: box.message, detail: box.detail, buttons: box.buttons });' +
        '    return { response: state.message, checkboxChecked: false };' +
        '  };' +
        '  return true;' +
        '})()'
    )
  }

  /** Exports the open document (docx through doc-rs, or html), dialogs out of the way. */
  async exportFile(kind) {
    const extension = kind === 'html' ? '.html' : '.docx'
    const menuId = kind === 'html' ? 'export.html' : 'export.docx'
    const folder = path.join(this.dir, 'export')
    mkdirSync(folder, { recursive: true })
    const before = new Set(readdirSync(folder))
    await this.evalInPage(
      'window.api.settings.patch({ exportNoDialog: true, exportFolder: ' +
        JSON.stringify(folder) +
        ' }).then(() => true)'
    )
    await this.clickMenuItem(menuId)
    const name = await poll(
      async () => {
        const suffix = extension.replace('.', '.')
        const fresh = readdirSync(folder).filter(
          (entry) => !before.has(entry) && entry.toLowerCase().endsWith(suffix)
        )
        return fresh.length > 0 ? fresh[0] : null
      },
      { timeoutMs: 90000, intervalMs: 300, label: kind + ' export' }
    )
    const full = path.join(folder, name)
    const stats = statSync(full)
    const bytes = readFileSync(full)
    const magic = kind === 'html' ? bytes.subarray(0, 60).toString('utf8') : bytes.subarray(0, 2).toString('latin1')
    return { name: name, size: stats.size, magic: magic }
  }

  /** Probes the shipped doc-rs binary with --probe (no page involved). */
  converterProbe() {
    const binary = path.join(
      REPO,
      'resources/bin',
      process.arch === 'arm64' ? 'doc-rs-arm64.exe' : 'doc-rs-x64.exe'
    )
    if (!existsSync(binary)) return { exists: false, code: null, output: '' }
    const result = spawnSync(binary, ['--probe'], { encoding: 'utf8', timeout: 30000, windowsHide: true })
    const output = ((result.stdout || '') + (result.stderr || '')).trim()
    return {
      exists: true,
      code: result.status,
      output: output.split(/\r?\n/).slice(0, 6).join(' | ').slice(0, 300)
    }
  }

  /** conf.user.json of the isolated profile; the folder name is app.getName(). */
  readConf() {
    const candidates = [path.join(this.dir, 'conf.user.json')]
    try {
      for (const entry of readdirSync(this.dir, { withFileTypes: true })) {
        if (entry.isDirectory()) candidates.push(path.join(this.dir, entry.name, 'conf.user.json'))
      }
    } catch {
      // no profile written yet
    }
    for (const candidate of candidates) {
      try {
        return JSON.parse(readFileSync(candidate, 'utf8'))
      } catch {
        continue
      }
    }
    return null
  }

  /** Reads the applied stylesheets through the CSS domain (file:// sheets are opaque to page JS). */
  async cssScan() {
    const sheets = []
    const off = this.page.on('CSS.styleSheetAdded', (params) => sheets.push(params.header))
    await this.page.send('DOM.enable')
    await this.page.send('CSS.enable')
    await sleep(500)
    let width = null
    let height = null
    let thumb = null
    let nightThumb = null
    let sheetCount = 0
    for (const sheet of sheets) {
      let text = ''
      try {
        const result = await this.page.send('CSS.getStyleSheetText', {
          styleSheetId: sheet.styleSheetId
        })
        text = result.text || ''
      } catch {
        continue
      }
      if (text.indexOf('::-webkit-scrollbar') < 0) continue
      sheetCount += 1
      const block = /::-webkit-scrollbar\s*\{([^}]*)\}/.exec(text)
      if (block) {
        const w = /width:\s*([^;}]+)/.exec(block[1])
        const h = /height:\s*([^;}]+)/.exec(block[1])
        if (w && width === null) width = w[1].trim()
        if (h && height === null) height = h[1].trim()
      }
      const thumbBlock = /::-webkit-scrollbar-thumb\s*\{([^}]*)\}/.exec(text)
      if (thumbBlock && thumb === null) {
        const bg = /background:\s*([^;}]+)/.exec(thumbBlock[1])
        if (bg) thumb = bg[1].trim()
      }
      const night = /\[data-theme=["']?night["']?\][^{]*::-webkit-scrollbar-thumb[^{]*\{([^}]*)\}/.exec(text)
      if (night && nightThumb === null) {
        const bg = /background:\s*([^;}]+)/.exec(night[1])
        if (bg) nightThumb = bg[1].trim()
      }
    }
    off()
    try {
      await this.page.send('CSS.disable')
    } catch {
      // already gone
    }
    return { sheets: sheetCount, width: width, height: height, thumb: thumb, nightThumb: nightThumb }
  }

  fileStat(target) {
    try {
      const stats = statSync(target)
      return { exists: true, size: stats.size }
    } catch {
      return { exists: false, size: 0 }
    }
  }

  /** Connects to the preferences window (reloading it so its state is fresh). */
  async prefsSession() {
    await this.clickMenuItem('file.preferences')
    const target = await poll(
      async () => {
        const list = await httpJson('http://127.0.0.1:' + this.webPort + '/json/list')
        return list.find((entry) => /preferences\.html/.test(entry.url)) ?? null
      },
      { timeoutMs: 15000, intervalMs: 120, label: 'preferences window' }
    ).catch(async () => {
      const list = await httpJson('http://127.0.0.1:' + this.webPort + '/json/list')
      return list.find((entry) => /preferences\.html/.test(entry.url)) ?? null
    })
    if (!target) throw new Error('preferences window not found')
    const session = await Cdp.connect(target.webSocketDebuggerUrl)
    await session.send('Runtime.enable')
    await session.send('Page.enable')
    await session.send('Page.reload', { ignoreCache: false })
    await sleep(500)
    return session
  }

  /** Types into the preferences search box and reports how many rows survive. */
  async prefsSearch() {
    const session = await this.prefsSession()
    try {
      const count = () =>
        session.evaluate(
          'document.querySelectorAll(".nav-group-item").length + "|" + document.querySelectorAll(".input-group-content > .row").length + "|" + document.querySelectorAll(".nav-group-item.no-search-hit").length',
          { awaitPromise: false }
        )
      await poll(
        async () => {
          const probe = String(await count()).split('|')
          return Number(probe[1]) > 0 ? probe : null
        },
        { timeoutMs: 12000, intervalMs: 120, label: 'preferences rows' }
      )
      const before = String(await count()).split('|')
      const box = await poll(
        async () =>
          session.evaluate(
            '(() => { const input = document.querySelector(".search-input"); if (!input) return null; const r = input.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()',
            { awaitPromise: false }
          ),
        { timeoutMs: 10000, intervalMs: 120, label: 'preferences search box' }
      )
      await clickAt(session, box.x, box.y)
      await sleep(150)
      await typeText(session, '主题')
      await sleep(350)
      const after = String(await count()).split('|')
      const detail = await session.evaluate(
        '(() => ({ focus: document.activeElement ? document.activeElement.className : null, query: (document.querySelector(".search-input") || {}).value || "" }))()',
        { awaitPromise: false }
      )
      return {
        all: Number(before[1]),
        matched: Number(after[1]),
        dimmed: Number(after[2]),
        focus: detail.focus,
        query: detail.query
      }
    } finally {
      session.close()
    }
  }

  /** Clicks the 重置 button of the preferences window. */
  async prefsReset() {
    const session = await this.prefsSession()
    try {
      const button = await poll(
        async () =>
          session.evaluate(
            '(() => { const btn = document.querySelector(".header-action"); if (!btn) return null; const r = btn.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()',
            { awaitPromise: false }
          ),
        { timeoutMs: 10000, intervalMs: 120, label: 'preferences reset button' }
      )
      await clickAt(session, button.x, button.y)
      await sleep(600)
      return true
    } finally {
      session.close()
    }
  }

  /** Clicks one control of the preferences window and reports the checkbox before/after. */
  async prefsClick(label, panel) {
    await this.clickMenuItem('file.preferences')
    const target = await poll(
      async () => {
        const list = await httpJson('http://127.0.0.1:' + this.webPort + '/json/list')
        return list.find((entry) => /preferences\.html/.test(entry.url)) ?? null
      },
      { timeoutMs: 15000, intervalMs: 120, label: 'preferences window' }
    )
    const session = await Cdp.connect(target.webSocketDebuggerUrl)
    try {
      await session.send('Runtime.enable')
      await session.send('Page.enable')
      await session.send('Page.reload', { ignoreCache: false })
      if (panel) {
        const nav = await poll(
          async () =>
            session.evaluate(
              '(() => {' +
                '  const items = Array.prototype.slice.call(document.querySelectorAll(".nav-group-item"));' +
                '  const item = items.find((entry) => (entry.textContent || "").indexOf(' +
                JSON.stringify(panel) +
                ') >= 0);' +
                '  if (!item) return items.length ? { missing: true } : null;' +
                '  const box = item.getBoundingClientRect();' +
                '  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };' +
                '})()',
              { awaitPromise: false }
            ),
          { timeoutMs: 15000, intervalMs: 120, label: 'preference panel ' + panel }
        )
        if (!nav.missing) {
          await clickAt(session, nav.x, nav.y)
          await sleep(350)
        }
      }
      const rect = await poll(
        async () =>
          session.evaluate(
            '(() => {' +
              '  const rows = Array.prototype.slice.call(document.querySelectorAll(".row"));' +
              '  if (rows.length === 0) return null;' +
              '  const row = rows.find((entry) => (entry.textContent || "").indexOf(' +
              JSON.stringify(label) +
              ') >= 0);' +
              '  if (!row) return { missing: true, labels: rows.slice(0, 30).map((entry) => (entry.textContent || "").trim().slice(0, 24)) };' +
              '  const input = row.querySelector("input[type=checkbox]");' +
              '  if (!input) return { missing: true, labels: ["row has no checkbox"] };' +
              '  input.scrollIntoView({ block: "center" });' +
              '  const box = input.getBoundingClientRect();' +
              '  return { x: box.left + box.width / 2, y: box.top + box.height / 2, before: input.checked };' +
              '})()',
            { awaitPromise: false }
          ),
        { timeoutMs: 15000, intervalMs: 120, label: 'preference row ' + label }
      )
      if (rect.missing) return { clicked: false, before: null, labels: rect.labels }
      await clickAt(session, rect.x, rect.y)
      await sleep(400)
      return { before: rect.before, clicked: true, labels: [] }
    } finally {
      session.close()
    }
  }
}

/* --------------------------------------------------------------- the run */

function parseResult(value, check) {
  if (value === true || value === false) return { expect: true, actual: value }
  if (value && typeof value === 'object' && 'actual' in value) {
    return { expect: value.expect, actual: value.actual }
  }
  return { expect: '(probe must return { expect, actual })', actual: value ?? null, malformed: true }
}

function pad(text, width) {
  const value = String(text)
  return value.length >= width ? value : value + ' '.repeat(width - value.length)
}

async function main() {
  preflight()
  const selected = CHECKS.filter((check) => !only || check.area === only || check.id.startsWith(only))
  if (selected.length === 0) {
    console.error('no checks selected (--only ' + only + ')')
    process.exit(2)
  }

  const app = new App()
  const results = []
  let fatal = null
  const onSignal = () => {
    killTree(app.child?.pid)
    process.exit(130)
  }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)

  try {
    await app.start()
    // a shared starting point: every check resets before it applies its own patch
    await app.evalInPage('window.api.settings.reset().then(() => true)')

    for (const check of selected) {
      const startedAt = Date.now()
      let verdict = { status: 'FAIL', expect: null, actual: null, error: null }

      try {
        if (await app.ensureAlive()) console.log('      (window was gone -- app relaunched)')
        await app.evalInPage('window.api.settings.reset().then(() => true)')
        if (check.settings) {
          await app.evalInPage(
            'window.api.settings.patch(' + JSON.stringify(check.settings) + ').then(() => true)'
          )
        }
        writeFileSync(app.docPath, check.initial ?? '', 'utf8')
        await app.reload()
        const value = await app.evalInPage(
          '(async (H) => {' +
            '  if (!H) throw new Error("parity helper missing: the page booted before the bridge was armed");' +
            '  return (' + check.probe + ');' +
            '})(window.__parity)'
        )
        const parsed = parseResult(value, check)
        const same = !parsed.malformed && canonical(parsed.expect) === canonical(parsed.actual)
        verdict = {
          status: same ? 'PASS' : 'FAIL',
          expect: parsed.expect,
          actual: parsed.actual,
          error: null
        }
      } catch (error) {
        verdict = {
          status: 'FAIL',
          expect: null,
          actual: null,
          error: String((error && error.message) || error).split('\n')[0]
        }
      }

      results.push({ check: check, verdict: verdict, ms: Date.now() - startedAt })
      const line =
        verdict.status +
        '  ' +
        pad(check.id, 30) +
        (verdict.status === 'PASS' && !verbose ? '' : check.description)
      console.log(line)
      if (verdict.status === 'FAIL') {
        if (verdict.error) console.log('      error   ' + clip(verdict.error))
        else {
          console.log('      expect  ' + clip(verdict.expect))
          console.log('      actual  ' + clip(verdict.actual))
        }
      }
    }
  } catch (error) {
    fatal = error
    console.error('\nFATAL  ' + String((error && error.stack) || error))
    try {
      console.error('--- app log tail ---\n' + readFileSync(app.logPath, 'utf8').slice(-1500))
    } catch {
      // no log
    }
  } finally {
    await app.stop()
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
  }

  if (fatal) {
    console.log('\nTOTAL ' + results.length + ' | PASS ' + results.filter((r) => r.verdict.status === 'PASS').length + ' | FAIL ' + (results.filter((r) => r.verdict.status === 'FAIL').length + 1) + ' (run aborted)')
    process.exit(1)
  }

  const areas = []
  for (const result of results) {
    let entry = areas.find((item) => item.area === result.check.area)
    if (!entry) {
      entry = { area: result.check.area, total: 0, pass: 0, fail: 0 }
      areas.push(entry)
    }
    entry.total += 1
    if (result.verdict.status === 'PASS') entry.pass += 1
    else entry.fail += 1
  }

  console.log('\n--- per area ---')
  console.log(pad('AREA', 18) + pad('TOTAL', 7) + pad('PASS', 7) + 'FAIL')
  for (const entry of areas) {
    console.log(pad(entry.area, 18) + pad(entry.total, 7) + pad(entry.pass, 7) + entry.fail)
  }

  const failed = results.filter((result) => result.verdict.status === 'FAIL')
  if (failed.length > 0) {
    console.log('\n--- differences ---')
    for (const result of failed) {
      console.log('[' + result.check.area + '] ' + result.check.id + ' — ' + result.check.description)
      if (result.verdict.error) console.log('    error   ' + clip(result.verdict.error))
      else {
        console.log('    expect  ' + clip(result.verdict.expect))
        console.log('    actual  ' + clip(result.verdict.actual))
      }
    }
  }

  const pass = results.length - failed.length
  console.log('\nTOTAL ' + results.length + ' | PASS ' + pass + ' | FAIL ' + failed.length)
  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch(async (error) => {
  console.error('FATAL ' + String((error && error.stack) || error))
  process.exit(1)
})
