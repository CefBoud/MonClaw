import { tool } from "@opencode-ai/plugin"
import * as path from "node:path"
import { existsSync } from "node:fs"
import { mkdir, rm, cp } from "node:fs/promises"

function parseGithubTreeUrl(input) {
  const source = input.trim()
  const tree = source.match(/^https?:\/\/github\.com\/([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)\/tree\/([a-zA-Z0-9_.-]+)\/(.+)$/)
  if (!tree) return null
  return {
    repo: tree[1],
    ref: tree[2],
    subpath: tree[3],
  }
}

function safeName(input) {
  if (input === "." || input === "..") return null
  const sanitized = input.replace(/[^a-zA-Z0-9._-]/g, "-")
  if (sanitized === "." || sanitized === "..") return null
  return sanitized
}

export default async ({ $ }) => {
  const SKILLS_DIR = path.join(process.cwd(), ".agents", "skills")

  return {
    tool: {
      install_skill: tool({
        description: "Install a skill into .agents/skills from a GitHub tree URL.",
        args: {
          source: tool.schema.string().describe("GitHub tree URL to the skill folder"),
          name: tool.schema.string().optional().describe("Optional target skill folder name"),
        },
        async execute(args) {
          await mkdir(SKILLS_DIR, { recursive: true })

          const resolved = parseGithubTreeUrl(args.source)
          if (!resolved) {
            throw new Error("Unsupported source. Use a valid GitHub tree URL (e.g. https://github.com/user/repo/tree/branch/folder).")
          }

          const sourceName = path.basename(resolved.subpath)
          const nameInput = (args.name || sourceName).trim()
          const targetName = safeName(nameInput)

          if (!targetName) {
             throw new Error("Invalid skill name.")
          }

          const targetDir = path.resolve(SKILLS_DIR, targetName)

          if (!targetDir.startsWith(SKILLS_DIR)) {
             throw new Error("Invalid skill name (path traversal detected).")
          }

          if (existsSync(targetDir)) {
            return `Skill '${targetName}' already exists at .agents/skills/${targetName}`
          }

          const tmpDir = path.join(
            process.cwd(),
            ".data",
            `tmp-skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          )

          try {
            await mkdir(tmpDir, { recursive: true })

            await $`git -C ${tmpDir} init`
            await $`git -C ${tmpDir} remote add origin https://github.com/${resolved.repo}.git`
            await $`git -C ${tmpDir} config core.sparseCheckout true`
            await $`git -C ${tmpDir} sparse-checkout set ${resolved.subpath}`
            await $`git -C ${tmpDir} fetch --depth=1 origin ${resolved.ref}`
            await $`git -C ${tmpDir} checkout FETCH_HEAD`

            const srcDir = path.join(tmpDir, resolved.subpath)

            if (!existsSync(srcDir)) throw new Error("Skill source folder not found after checkout.")
            if (!existsSync(path.join(srcDir, "SKILL.md"))) throw new Error("Missing SKILL.md in skill folder.")

            await mkdir(targetDir, { recursive: true })
            await cp(srcDir, targetDir, { recursive: true })

            return `Installed skill '${targetName}' to .agents/skills/${targetName}`
          } finally {
            await rm(tmpDir, { recursive: true, force: true })
          }
        },
      }),
    },
  }
}
