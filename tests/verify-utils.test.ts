import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { joinPath, resolvePath, dirname, basename } from "../src/utils/path";
import { ensureDir, readText, writeText, listFiles, removeFile } from "../src/utils/fs";
import { join } from "node:path";
import { rm, stat } from "node:fs/promises";

const TMP_DIR = ".test-utils-" + Date.now();

beforeAll(async () => {
  await ensureDir(TMP_DIR);
});

afterAll(async () => {
  await rm(TMP_DIR, { recursive: true, force: true });
});

describe("utils/path", () => {
  test("joinPath joins segments", () => {
    expect(joinPath("a", "b")).toBe("a/b");
    expect(joinPath("a", "b", "..", "c")).toBe("a/c");
  });

  test("resolvePath resolves absolute path", () => {
    const cwd = process.cwd();
    expect(resolvePath("a")).toBe(join(cwd, "a"));
  });

  test("dirname returns directory", () => {
    expect(dirname("a/b/c")).toBe("a/b");
  });

  test("basename returns filename", () => {
    expect(basename("a/b/c")).toBe("c");
  });
});

describe("utils/fs", () => {
  test("ensureDir creates directory", async () => {
    const dir = joinPath(TMP_DIR, "subdir");
    await ensureDir(dir);
    const s = await stat(dir);
    expect(s.isDirectory()).toBe(true);
  });

  test("writeText and readText work", async () => {
    const file = joinPath(TMP_DIR, "test.txt");
    await writeText(file, "hello world");
    const content = await readText(file);
    expect(content).toBe("hello world");
  });

  test("listFiles lists files", async () => {
    const dir = joinPath(TMP_DIR, "list-test");
    await ensureDir(dir);
    await writeText(joinPath(dir, "a.txt"), "a");
    await writeText(joinPath(dir, "b.txt"), "b");
    await writeText(joinPath(dir, ".hidden"), "hidden");

    const files = await listFiles(dir);
    expect(files).toContain("a.txt");
    expect(files).toContain("b.txt");
    expect(files).not.toContain(".hidden");
    expect(files.length).toBe(2);
  });

  test("removeFile removes file", async () => {
    const file = joinPath(TMP_DIR, "toremove.txt");
    await writeText(file, "bye");
    await removeFile(file);
    try {
        await stat(file);
        throw new Error("File should be gone");
    } catch (e: any) {
        expect(e.code).toBe("ENOENT");
    }
  });
});
