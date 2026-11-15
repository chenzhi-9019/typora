/**
 * Minimal Chrome DevTools Protocol client, dependency-free (Node's global WebSocket).
 *
 * One connection == one debugger target. Requests are correlated by id; events are
 * dispatched to the listeners registered with on(). Nothing is queued, so a caller
 * can await a long Runtime.evaluate while event listeners keep issuing commands.
 */

/** Keys whose CDP description cannot be derived from the character alone. */
export const NAMED_KEYS = {
  Enter: { key: 'Enter', code: 'Enter', vk: 13 },
  Tab: { key: 'Tab', code: 'Tab', vk: 9 },
  Backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
  Delete: { key: 'Delete', code: 'Delete', vk: 46 },
  Escape: { key: 'Escape', code: 'Escape', vk: 27 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  Home: { key: 'Home', code: 'Home', vk: 36 },
  End: { key: 'End', code: 'End', vk: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', vk: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', vk: 34 },
  Space: { key: ' ', code: 'Space', vk: 32 }
}

const PUNCTUATION_CODES = {
  ' ': 'Space',
  '-': 'Minus',
  '=': 'Equal',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '\\': 'Backslash',
  ';': 'Semicolon',
  "'": 'Quote',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  '\x60': 'Backquote',
  '~': 'Backquote',
  '!': 'Digit1',
  '@': 'Digit2',
  '#': 'Digit3',
  $: 'Digit4',
  '%': 'Digit5',
  '^': 'Digit6',
  '&': 'Digit7',
  '*': 'Digit8',
  '(': 'Digit9',
  ')': 'Digit0',
  _: 'Minus',
  '+': 'Equal',
  '{': 'BracketLeft',
  '}': 'BracketRight',
  '|': 'Backslash',
  ':': 'Semicolon',
  '"': 'Quote',
  '<': 'Comma',
  '>': 'Period',
  '?': 'Slash'
}

/** Physical-key description for a printable character, as Chromium would report it. */
function describeChar(char) {
  const upper = char.toUpperCase()
  if (/^[A-Z]$/.test(upper)) return { key: char, code: 'Key' + upper, vk: upper.charCodeAt(0) }
  if (/^[0-9]$/.test(char)) return { key: char, code: 'Digit' + char, vk: char.charCodeAt(0) }
  const code = PUNCTUATION_CODES[char]
  if (code === undefined) return null
  return { key: char, code, vk: 0 }
}

export async function httpJson(url, timeoutMs = 5000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

/** Waits until fn() returns a truthy value, then hands it back. */
export async function poll(fn, { timeoutMs = 15000, intervalMs = 100, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const value = await fn()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  const suffix = lastError ? ' (' + String(lastError.message ?? lastError) + ')' : ''
  throw new Error('timed out waiting for ' + label + suffix)
}

export class Cdp {
  #ws
  #pending = new Map()
  #listeners = new Map()
  #nextId = 1
  #closed = false

  constructor(ws) {
    this.#ws = ws
    ws.addEventListener('message', (event) => this.#dispatch(event.data))
    ws.addEventListener('close', () => {
      this.#closed = true
      for (const [, entry] of this.#pending) entry.reject(new Error('CDP connection closed'))
      this.#pending.clear()
    })
  }

  static async connect(url, { timeoutMs = 10000 } = {}) {
    const ws = new WebSocket(url)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP connect timeout: ' + url)), timeoutMs)
      ws.addEventListener(
        'open',
        () => {
          clearTimeout(timer)
          resolve()
        },
        { once: true }
      )
      ws.addEventListener(
        'error',
        () => {
          clearTimeout(timer)
          reject(new Error('CDP connect failed: ' + url))
        },
        { once: true }
      )
    })
    return new Cdp(ws)
  }

  #dispatch(raw) {
    let message
    try {
      message = JSON.parse(typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8'))
    } catch {
      return
    }
    if (message.id !== undefined) {
      const entry = this.#pending.get(message.id)
      if (!entry) return
      this.#pending.delete(message.id)
      if (message.error) entry.reject(new Error(entry.method + ': ' + message.error.message))
      else entry.resolve(message.result)
      return
    }
    const handlers = this.#listeners.get(message.method)
    if (!handlers) return
    for (const handler of [...handlers]) {
      try {
        handler(message.params)
      } catch (error) {
        console.error('[cdp] listener for ' + message.method + ' threw: ' + String(error))
      }
    }
  }

  get closed() {
    return this.#closed
  }

  send(method, params = {}) {
    if (this.#closed) return Promise.reject(new Error('CDP session already closed'))
    const id = this.#nextId++
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject, method })
      this.#ws.send(JSON.stringify({ id, method, params }))
    })
  }

  on(method, handler) {
    const handlers = this.#listeners.get(method) ?? new Set()
    handlers.add(handler)
    this.#listeners.set(method, handlers)
    return () => handlers.delete(handler)
  }

  waitForEvent(method, { predicate = () => true, timeoutMs = 15000 } = {}) {
    return new Promise((resolve, reject) => {
      const off = this.on(method, (params) => {
        if (!predicate(params)) return
        clearTimeout(timer)
        off()
        resolve(params)
      })
      const timer = setTimeout(() => {
        off()
        reject(new Error('timed out waiting for ' + method))
      }, timeoutMs)
    })
  }

  close() {
    if (this.#closed) return
    this.#closed = true
    try {
      this.#ws.close()
    } catch {
      // already gone
    }
  }

  /** Runtime.evaluate in the default execution context, by value. */
  async evaluate(expression, { awaitPromise = true, timeoutMs } = {}) {
    const params = {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
      allowUnsafeEvalBlockedByCSP: false
    }
    if (timeoutMs !== undefined) params.timeout = timeoutMs
    const result = await this.send('Runtime.evaluate', params)
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails
      const text = detail.exception?.description ?? detail.text ?? 'evaluation failed'
      throw new Error(text)
    }
    return result.result?.value
  }
}

