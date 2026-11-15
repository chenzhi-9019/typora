/** Characters auto-paired by settings.autoPairBracket. */
export const BRACKET_PAIRS: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '"': '"',
  "'": "'"
}

/** Characters auto-paired by settings.autoPairMarkdown. */
export const MARKDOWN_PAIRS: Record<string, string> = { '`': '`', '*': '*', _: '_' }

/** Conservative typo table behind settings.autoCorrect. */
export const AUTO_CORRECT: Record<string, string> = {
  teh: 'the',
  adn: 'and',
  recieve: 'receive',
  seperate: 'separate',
  definately: 'definitely',
  occured: 'occurred',
  thier: 'their',
  becuase: 'because',
  beacuse: 'because',
  wich: 'which',
  alot: 'a lot',
  dont: "don't",
  cant: "can't",
  wont: "won't",
  isnt: "isn't",
  heres: "here's",
  its: "it's",
  youve: "you've"
}

export interface TypoFix {
  /** start offset of the misspelled word inside the scanned head */
  start: number
  /** end offset (exclusive) of the misspelled word */
  end: number
  replacement: string
}

export function pairCloserFor(
  char: string,
  bracket: boolean,
  markdown: boolean
): string | undefined {
  if (bracket && BRACKET_PAIRS[char] !== undefined) return BRACKET_PAIRS[char]
  if (markdown && MARKDOWN_PAIRS[char] !== undefined) return MARKDOWN_PAIRS[char]
  return undefined
}

export function isClosingPair(char: string, bracket: boolean, markdown: boolean): boolean {
  const closers: string[] = []
  if (bracket) closers.push(...Object.values(BRACKET_PAIRS))
  if (markdown) closers.push(...Object.values(MARKDOWN_PAIRS))
  return closers.includes(char)
}

/**
 * Finds a correctable word that ends right before the last character of `head`
 * (that last character is the word boundary the user just typed).
 */
export function findTypoFix(head: string): TypoFix | null {
  const match = /(^|[\s([{"'])([A-Za-z]{2,})[\s)\]}"',.;:!?]$/.exec(head)
  if (match === null) return null
  const word = match[2]
  const replacement = AUTO_CORRECT[word.toLowerCase()]
  if (replacement === undefined) return null
  const end = head.length - 1
  const start = end - word.length
  if (start < 0) return null
  const cased = /^[A-Z]/.test(word)
    ? replacement.charAt(0).toUpperCase() + replacement.slice(1)
    : replacement
  return { start, end, replacement: cased }
}
