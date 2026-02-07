export function splitTextChunks(text: string, maxLen: number): string[] {
  const input = text.trim()
  if (input.length <= maxLen) return [input]

  const chunks: string[] = []
  let rest = input
  while (rest.length > maxLen) {
    let idx = rest.lastIndexOf("\n", maxLen)
    if (idx < maxLen * 0.5) idx = rest.lastIndexOf(" ", maxLen)
    if (idx <= 0) idx = maxLen
    chunks.push(rest.slice(0, idx).trim())
    rest = rest.slice(idx).trim()
  }
  if (rest.length > 0) chunks.push(rest)
  return chunks
}
