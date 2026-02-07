import { ensureDir, writeText } from "./fs"
import { dirname, resolvePath } from "./path"

export type LastChannel = {
  channel: "telegram" | "whatsapp"
  userID: string
  updatedAt: string
}

export async function saveLastChannel(channel: LastChannel["channel"], userID: string): Promise<void> {
  const file = resolvePath(Bun.cwd, ".data/last-channel.json")
  await ensureDir(dirname(file))
  await writeText(
    file,
    JSON.stringify(
      {
        channel,
        userID,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  )
}
