import { createOpencode, createOpencodeClient } from "@opencode-ai/sdk";
import { ensureDir, readText, writeText } from "../utils/fs";
import { basename, dirname, relativePath } from "../utils/path";
import { saveLastChannel } from "../utils/last-channel";
import type { Logger } from "pino";
import { MemoryStore } from "../memory/store";
import { SessionStore } from "./session-store";

type AssistantInput = {
  channel: "telegram" | "whatsapp" | "system";
  userID: string;
  text: string;
};

type AssistantOptions = {
  model?: string;
  serverUrl?: string;
  hostname: string;
  port: number;
  heartbeatFile: string;
  heartbeatIntervalMinutes: number;
};

type OpencodeClient = ReturnType<typeof createOpencodeClient>;
type PromptResponse = Awaited<ReturnType<OpencodeClient["session"]["prompt"]>>;
type SessionMessages = Awaited<
  ReturnType<OpencodeClient["session"]["messages"]>
>;
type SessionMessage = NonNullable<SessionMessages["data"]>[number];

type OpencodeRuntime = {
  client: OpencodeClient;
  close?: () => Promise<void> | void;
};

function unwrap<T extends { data: any }>(value: T): T["data"] | never {
  if (value && typeof value === "object" && "data" in value) {
    return value.data;
  }
  return value;
}

function buildModelConfig(
  opencodeModel?: string,
): { providerID: string; modelID: string } | undefined {
  if (!opencodeModel) return undefined;
  const [providerID, ...rest] = opencodeModel.split("/");
  if (!providerID || rest.length === 0) return undefined;
  return { providerID, modelID: rest.join("/") };
}

async function extractPromptText(result: PromptResponse): Promise<string> {
  const payload = unwrap(result);
  if (!payload) return "";

  const directParts = payload.parts;
  if (
    directParts &&
    typeof directParts === "object" &&
    Symbol.asyncIterator in directParts
  ) {
    const chunks: string[] = [];
    for await (const part of directParts) {
      if (part.type === "text") {
        const { text } = part;
        if (text.length > 0) chunks.push(text);
      }
    }
    const merged = chunks.join("").trim();
    if (merged) return merged;
  }

  if (Array.isArray(directParts)) {
    const merged = directParts
      .map((p) => (p.type === "text" ? p.text : ""))
      .join("\n")
      .trim();
    if (merged) return merged;
  }

  const message = payload;
  if (message && typeof message === "object") {
    const msgParts = message.parts;
    if (Array.isArray(msgParts)) {
      const merged = msgParts
        .map((p) => (p && p.type === "text" ? p.text : ""))
        .join("\n")
        .trim();
      if (merged) return merged;
    }
  }

  return "I could not parse the assistant response.";
}

function toMessages(value: SessionMessages) {
  const payload = unwrap(value);
  return payload ?? [];
}

function extractTextFromMessage(message: SessionMessage): string {
  const parts = Array.isArray(message.parts) ? message.parts : [];
  const text = parts
    .map((part) =>
      part?.type === "text" && typeof part.text === "string" ? part.text : "",
    )
    .filter(Boolean)
    .join("\n")
    .trim();
  return text;
}

function buildRecentContext(
  messages: SessionMessage[],
  limit = 6,
  maxChars = 2000,
): string {
  const out: string[] = [];
  let remaining = maxChars;
  for (let i = messages.length - 1; i >= 0 && out.length < limit; i -= 1) {
    const msg = messages[i];
    const role = msg?.info?.role;
    if (!role || (role !== "user" && role !== "assistant")) continue;
    const text = extractTextFromMessage(msg);
    if (!text) continue;
    const snippet = `${role.toUpperCase()}: ${text}`.trim();
    if (snippet.length > remaining) continue;
    out.push(snippet);
    remaining -= snippet.length + 1;
  }
  return out.reverse().join("\n");
}

function latestAssistantMessage(
  messages: SessionMessage[],
): SessionMessage | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.info?.role === "assistant") return messages[i];
  }
  return null;
}

