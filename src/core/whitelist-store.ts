import { ensureDir, readJson, writeJson } from "../utils/fs"
import { basename, dirname, relativePath, resolvePath } from "../utils/path"

type Channel = "telegram" | "whatsapp"

type WhitelistData = {
  telegram: string[]
  whatsapp: string[]
}

const DEFAULT_DATA: WhitelistData = {
  telegram: [],
  whatsapp: [],
}

export class WhitelistStore {
  private data: WhitelistData = { ...DEFAULT_DATA }

  constructor(private readonly filePath = resolvePath(Bun.cwd, ".data/whitelist.json")) {}

  async init(): Promise<void> {
    await ensureDir(dirname(this.filePath))
    try {
      const parsed = await readJson<Partial<WhitelistData>>(this.filePath)
      this.data = {
        telegram: Array.isArray(parsed.telegram) ? parsed.telegram.map(String) : [],
        whatsapp: Array.isArray(parsed.whatsapp) ? parsed.whatsapp.map(String) : [],
      }
      await this.persist()
    } catch {
      this.data = { ...DEFAULT_DATA }
      await this.persist()
    }
  }

  isWhitelisted(channel: Channel, userID: string): boolean {
    return this.data[channel].includes(String(userID))
  }

  async add(channel: Channel, userID: string): Promise<boolean> {
    const id = String(userID)
    if (this.data[channel].includes(id)) return false
    this.data[channel].push(id)
    await this.persist()
    return true
  }

  file(): string {
    return this.filePath
  }

  displayFile(): string {
    const rel = relativePath(Bun.cwd, this.filePath)
    return rel.length > 0 ? rel : basename(this.filePath)
  }

  private async persist(): Promise<void> {
    await writeJson(this.filePath, this.data)
  }
}
