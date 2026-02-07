import { createOpencode } from "@opencode-ai/sdk"

type SessionMessage = {
  info?: { id?: string; role?: string }
  parts?: Array<{ type?: string; text?: string }>
}

type SdkEnvelope<T> = {
  data?: T
  error?: unknown
  response?: { status?: number }
}

function getData<T>(label: string, value: unknown): T {
  const wrapped = value as SdkEnvelope<T>
  if (wrapped && typeof wrapped === "object" && "error" in wrapped && wrapped.error) {
    throw new Error(`${label} failed: ${JSON.stringify(wrapped.error)}`)
  }
  if (!wrapped || typeof wrapped !== "object" || !("data" in wrapped)) {
    return value as T
  }
  return wrapped.data as T
}

async function tryGetData<T>(label: string, run: () => Promise<unknown>): Promise<{ data?: T; error?: string }> {
  try {
    const value = await run()
    return { data: getData<T>(label, value) }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

function extractAssistantText(messages: SessionMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]
    if (msg?.info?.role !== "assistant") continue

    const text = (msg.parts ?? [])
      .map((part) => (part?.type === "text" && typeof part.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n")
      .trim()

    if (text.length > 0) return text
  }
  return null
}

async function getFreePort(): Promise<number> {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      return new Response("ok")
    },
  })
  const port = server.port
  server.stop()
  return port
}

async function main() {
  const requestedTimeoutMs = Number(Bun.env.E2E_TIMEOUT_MS ?? 10_000)
  const timeoutMs = Math.min(Math.max(requestedTimeoutMs, 1_000), 10_000)
  const pollMs = Number(Bun.env.E2E_POLL_MS ?? 700)
  const port = await getFreePort()
  const modelFromEnv = Bun.env.OPENCODE_MODEL?.trim()
  let model = modelFromEnv && modelFromEnv.length > 0 ? modelFromEnv : ""
  if (!model) {
    const home = Bun.env.HOME ?? ""
    const stateHome = Bun.env.XDG_STATE_HOME ?? `${home}/.local/state`
    const modelFile = `${stateHome}/opencode/model.json`
    try {
      const raw = await Bun.file(modelFile).text()
      const parsed = JSON.parse(raw) as {
        recent?: Array<{ providerID?: string; modelID?: string }>
      }
      const first = parsed.recent?.[0]
      if (first?.providerID && first?.modelID) model = `${first.providerID}/${first.modelID}`
    } catch {
      // Ignore and fail with clear error below.
    }
  }
  if (!model) {
    throw new Error(
      "No model available for E2E. Set OPENCODE_MODEL or set a recent model in ~/.local/state/opencode/model.json.",
    )
  }

  console.log(`[e2e] starting opencode server on 127.0.0.1:${port}`)
  const runtime = await createOpencode({
    hostname: "127.0.0.1",
    port,
    config: { model },
  })

  try {
    const client = runtime.client

    const config = getData<Record<string, unknown>>("config.get", await client.config.get({} as never))
    const activeModel = typeof config.model === "string" ? config.model : null
    if (!activeModel) {
      throw new Error(
        "OpenCode has no model configured (config.model is null). Set OPENCODE_MODEL (provider/model) before running this test.",
      )
    }
    console.log(`[e2e] model: ${activeModel}`)

    const session = getData<{ id: string }>(
      "session.create",
      await client.session.create({ body: { title: "opencode-e2e" } } as never),
    )
    const sessionID = session.id
    if (!sessionID) throw new Error("session.create returned empty id")
    console.log(`[e2e] session created: ${sessionID}`)

    await client.session.prompt({
      path: { id: sessionID },
      body: {
        noReply: false,
        parts: [{ type: "text", text: "Reply with exactly: E2E_OK" }],
      },
    } as never)
    console.log("[e2e] prompt sent; waiting for assistant reply")

    const endAt = Date.now() + timeoutMs
    let loops = 0
    while (Date.now() < endAt) {
      loops += 1
      const messages = getData<SessionMessage[]>(
        "session.messages",
        await client.session.messages({ path: { id: sessionID } } as never),
      )

      const answer = extractAssistantText(messages)
      if (answer) {
        console.log(`[e2e] assistant reply: ${JSON.stringify(answer)}`)
        if (answer.includes("E2E_OK")) {
          console.log("[e2e] PASS")
          process.exit(0)
        }
        throw new Error(`Unexpected assistant content: ${answer}`)
      }

      if (loops % 5 === 0) {
        console.log(`[e2e] waiting... messages=${messages.length}`)
      }

      await new Promise((r) => setTimeout(r, pollMs))
    }

    const providersResult = await tryGetData<Record<string, unknown>>(
      "provider.list",
      async () => await client.provider.list({} as never),
    )
    const messages = getData<SessionMessage[]>(
      "session.messages",
      await client.session.messages({ path: { id: sessionID } } as never),
    )

    throw new Error(
      [
        `Timed out after ${timeoutMs}ms waiting for assistant reply`,
        `model=${JSON.stringify(activeModel)}`,
        `providerListError=${JSON.stringify(providersResult.error ?? null)}`,
        `connectedProviders=${JSON.stringify(providersResult.data?.connected ?? [])}`,
        `messageCount=${messages.length}`,
        `lastRole=${JSON.stringify(messages.at(-1)?.info?.role ?? null)}`,
      ].join(" | "),
    )
  } finally {
    runtime.server.close()
    console.log("[e2e] server closed")
  }
}

void main().catch((error) => {
  console.error("[e2e] FAIL", error instanceof Error ? error.message : String(error))
  process.exit(1)
})