/**
 * Types text one character at a time through Input.dispatchKeyEvent: a raw keydown
 * (so keydown handlers run), a "char" event (which is what actually inserts text),
 * then keyup. Never touches the DOM directly -- that is the whole point.
 */
export async function typeText(cdp, text) {
  for (const char of text) {
    if (char === '\n') {
      await pressKey(cdp, 'Enter')
      continue
    }
    const descriptor = describeChar(char)
    if (descriptor && char.codePointAt(0) < 0x80) {
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        key: descriptor.key,
        code: descriptor.code,
        windowsVirtualKeyCode: descriptor.vk,
        nativeVirtualKeyCode: descriptor.vk
      })
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'char',
        key: char,
        text: char,
        unmodifiedText: char
      })
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: descriptor.key,
        code: descriptor.code,
        windowsVirtualKeyCode: descriptor.vk,
        nativeVirtualKeyCode: descriptor.vk
      })
    } else {
      // non-ASCII arrives the way an IME would deliver it: a bare char event
      await cdp.send('Input.dispatchKeyEvent', { type: 'char', text: char, unmodifiedText: char })
    }
  }
}

const MODIFIER_BITS = { Alt: 1, Control: 2, Meta: 4, Shift: 8 }

/** Presses one named key (and optional modifiers) with a complete down/up pair. */
export async function pressKey(cdp, name, modifiers = []) {
  const descriptor = NAMED_KEYS[name]
  if (!descriptor) throw new Error('unknown key: ' + name)
  let bits = 0
  for (const modifier of modifiers) {
    const bit = MODIFIER_BITS[modifier]
    if (bit === undefined) throw new Error('unknown modifier: ' + modifier)
    bits |= bit
  }
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    modifiers: bits,
    key: descriptor.key,
    code: descriptor.code,
    windowsVirtualKeyCode: descriptor.vk,
    nativeVirtualKeyCode: descriptor.vk
  })
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    modifiers: bits,
    key: descriptor.key,
    code: descriptor.code,
    windowsVirtualKeyCode: descriptor.vk,
    nativeVirtualKeyCode: descriptor.vk
  })
}

/** Ctrl/Cmd + letter, e.g. pressChord(cdp, 'Control', 's'). */
export async function pressChord(cdp, modifier, letter) {
  const upper = letter.toUpperCase()
  const vk = upper.charCodeAt(0)
  const bits = MODIFIER_BITS[modifier] | 0
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    modifiers: bits,
    key: letter,
    code: 'Key' + upper,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk
  })
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    modifiers: bits,
    key: letter,
    code: 'Key' + upper,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk
  })
}

/** A real double click -- how a user selects a word before formatting it. */
export async function dblclickAt(cdp, x, y) {
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x,
    y,
    button: 'none',
    buttons: 0,
    clickCount: 0
  })
  for (const clickCount of [1, 2]) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      buttons: 1,
      clickCount
    })
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      buttons: 0,
      clickCount
    })
  }
}

/** A real mouse click at viewport coordinates. */
export async function clickAt(cdp, x, y) {
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x,
    y,
    button: 'none',
    buttons: 0,
    clickCount: 0
  })
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    buttons: 1,
    clickCount: 1
  })
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    buttons: 0,
    clickCount: 1
  })
}
