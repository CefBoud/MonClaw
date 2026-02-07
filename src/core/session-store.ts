import { ensureDir, readJson, writeJson } from "../utils/fs"
import { dirname, resolvePath } from "../utils/path"

type SessionData = {
  mainSessionID?: string
  heartbeatSessionID?: string
}

export class SessionStore {
  private cache: SessionData = {}

  constructor(private readonly filePath = resolvePath(Bun.cwd, ".data/sessions.json")) {}

  async init(): Promise<void> {
    await ensureDir(dirname(this.filePath))
    try {
      const obj = await readJson<SessionData>(this.filePath)
      this.cache = {
        mainSessionID: typeof obj.mainSessionID === "string" ? obj.mainSessionID : undefined,
        heartbeatSessionID: typeof obj.heartbeatSessionID === "string" ? obj.heartbeatSessionID : undefined,
      }
    } catch {
      await this.persist()
    }
  }

  getMainSessionID(): string | undefined {
    return this.cache.mainSessionID
  }

  async setMainSessionID(sessionID: string): Promise<void> {
    this.cache.mainSessionID = sessionID
    await this.persist()
  }

  getHeartbeatSessionID(): string | undefined {
    return this.cache.heartbeatSessionID
  }

  async setHeartbeatSessionID(sessionID: string): Promise<void> {
    this.cache.heartbeatSessionID = sessionID
    await this.persist()
  }

  private async persist(): Promise<void> {
    await writeJson(this.filePath, this.cache)
  }
}
