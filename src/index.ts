import { loadConfig } from "./config"
import { startTelegramAdapter } from "./channels/telegram"
import { startWhatsAppAdapter } from "./channels/whatsapp"
import { AssistantCore } from "./core/assistant"
import { SessionStore } from "./core/session-store"
import { WhitelistStore } from "./core/whitelist-store"
import { MemoryStore } from "./memory/store"
import { startHeartbeat } from "./scheduler/heartbeat"
import { createLogger } from "./utils/logger"

// Ensure OpenCode reads AGENTS.md from this workspace by default.
process.env.OPENCODE_CONFIG_DIR ??= Bun.cwd

async function main() {
  const cfg = await loadConfig()
  const logger = createLogger(cfg.logLevel)

  const memory = new MemoryStore(cfg.workspaceDir)
  const sessions = new SessionStore()
  const whitelist = new WhitelistStore(cfg.whitelistFile)
  const assistant = new AssistantCore(logger, memory, sessions, {
    model: cfg.opencodeModel,
    serverUrl: cfg.opencodeServerUrl,
    hostname: cfg.opencodeHostname,
    port: cfg.opencodePort,
    heartbeatFile: cfg.heartbeatFile,
    heartbeatIntervalMinutes: cfg.heartbeatIntervalMinutes,
  })

  await assistant.init()
  await whitelist.init()
  const heartbeatStatus = await assistant.heartbeatTaskStatus()
  if (heartbeatStatus.empty) {
    logger.warn(
      {
        heartbeatFile: heartbeatStatus.file,
      },
      "heartbeat.md is empty. Add one task per line to enable periodic heartbeat. Leaving it empty disables heartbeat.",
    )
  } else {
    startHeartbeat(cfg.heartbeatIntervalMinutes, assistant, logger)
  }

  let shuttingDown = false
  const shutdown = (code: number) => {
    if (shuttingDown) return
    shuttingDown = true
    void assistant.close().finally(() => process.exit(code))
  }

  process.on("SIGINT", () => shutdown(0))
  process.on("SIGTERM", () => shutdown(0))
  process.on("SIGHUP", () => shutdown(0))
  process.on("SIGQUIT", () => shutdown(0))
  process.on("exit", () => {
    void assistant.close()
  })
  process.on("uncaughtException", (error) => {
    logger.error({ error }, "uncaught exception")
    shutdown(1)
  })
  process.on("unhandledRejection", (reason) => {
    logger.error({ reason }, "unhandled rejection")
    shutdown(1)
  })

  const starters: Array<Promise<void>> = []

  if (cfg.enableTelegram) {
    if (!cfg.telegramToken) {
      logger.warn("ENABLE_TELEGRAM is true but TELEGRAM_BOT_TOKEN is missing")
    } else {
      starters.push(
        startTelegramAdapter({
          token: cfg.telegramToken,
          logger,
          assistant,
          whitelist,
          pairToken: cfg.whitelistPairToken,
        }),
      )
    }
  }

  if (cfg.enableWhatsApp) {
    starters.push(
      startWhatsAppAdapter({
        authDir: cfg.whatsAppAuthDir,
        logger,
        assistant,
        whitelist,
        pairToken: cfg.whitelistPairToken,
      }),
    )
  }

  if (starters.length === 0) {
    logger.warn("No channel enabled. Set ENABLE_TELEGRAM and/or ENABLE_WHATSAPP.")
  }

  await Promise.all(starters)
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
