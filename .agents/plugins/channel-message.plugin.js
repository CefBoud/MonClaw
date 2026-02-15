import { tool } from "@opencode-ai/plugin"
import * as path from "node:path"
import { mkdir, writeFile, readFile } from "node:fs/promises"

export default async () => {
  const lastChannelFile = path.join(process.cwd(), ".data", "last-channel.json")
  const outboxDir = path.join(process.cwd(), ".data", "outbox")

  return {
    tool: {
      send_channel_message: tool({
        description: "Queue a proactive message to the last used chat channel/user.",
        args: {
          text: tool.schema.string().describe("Plain-text message to send"),
        },
        async execute(args) {
          const text = args.text.trim()
          if (!text) return "Skipped: empty message."

          let target
          try {
            const raw = await readFile(lastChannelFile, "utf-8")
            target = JSON.parse(raw)
          } catch {
            return "No last-used channel found yet."
          }

          if (
            !target ||
            (target.channel !== "telegram" && target.channel !== "whatsapp") ||
            typeof target.userID !== "string"
          ) {
            return "Last-used channel data is invalid."
          }

          await mkdir(outboxDir, { recursive: true })
          const filePath = path.join(outboxDir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`)

          await writeFile(
            filePath,
            JSON.stringify(
              {
                channel: target.channel,
                userID: target.userID,
                text,
                createdAt: new Date().toISOString(),
              },
              null,
              2,
            ),
          )

          return `Queued message for ${target.channel}:${target.userID}`
        },
      }),
    },
  }
}
