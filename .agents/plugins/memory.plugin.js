import { tool } from "@opencode-ai/plugin"

const SEP = "/"
const memoryFile = joinPath(Bun.cwd, ".data", "workspace", "MEMORY.md")

function joinPath(...parts) {
  return parts
    .filter((part) => part !== "")
    .map((part, index) => {
      if (index === 0) return part.replace(/\/+$/g, "")
      return part.replace(/^\/+/g, "").replace(/\/+$/g, "")
    })
    .filter(Boolean)
    .join(SEP)
}

function dirname(input) {
  const idx = input.lastIndexOf(SEP)
  if (idx <= 0) return "."
  return input.slice(0, idx)
}

async function run(cmd) {
  const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" })
  await proc.exited
}

async function ensureMemoryFile() {
  await run(["mkdir", "-p", dirname(memoryFile)])
  try {
    await Bun.file(memoryFile).text()
  } catch {
    await Bun.write(memoryFile, "# Memory\n")
  }
}

export default async () => {
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
          await ensureMemoryFile()
          const existing = await Bun.file(memoryFile).text()
          await Bun.write(memoryFile, `${existing}- ${fact}\n`)
          return "Saved durable memory."
        },
      }),
    },
  }
}
