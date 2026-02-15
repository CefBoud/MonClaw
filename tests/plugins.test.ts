import { expect, test, describe, beforeAll, afterAll, mock } from "bun:test";
import { rm, readFile, mkdir, writeFile, readdir } from "node:fs/promises";
import * as path from "node:path";
import installSkillPlugin from "../.agents/plugins/install-skill.plugin.js";
import memoryPlugin from "../.agents/plugins/memory.plugin.js";
import channelMessagePlugin from "../.agents/plugins/channel-message.plugin.js";

const TMP_DIR = ".test-plugins-" + Date.now();
const ORIGINAL_CWD = process.cwd();
const ABS_TMP_DIR = path.resolve(ORIGINAL_CWD, TMP_DIR);

beforeAll(async () => {
  await mkdir(ABS_TMP_DIR, { recursive: true });
  process.chdir(ABS_TMP_DIR);
});

afterAll(async () => {
  process.chdir(ORIGINAL_CWD);
  await rm(ABS_TMP_DIR, { recursive: true, force: true });
});

describe("Plugins", () => {
  test("memory plugin appends to MEMORY.md", async () => {
    const p = await memoryPlugin();
    const result = await p.tool.save_memory.execute({ fact: "test fact" });
    expect(result).toBe("Saved durable memory.");

    const content = await readFile(path.join(".data", "workspace", "MEMORY.md"), "utf-8");
    expect(content).toContain("- test fact\n");
  });

  test("channel-message plugin queues message", async () => {
    // Setup last-channel.json
    await mkdir(path.join(".data"), { recursive: true });
    await writeFile(
      path.join(".data", "last-channel.json"),
      JSON.stringify({ channel: "telegram", userID: "123" })
    );

    const p = await channelMessagePlugin();
    const result = await p.tool.send_channel_message.execute({ text: "hello" });
    expect(result).toContain("Queued message for telegram:123");

    const outboxDir = path.join(".data", "outbox");
    const files = await readdir(outboxDir);
    expect(files.length).toBe(1);
    const content = await readFile(path.join(outboxDir, files[0]), "utf-8");
    const json = JSON.parse(content);
    expect(json.text).toBe("hello");
  });

  test("install-skill plugin validates input", async () => {
     const mockDollar = mock((literals, ...values) => {
         return Promise.resolve({ exitCode: 0 }); // Mock git success
     });

     const p = await installSkillPlugin({ $: mockDollar });

     // Invalid URL
     try {
         await p.tool.install_skill.execute({ source: "invalid-url" });
         throw new Error("Should fail on invalid url");
     } catch (e: any) {
         expect(e.message).toContain("Unsupported source");
     }

     // Path traversal via name
     try {
         await p.tool.install_skill.execute({
             source: "https://github.com/user/repo/tree/main/sub",
             name: ".."
         });
         throw new Error("Should fail on .. name");
     } catch (e: any) {
         expect(e.message).toContain("Invalid skill name");
     }

     // Path traversal via name .
     try {
         await p.tool.install_skill.execute({
             source: "https://github.com/user/repo/tree/main/sub",
             name: "."
         });
         throw new Error("Should fail on . name");
     } catch (e: any) {
         expect(e.message).toContain("Invalid skill name");
     }
  });
});
