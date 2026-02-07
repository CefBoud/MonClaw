const SEP = "/"

function normalize(input: string): string {
  return input.replace(/\/+/g, SEP)
}

export function joinPath(...parts: string[]): string {
  return normalize(
    parts
      .filter((part) => part !== "")
      .map((part, index) => {
        if (index === 0) return part.replace(/\/+$/g, "")
        return part.replace(/^\/+/g, "").replace(/\/+$/g, "")
      })
      .filter(Boolean)
      .join(SEP),
  )
}

export function resolvePath(...parts: string[]): string {
  let out = ""
  for (const part of parts) {
    if (!part) continue
    if (part.startsWith(SEP)) {
      out = part
    } else {
      out = out ? joinPath(out, part) : part
    }
  }
  return normalize(out || ".")
}

export function dirname(input: string): string {
  const path = normalize(input)
  const idx = path.lastIndexOf(SEP)
  if (idx <= 0) return "."
  return path.slice(0, idx)
}

export function basename(input: string): string {
  const path = normalize(input)
  const idx = path.lastIndexOf(SEP)
  return idx === -1 ? path : path.slice(idx + 1)
}

export function relativePath(base: string, target: string): string {
  const baseNorm = normalize(base).replace(/\/+$/g, "")
  const targetNorm = normalize(target)
  if (targetNorm === baseNorm) return ""
  const prefix = `${baseNorm}/`
  if (targetNorm.startsWith(prefix)) return targetNorm.slice(prefix.length)
  return targetNorm
}
