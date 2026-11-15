function legacyCopy(text: string): boolean {
  const helper = document.createElement('textarea')
  helper.value = text
  helper.setAttribute('readonly', 'true')
  helper.style.position = 'fixed'
  helper.style.top = '-1000px'
  helper.style.opacity = '0'
  document.body.appendChild(helper)
  helper.select()
  let copied: boolean
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  }
  helper.remove()
  return copied
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    legacyCopy(text)
  }
}

export async function copyPayload(payload: {
  plain: string
  html?: string
  markdown?: string
}): Promise<void> {
  const types: Record<string, Blob> = {
    'text/plain': new Blob([payload.plain], { type: 'text/plain' })
  }
  if (payload.html) types['text/html'] = new Blob([payload.html], { type: 'text/html' })
  try {
    if (typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([new ClipboardItem(types)])
      return
    }
  } catch {
    // fall through to the plain-text path
  }
  await copyText(payload.markdown ?? payload.plain)
}

export async function readClipboardText(): Promise<string> {
  try {
    return await navigator.clipboard.readText()
  } catch {
    return ''
  }
}

export async function copyImageBytes(source: string): Promise<boolean> {
  try {
    const response = await fetch(source)
    const blob = await response.blob()
    if (typeof ClipboardItem === 'undefined') return false
    await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })])
    return true
  } catch {
    return false
  }
}
