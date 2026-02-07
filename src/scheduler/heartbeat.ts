import type { Logger } from "pino"
import { AssistantCore } from "../core/assistant"

export function startHeartbeat(intervalMinutes: number, assistant: AssistantCore, logger: Logger): void {
  const ms = Math.max(1, intervalMinutes) * 60_000
  if (!Number.isFinite(ms) || ms <= 0) {
    logger.warn({ intervalMinutes }, "invalid heartbeat interval, skipping")
    return
  }

  let running = false
  const run = async () => {
    if (running) {
      logger.warn("heartbeat run skipped: previous run still active")
      return
    }
    running = true
    const startedAt = Date.now()
    try {
      logger.info("heartbeat run started")
      const result = await assistant.runHeartbeatTasks()
      logger.info({ result, durationMs: Date.now() - startedAt }, "heartbeat run completed")
    } catch (error) {
      logger.error({ error, durationMs: Date.now() - startedAt }, "heartbeat run failed")
    } finally {
      running = false
    }
  }

  void run()
  setInterval(() => {
    void run()
  }, ms)

  logger.info({ intervalMinutes }, "heartbeat scheduler started")
}
