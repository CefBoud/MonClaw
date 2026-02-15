import * as path from "node:path"

export function joinPath(...parts: string[]): string {
  return path.join(...parts)
}

export function resolvePath(...parts: string[]): string {
  return path.resolve(...parts)
}

export function dirname(input: string): string {
  return path.dirname(input)
}

export function basename(input: string): string {
  return path.basename(input)
}

export function relativePath(base: string, target: string): string {
  return path.relative(base, target)
}
