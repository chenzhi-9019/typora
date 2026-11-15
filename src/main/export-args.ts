/**
 * Splits the extra converter arguments the user typed in preferences.
 * Quotes are honoured so an argument may contain spaces; broken quoting is
 * reported instead of being handed to the converter.
 */
export function parseExportArgs(raw: string): string[] {
  const trimmed = raw.trim()
  if (trimmed === '') return []
  if (!hasBalancedQuotes(trimmed)) {
    throw new Error(`导出附加参数不合法（引号未闭合）：${raw}`)
  }
  const tokens = trimmed.match(/[^\s"']+|"[^"]*"|'[^']*'/g)
  if (!tokens) throw new Error(`导出附加参数不合法：${raw}`)
  return tokens.map((token) => token.replace(/^["']|["']$/g, ''))
}

function hasBalancedQuotes(value: string): boolean {
  const double = value.split('"').length - 1
  const single = value.split("'").length - 1
  return double % 2 === 0 && single % 2 === 0
}
