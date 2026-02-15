import { tool } from "@opencode-ai/plugin"
import * as path from "node:path"
import { mkdir, appendFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"

async function ensureMemoryFile(memoryFile) {
  await mkdir(path.dirname(memoryFile), { recursive: true })
  if (!existsSync(memoryFile)) {
    await writeFile(memoryFile, "# Memory\n")
  }
}

export default async () => {
  const memoryFile = path.join(process.cwd(), ".data", "workspace", "MEMORY.md")

  return {
    tool: {
      save_memory: tool({
        description: "Append one durable user fact to .data/workspace/MEMORY.md",
        args: {
          fact: tool.schema.string().describe("A short, stable user fact worth remembering"),
        },
        async execute(args) {
          const fact = args.fact.trim()
          if (!fact) return "Skipped: empty memory fact."
          await ensureMemoryFile(memoryFile)
          await appendFile(memoryFile, `- ${fact}\n`)
          return "Saved durable memory."
        },
      }),
    },
  }
}
