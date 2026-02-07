import { dirname } from "./path"

type RunResult = {
  code: number
  stdout: string
}

async function run(cmd: string[], cwd?: string): Promise<RunResult> {
  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = await new Response(proc.stdout).text()
  await proc.exited
  return { code: proc.exitCode ?? 1, stdout }
}

export async function ensureDir(dir: string): Promise<void> {
  await run(["mkdir", "-p", dir])
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
  const result = await run(["ls", "-1", dir])
  if (result.code !== 0) return []
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

export async function removeFile(file: string): Promise<void> {
  await run(["rm", "-f", file])
}
