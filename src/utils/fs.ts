import { mkdir, readdir, rm } from "node:fs/promises"
import { dirname } from "./path"

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
}

export async function readText(file: string): Promise<string> {
  return Bun.file(file).text()
}

export async function writeText(file: string, text: string): Promise<void> {
  await ensureDir(dirname(file))
  await Bun.write(file, text)
}

export async function readJson<T>(file: string): Promise<T> {
  const raw = await readText(file)
  return JSON.parse(raw) as T
}

export async function writeJson(file: string, data: unknown): Promise<void> {
  await writeText(file, JSON.stringify(data, null, 2))
}

export async function listFiles(dir: string): Promise<string[]> {
  try {
    const files = await readdir(dir)
    return files.filter((f) => !f.startsWith("."))
  } catch {
    return []
  }
}

export async function removeFile(file: string): Promise<void> {
  await rm(file, { force: true })
}
