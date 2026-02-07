import { tool } from "@opencode-ai/plugin"

const SEP = "/"
const SKILLS_DIR = joinPath(Bun.cwd, ".agents", "skills")

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

function basename(input) {
  const idx = input.lastIndexOf(SEP)
  return idx === -1 ? input : input.slice(idx + 1)
}

async function run(cmd) {
  const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" })
  await proc.exited
  return proc.exitCode === 0
}

async function exists(path) {
  return run(["test", "-e", path])
}

function parseGithubTreeUrl(input) {
  const source = input.trim()
  const tree = source.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)\/tree\/([^/]+)\/(.+)$/)
  if (!tree) return null
  return {
    repo: tree[1],
    ref: tree[2],
    subpath: tree[3],
  }
}

function safeName(input) {
  return input.replace(/[^a-zA-Z0-9._-]/g, "-")
}

export default async ({ $ }) => {
  return {
    tool: {
      install_skill: tool({
        description: "Install a skill into .agents/skills from a GitHub tree URL.",
        args: {
          source: tool.schema.string().describe("GitHub tree URL to the skill folder"),
          name: tool.schema.string().optional().describe("Optional target skill folder name"),
        },
        async execute(args) {
          await run(["mkdir", "-p", SKILLS_DIR])

          const resolved = parseGithubTreeUrl(args.source)
          if (!resolved) {
            throw new Error("Unsupported source. Use a GitHub tree URL to the skill folder.")
          }
          const sourceName = basename(resolved.subpath)
          const targetName = safeName((args.name || sourceName).trim())
          const targetDir = joinPath(SKILLS_DIR, targetName)

          if (await exists(targetDir)) {
            return `Skill '${targetName}' already exists at .agents/skills/${targetName}`
          }

          const tmpDir = joinPath(
            Bun.cwd,
            ".data",
            `tmp-skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          )
          try {
            await $`mkdir -p ${tmpDir}`
            // Sparse checkout keeps transfer focused on the requested skill folder.
            await $`git -C ${tmpDir} init`
            await $`git -C ${tmpDir} remote add origin https://github.com/${resolved.repo}.git`
            await $`git -C ${tmpDir} config core.sparseCheckout true`
            await $`git -C ${tmpDir} sparse-checkout set ${resolved.subpath}`
            await $`git -C ${tmpDir} fetch --depth=1 origin ${resolved.ref}`
            await $`git -C ${tmpDir} checkout FETCH_HEAD`

            const srcDir = joinPath(tmpDir, resolved.subpath)
            if (!(await exists(srcDir))) throw new Error("Skill source folder not found after checkout.")
            if (!(await exists(joinPath(srcDir, "SKILL.md")))) throw new Error("Missing SKILL.md in skill folder.")

            await $`mkdir -p ${targetDir}`
            await $`cp -R ${srcDir}/. ${targetDir}`

            return `Installed skill '${targetName}' to .agents/skills/${targetName}`
          } finally {
            await $`rm -rf ${tmpDir}`
          }
        },
      }),
    },
  }
}
