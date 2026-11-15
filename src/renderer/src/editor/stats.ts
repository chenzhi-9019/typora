export interface TextCount {
  words: number
  chars: number
  nonSpaceChars: number
}

const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu
const WORD_RE = /[\p{L}\p{N}]+(?:['\u2019-][\p{L}\p{N}]+)*/gu
const SPACE_RE = /\s/

/**
 * Counts a document the way Typora's status bar does: every CJK character is one
 * word, every run of other letters/digits is one word.
 */
export function countText(text: string): TextCount {
  const chars = Array.from(text)
  let nonSpaceChars = 0
  for (const char of chars) {
    if (!SPACE_RE.test(char)) nonSpaceChars += 1
  }

  const cjk = text.match(CJK_RE)
  const words = (cjk ? cjk.length : 0) + (text.replace(CJK_RE, ' ').match(WORD_RE)?.length ?? 0)

  return { words, chars: chars.length, nonSpaceChars }
}
