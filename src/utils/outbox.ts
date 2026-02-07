import { ensureDir, listFiles, readJson, removeFile } from "./fs"
import { joinPath, resolvePath } from "./path"

export type OutboxMessage = {
  channel: "telegram" | "whatsapp"
  userID: string
  text: string
}

type Pending = {
  filePath: string
  message: OutboxMessage
}

const outboxDir = resolvePath(Bun.cwd, ".data/outbox")

export async function listOutbox(channel: OutboxMessage["channel"]): Promise<Pending[]> {
  await ensureDir(outboxDir)
  const files = await listFiles(outboxDir)
  const pending: Pending[] = []

  for (const name of files.sort()) {
    if (!name.endsWith(".json")) continue
    const filePath = joinPath(outboxDir, name)
    try {
      const msg = await readJson<Partial<OutboxMessage>>(filePath)
      if (msg.channel !== channel) continue
      if (typeof msg.userID !== "string" || typeof msg.text !== "string") continue
      pending.push({ filePath, message: { channel, userID: msg.userID, text: msg.text } })
    } catch {
      // Ignore malformed files.
    }
  }

  return pending
}

export async function ackOutbox(filePath: string): Promise<void> {
  await removeFile(filePath)
}
