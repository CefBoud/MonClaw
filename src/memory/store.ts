import { ensureDir, readText, writeText } from "../utils/fs"
import { joinPath } from "../utils/path"

export class MemoryStore {
  constructor(private readonly rootDir: string) {}

  private get filePath(): string {
    return joinPath(this.rootDir, "MEMORY.md")
  }

  async init(): Promise<void> {
    await ensureDir(this.rootDir)
    await this.ensureFile(this.filePath, "# Memory\n")
  }

  async readAll(): Promise<string> {
    await this.ensureFile(this.filePath, "# Memory\n")
    return readText(this.filePath)
  }

  async append(note: string, source?: string): Promise<void> {
    await this.ensureFile(this.filePath, "# Memory\n")
    const prefix = source ? `- (${source}) ` : "- "
    const existing = await readText(this.filePath)
    await writeText(this.filePath, `${existing}${prefix}${note.trim()}\n`)
  }

  private async ensureFile(file: string, initialContent = ""): Promise<void> {
    try {
      await readText(file)
    } catch {
      await writeText(file, initialContent)
    }
  }
}