function assistantSignature(message: SessionMessage | null): string {
  if (!message) return "";
  const id = message.info?.id ?? "";
  const text = extractTextFromMessage(message);
  return `${id}::${text}`;
}

function buildAgentSystemPrompt(
  memory: string,
  heartbeatIntervalMinutes: number,
): string {
  return [
    "You are MonClaw, an autonomous assistant agent running on top of OpenCode.",
    "You help with coding and non-coding work: planning, research, writing, operations, and execution tasks.",
    "Be concise, practical, and proactive.",
    "Use native OpenCode plugin tools when relevant.",
    "Output plain text only.",
    "No Markdown under any circumstances.",
    "Never use Markdown markers or structure: no headings, no lists, no code fences, no inline code, no bold/italic, no blockquotes, no links.",
    "Avoid characters commonly used for Markdown formatting (e.g. # * _ ` > -). Use simple sentences instead.",
    "Do not use tables or any rich formatting because replies are shown in non-Markdown chat surfaces.",
    "A heartbeat cron runs in a separate session and its summary is added to the main session.",
    "After heartbeat summaries are added, if the user should be informed, call send_channel_message.",
    "send_channel_message delivers to the last used channel/user.",
    "",
    `Heartbeat interval: ${heartbeatIntervalMinutes} minutes`,
    "",
    "Memory rules:",
    "- MEMORY.md is durable user memory only (stable preferences, profile, constraints, recurring goals).",
    "- Do not store transient one-off chat details.",
    "- When you discover durable memory, call the save_memory tool.",
    "- save_memory takes one short, atomic durable fact per call.",
    "",
    "Skills rules:",
    "- If the user asks to install/pull a skill, use the install_skill tool.",
    "- install_skill supports GitHub tree URLs only.",
    "- Installed skills must be placed under .agents/skills.",
    "- Self-improve: if a task would benefit from a reusable workflow, or repeats, or could be standardized, proactively use skill-creator to draft a new skill after the task is handled.",
    "- Also suggest skill-creator when the user asks for something new that seems like a reusable capability.",
    "",
    "Current memory:",
    memory,
  ].join("\n");
}

