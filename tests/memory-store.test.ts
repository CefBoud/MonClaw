import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { MemoryStore } from "../src/memory/store";
import { ensureDir, removeFile, readText } from "../src/utils/fs";
import { joinPath } from "../src/utils/path";
import { rm } from "node:fs/promises";

const TMP_DIR = ".test-memory-" + Date.now();

beforeAll(async () => {
  await ensureDir(TMP_DIR);
});

afterAll(async () => {
  await rm(TMP_DIR, { recursive: true, force: true });
});

describe("MemoryStore", () => {
  test("init creates file", async () => {
    const store = new MemoryStore(TMP_DIR);
    await store.init();
    const content = await store.readAll();
    expect(content).toBe("# Memory\n");
  });

  test("append adds content", async () => {
    const store = new MemoryStore(TMP_DIR);
    await store.append("fact 1");
    await store.append("fact 2", "user");

    const content = await store.readAll();
    expect(content).toContain("# Memory\n");
    expect(content).toContain("- fact 1\n");
    expect(content).toContain("- (user) fact 2\n");
  });

  test("concurrent appends work", async () => {
      const dir = joinPath(TMP_DIR, "concurrent");
      await ensureDir(dir);
      const store = new MemoryStore(dir);
      await store.init();

      const promises = [];
      for (let i = 0; i < 50; i++) {
          promises.push(store.append(`concurrent ${i}`));
      }
      await Promise.all(promises);

      const content = await store.readAll();
      for (let i = 0; i < 50; i++) {
          expect(content).toContain(`- concurrent ${i}\n`);
      }
  });
});
