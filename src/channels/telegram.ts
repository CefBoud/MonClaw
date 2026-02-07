import { Bot } from "grammy"
import type { Logger } from "pino"
import { AssistantCore } from "../core/assistant"
import { WhitelistStore } from "../core/whitelist-store"
import { splitTextChunks } from "../utils/format-message"
import { ackOutbox, listOutbox } from "../utils/outbox"

type TelegramAdapterOptions = {
  token: string
  logger: Logger
  assistant: AssistantCore
  whitelist: WhitelistStore
  pairToken?: string
}

function whitelistInstruction(userID: string, filePath: string): string {
  return [
    "Access restricted.",
    `Your Telegram ID: ${userID}`,
    "Send /pair <token> to whitelist yourself.",
    `If you don't have a token, ask admin to add you under 'telegram' in ${filePath}.`,
  ].join("\n")
}

export async function startTelegramAdapter(opts: TelegramAdapterOptions): Promise<void> {
  const bot = new Bot(opts.token)
  let flushingOutbox = false

  const flushOutbox = async () => {
    if (flushingOutbox) return
    flushingOutbox = true
    try {
      const pending = await listOutbox("telegram")
      for (const item of pending) {
        const chunks = splitTextChunks(item.message.text, 3000)
        for (const chunk of chunks) {
          await bot.api.sendMessage(item.message.userID, chunk)
        }
        await ackOutbox(item.filePath)
        opts.logger.info({ userID: item.message.userID, chunkCount: chunks.length }, "telegram proactive message sent")
      }
    } catch (error) {
      opts.logger.warn({ error }, "telegram outbox flush failed")
    } finally {
      flushingOutbox = false
    }
  }

  bot.command("start", async (ctx) => {
    const userID = String(ctx.from?.id ?? ctx.chat.id)
    const allowed = opts.whitelist.isWhitelisted("telegram", userID)
    opts.logger.info({ chatID: ctx.chat.id, userID, allowed }, "telegram /start")
    if (!allowed) {
      await ctx.reply(whitelistInstruction(userID, opts.whitelist.displayFile()))
      return
    }
    await ctx.reply("MonClaw is online. Try /remember <note>.")
  })

  bot.command("pair", async (ctx) => {
    const userID = String(ctx.from?.id ?? ctx.chat.id)
    const token = ctx.match?.toString().trim() ?? ""
    if (!opts.pairToken) {
      await ctx.reply("Pairing is disabled by admin. Ask admin to whitelist your account.")
      return
    }
    if (!token) {
      await ctx.reply("Usage: /pair <token>")
      return
    }
    if (token !== opts.pairToken) {
      await ctx.reply("Invalid pairing token.")
      return
    }
    const created = await opts.whitelist.add("telegram", userID)
    opts.logger.info({ userID, created }, "telegram pairing")
    await ctx.reply(created ? "Pairing successful. You are now whitelisted." : "You are already whitelisted.")
  })

  bot.command("new", async (ctx) => {
    const userID = String(ctx.from?.id ?? ctx.chat.id)
    const allowed = opts.whitelist.isWhitelisted("telegram", userID)
    if (!allowed) {
      await ctx.reply(whitelistInstruction(userID, opts.whitelist.displayFile()))
      return
    }
    const sessionID = await opts.assistant.startNewMainSession(`telegram:${userID}`)
    await ctx.reply(`Started new shared session: ${sessionID}`)
  })

  bot.command("remember", async (ctx) => {
    const userID = String(ctx.from?.id ?? ctx.chat.id)
    const allowed = opts.whitelist.isWhitelisted("telegram", userID)
    opts.logger.info({ chatID: ctx.chat.id, userID, allowed }, "telegram /remember")
    if (!allowed) {
      await ctx.reply(whitelistInstruction(userID, opts.whitelist.displayFile()))
      return
    }
    const text = ctx.match?.toString().trim() ?? ""
    if (!text) {
      await ctx.reply("Usage: /remember <text>")
      return
    }

    const source = `telegram:${userID}`
    await opts.assistant.remember(text, source)
    await ctx.reply("Saved to long-term memory.")
  })

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim()
    if (!text || text.startsWith("/")) return

    const startedAt = Date.now()
    const userID = String(ctx.from?.id ?? ctx.chat.id)
    const allowed = opts.whitelist.isWhitelisted("telegram", userID)
    opts.logger.info(
      {
        updateID: ctx.update.update_id,
        chatID: ctx.chat.id,
        userID,
        allowed,
        textLength: text.length,
      },
      "telegram message received",
    )
    if (!allowed) {
      await ctx.reply(whitelistInstruction(userID, opts.whitelist.displayFile()))
      return
    }

    let typingTimer: ReturnType<typeof setInterval> | undefined
    try {
      await ctx.replyWithChatAction("typing")
      typingTimer = setInterval(() => {
        void ctx.replyWithChatAction("typing").catch((err) => {
          opts.logger.debug({ err, chatID: ctx.chat.id }, "failed to send typing action")
        })
      }, 3500)

      const answer = await opts.assistant.ask({
        channel: "telegram",
        userID,
        text,
      })

      const chunks = splitTextChunks(answer, 3000)
      for (const chunk of chunks) {
        await ctx.reply(chunk)
      }
      opts.logger.info(
        {
          updateID: ctx.update.update_id,
          chatID: ctx.chat.id,
          userID,
          durationMs: Date.now() - startedAt,
          answerLength: answer.length,
          chunkCount: chunks.length,
        },
        "telegram reply sent",
      )
    } catch (error) {
      opts.logger.error(
        {
          error,
          updateID: ctx.update.update_id,
          chatID: ctx.chat.id,
          userID,
          durationMs: Date.now() - startedAt,
        },
        "telegram message handling failed",
      )
      await ctx.reply("I hit an internal error while preparing the reply. Check server logs.")
    } finally {
      if (typingTimer) clearInterval(typingTimer)
    }
  })

  bot.catch((err) => {
    opts.logger.error({ err, updateID: err.ctx?.update?.update_id }, "telegram bot error")
  })

  const startPromise = bot.start()
  void flushOutbox()
  setInterval(() => {
    void flushOutbox()
  }, 60000)
  opts.logger.info("telegram adapter started")
  await startPromise
}