async function createRuntime(opts: AssistantOptions): Promise<OpencodeRuntime> {
  if (opts.serverUrl) {
    return { client: createOpencodeClient({ baseUrl: opts.serverUrl }) };
  }

  const fallbackUrl = `http://${opts.hostname}:${opts.port}`;
  try {
    const runtime = await createOpencode({
      hostname: opts.hostname,
      port: opts.port,
      ...(opts.model ? { config: { model: opts.model } } : {}),
    });

    return {
      client: runtime.client,
      close: () => runtime.server.close(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("port") || message.includes("EADDRINUSE")) {
      return { client: createOpencodeClient({ baseUrl: fallbackUrl }) };
    }
    throw error;
  }
}

export class AssistantCore {
  private runtime?: OpencodeRuntime;
  private client?: OpencodeClient;
  private readonly modelConfig?: { providerID: string; modelID: string };
  private readonly opts: AssistantOptions;

  constructor(
    private readonly logger: Logger,
    private readonly memory: MemoryStore,
    private readonly sessions: SessionStore,
    opts: AssistantOptions,
  ) {
    this.opts = opts;
    this.modelConfig = buildModelConfig(opts.model);
  }

  async init(): Promise<void> {
    await this.setupRuntime();
    await this.memory.init();
    await this.sessions.init();
  }

  async ask(input: AssistantInput): Promise<string> {
    const startedAt = Date.now();
    const client = this.ensureClient();
    const sessionID = await this.getOrCreateMainSession();

    if (input.channel === "telegram" || input.channel === "whatsapp") {
      await saveLastChannel(input.channel, input.userID);
    }

    const memoryContext = await this.memory.readAll();
    const systemPrompt = buildAgentSystemPrompt(
      memoryContext,
      this.opts.heartbeatIntervalMinutes,
    );

    this.logger.info(
      {
        channel: input.channel,
        userID: input.userID,
        sessionID,
        textLength: input.text.length,
        memoryContextLength: memoryContext.length,
      },
      "assistant request started",
    );

    let beforeAssistantSig = "";
    try {
      const beforeMessagesResult = await client.session.messages({
        path: { id: sessionID },
      });
      const beforeMessages = toMessages(beforeMessagesResult);
      beforeAssistantSig = assistantSignature(
        latestAssistantMessage(beforeMessages),
      );
    } catch (error) {
      this.logger.warn(
        { error, sessionID },
        "assistant preload messages failed",
      );
    }

    let response: PromptResponse;
    try {
      response = await client.session.prompt({
        path: { id: sessionID },
        body: {
          noReply: false,
          system: systemPrompt,
          parts: [{ type: "text", text: input.text }],
          ...(this.modelConfig ? { model: this.modelConfig } : {}),
        },
      });
    } catch (error) {
      this.logger.error({ error, sessionID }, "assistant prompt call failed");
      throw error;
    }

    const parsedText = await extractPromptText(response);
    let assistantText = parsedText;
    let usedMessagePolling = false;

    if (assistantText === "I could not parse the assistant response.") {
      this.logger.warn(
        { sessionID },
        "assistant response parse failed; polling messages",
      );
      const waitedReply = await this.waitForAssistantReply(
        sessionID,
        beforeAssistantSig,
      );
      if (waitedReply) {
        assistantText = waitedReply;
        usedMessagePolling = true;
      }
    }

    if (assistantText === "I could not parse the assistant response.") {
      const diag = await this.buildNoReplyDiagnostic(sessionID);
      this.logger.error(diag, "assistant no-reply diagnostic");
      assistantText =
        "I did not receive a model reply in time. Please check OpenCode provider auth/model setup.";
    }

    this.logger.info(
      {
        channel: input.channel,
        userID: input.userID,
        sessionID,
        durationMs: Date.now() - startedAt,
        usedMessagePolling,
        answerLength: assistantText.length,
      },
      "assistant request completed",
    );

    return assistantText;
  }

  async startNewMainSession(reason = "manual"): Promise<string> {
    const sessionID = await this.createSession(`main:${reason}`);
    await this.sessions.setMainSessionID(sessionID);
    this.logger.info({ sessionID, reason }, "created new main session");
    return sessionID;
  }

  async remember(note: string, source: string): Promise<void> {
    await this.memory.append(note, source);
  }

  async heartbeatTaskStatus(): Promise<{
    file: string;
    taskCount: number;
    empty: boolean;
  }> {
    const file = this.opts.heartbeatFile;
    const tasks = await this.loadHeartbeatTasks();
    return {
      file: relativePath(Bun.cwd, file) || basename(file),
      taskCount: tasks.length,
      empty: tasks.length === 0,
    };
  }

  async runHeartbeatTasks(): Promise<string> {
    const startedAt = Date.now();
    const tasks = await this.loadHeartbeatTasks();
    if (tasks.length === 0) {
      return "Heartbeat skipped: heartbeat.md has no tasks.";
    }

    const heartbeatSessionID = await this.getOrCreateHeartbeatSession();
    const mainSessionID = await this.getOrCreateMainSession();
    this.logger.info(
      { heartbeatSessionID, mainSessionID, taskCount: tasks.length },
      "heartbeat sessions ready",
    );
    const client = this.ensureClient();

    const memoryContext = await this.memory.readAll();
    const systemPrompt = buildAgentSystemPrompt(
      memoryContext,
      this.opts.heartbeatIntervalMinutes,
    );

    let recentContext = "";
    try {
      const mainMessagesResult = await client.session.messages({
        path: { id: mainSessionID },
      });
      recentContext = buildRecentContext(toMessages(mainMessagesResult));
    } catch (error) {
      this.logger.warn(
        { error, mainSessionID },
        "heartbeat main-session context load failed",
      );
    }

    let beforeAssistantSig = "";
    try {
      const beforeMessagesResult = await client.session.messages({
        path: { id: heartbeatSessionID },
      });
      beforeAssistantSig = assistantSignature(
        latestAssistantMessage(toMessages(beforeMessagesResult)),
      );
    } catch (error) {
      this.logger.warn(
        { error, heartbeatSessionID },
        "heartbeat preload messages failed",
      );
    }
    const prompt = [
      "Run these recurring cron tasks for the project.",
      "Return concise actionable bullet points with findings and next actions.",
      "This is routine task execution, not a healthcheck.",
      "If nothing requires action, explicitly say no action is needed.",
      "",
      recentContext ? "Recent main session context:" : "",
      recentContext,
      recentContext ? "" : "",
      "Task list:",
      ...tasks.map((t, i) => `${i + 1}. ${t}`),
    ].join("\n");

    let response: PromptResponse;
    try {
      response = await client.session.prompt({
        path: { id: heartbeatSessionID },
        body: {
          noReply: false,
          system: systemPrompt,
          parts: [{ type: "text", text: prompt }],
          ...(this.modelConfig ? { model: this.modelConfig } : {}),
        },
      });
    } catch (error) {
      this.logger.error(
        { error, heartbeatSessionID },
        "heartbeat prompt call failed",
      );
      throw error;
    }

    let summary = await extractPromptText(response);
    if (summary === "I could not parse the assistant response.") {
      this.logger.warn(
        { heartbeatSessionID },
        "heartbeat response parse failed; polling messages",
      );
      summary =
        (await this.waitForAssistantReply(
          heartbeatSessionID,
          beforeAssistantSig,
        )) ?? "";
    }
    if (!summary) {
      return "Heartbeat failed: no summary reply from model.";
    }

    try {
      await client.session.prompt({
        path: { id: mainSessionID },
        body: {
          noReply: true,
          parts: [{ type: "text", text: `[Heartbeat summary]\\n${summary}` }],
          ...(this.modelConfig ? { model: this.modelConfig } : {}),
        },
      });
    } catch (error) {
      this.logger.error(
        { error, mainSessionID },
        "heartbeat summary injection failed",
      );
      throw error;
    }

    try {
      await client.session.prompt({
        path: { id: mainSessionID },
        body: {
          noReply: false,
          parts: [
            {
              type: "text",
              text: [
                "Heartbeat summary was added to context.",
                "Decide whether the user should be proactively informed now.",
                "If yes, call send_channel_message with a concise plain-text message.",
                "If not needed, do nothing.",
              ].join("\n"),
            },
          ],
          ...(this.modelConfig ? { model: this.modelConfig } : {}),
        },
      });
    } catch (error) {
      this.logger.error(
        { error, mainSessionID },
        "heartbeat notify prompt failed",
      );
      throw error;
    }

    this.logger.info(
      {
        heartbeatSessionID,
        mainSessionID,
        taskCount: tasks.length,
        durationMs: Date.now() - startedAt,
      },
      "heartbeat task run complete",
    );
    return `Heartbeat completed with ${tasks.length} tasks.`;
  }

  async close(): Promise<void> {
    if (typeof this.runtime?.close === "function") {
      await this.runtime.close();
    }
  }

  private async createSession(key: string): Promise<string> {
    const client = this.ensureClient();
    const session = await client.session.create({
      body: { title: `chat:${key}` },
    });

    const payload = unwrap(session);
    if (!payload) {
      throw new Error("Failed to create session: missing payload");
    }
    const id = payload.id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("Failed to create session: missing id");
    }

    this.logger.info({ key, sessionID: id }, "created OpenCode session");
    return id;
  }

  private async getOrCreateMainSession(): Promise<string> {
    const existing = this.sessions.getMainSessionID();
    if (existing) return existing;
    const created = await this.createSession("main");
    await this.sessions.setMainSessionID(created);
    return created;
  }

  private async getOrCreateHeartbeatSession(): Promise<string> {
    const existing = this.sessions.getHeartbeatSessionID();
    if (existing) return existing;
    const created = await this.createSession("heartbeat");
    await this.sessions.setHeartbeatSessionID(created);
    return created;
  }

  private async waitForAssistantReply(
    sessionID: string,
    beforeAssistantSig: string,
  ): Promise<string | null> {
    const timeoutMs = 60_000;
    const intervalMs = 700;
    const endAt = Date.now() + timeoutMs;
    let pollCount = 0;

    while (Date.now() < endAt) {
      pollCount += 1;
      try {
        const messagesResult = await this.ensureClient().session.messages({
          path: { id: sessionID },
        });
        const messages = toMessages(messagesResult);
        const latestAssistant = latestAssistantMessage(messages);
        const nextSig = assistantSignature(latestAssistant);
        if (latestAssistant && nextSig !== beforeAssistantSig) {
          const text = extractTextFromMessage(latestAssistant);
          if (text.length > 0) return text;
        }
        if (pollCount % 5 === 0) {
          this.logger.info(
            { sessionID, pollCount, currentCount: messages.length },
            "waiting for assistant reply",
          );
        }
      } catch (error) {
        this.logger.warn(
          { error, sessionID, pollCount },
          "polling assistant reply failed",
        );
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    this.logger.warn(
      { sessionID, timeoutMs },
      "assistant reply polling timed out",
    );
    return null;
  }

  private async buildNoReplyDiagnostic(
    sessionID: string,
  ): Promise<Record<string, unknown>> {
    const client = this.ensureClient();
    const out: {
      sessionID: string;
      sessionStatus?: { type: string } | null;
      sessionStatusError?: string;
      configModel?: string | null;
      configError?: string;
      connectedProviders?: string[];
      defaultProviders?: Record<string, string> | null;
      providerError?: string;
      messageCount?: number;
      lastRole?: string | null;
      messagesError?: string;
    } = { sessionID };

    try {
      const statusResult = await client.session.status({});
      const statusData = unwrap(statusResult);
      if (!statusData) {
        throw new Error("Failed to create session: missing status data");
      }
      out.sessionStatus = statusData[sessionID] ?? null;
    } catch (error) {
      out.sessionStatusError =
        error instanceof Error ? error.message : String(error);
    }

    try {
      const configResult = await client.config.get({});
      const config = unwrap(configResult);
      if (!config) {
        throw new Error("Failed to create session: missing config data");
      }
      out.configModel = config.model ?? null;
    } catch (error) {
      out.configError = error instanceof Error ? error.message : String(error);
    }

    try {
      const providers = await client.provider.list({});
      const providerData = unwrap(providers);
      if (!providerData) {
        throw new Error("Failed to create session: missing provider data");
      }
      out.connectedProviders = Array.isArray(providerData.connected)
        ? providerData.connected
        : [];
      out.defaultProviders = providerData.default ?? null;
    } catch (error) {
      out.providerError =
        error instanceof Error ? error.message : String(error);
    }

    try {
      const msgs = await client.session.messages({
        path: { id: sessionID },
      });
      const list = toMessages(msgs);
      out.messageCount = list.length;
      out.lastRole =
        list.length > 0 ? (list[list.length - 1]?.info?.role ?? null) : null;
    } catch (error) {
      out.messagesError =
        error instanceof Error ? error.message : String(error);
    }

    return out;
  }

  private async setupRuntime(): Promise<void> {
    if (this.client) return;
    this.runtime = await createRuntime(this.opts);
    this.client = this.runtime.client;
    if (!this.runtime.close) {
      this.logger.warn(
        "Using existing OpenCode server instance (no local server spawned)",
      );
    }
  }

  private ensureClient(): OpencodeClient {
    if (!this.client) {
      throw new Error(
        "AssistantCore is not initialized. Call init() before ask()/heartbeat().",
      );
    }
    return this.client;
  }

  private async loadHeartbeatTasks(): Promise<string[]> {
    const file = this.opts.heartbeatFile;
    await ensureDir(dirname(file));
    try {
      await readText(file);
    } catch {
      await writeText(file, "");
      return [];
    }

    const content = await readText(file);
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      .map((line) => line.replace(/^[-*]\s+/, ""))
      .filter((line) => line.length > 0);
  }
}
