import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createTerminalHistory } = require("./terminalHistory");
const roots: string[] = [];
const secureStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text: string) => Buffer.from(text).map(byte => byte ^ 0x55),
  decryptString: (bytes: Buffer) => Buffer.from(bytes).map(byte => byte ^ 0x55).toString(),
};
function fixture(replayLimit = 512_000) {
  const directory = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "mi-history-test-")));
  roots.push(directory);
  return { directory, history: createTerminalHistory({ directory, secureStorage, replayLimit }) };
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("private terminal history", () => {
  it("restores encrypted output after a new store instance and isolates workspace/session identities", () => {
    const { history, directory } = fixture();
    history.append("one", "project-a", "saved conversation");
    history.append("two", "project-a", "second session");
    const restarted = createTerminalHistory({ directory, secureStorage });
    expect(restarted.load("one", "project-a")).toBe("saved conversation");
    expect(restarted.load("two", "project-a")).toBe("second session");
    expect(restarted.load("one", "project-b")).toBe("");
    for (const file of fs.readdirSync(directory)) {
      expect(fs.readFileSync(path.join(directory, file)).includes(Buffer.from("saved conversation"))).toBe(false);
    }
  });
  it("recovers an interrupted final frame before appending new output", () => {
    const { history, directory } = fixture();
    history.append("one", "a", "before crash");
    const file = path.join(directory, fs.readdirSync(directory)[0]);
    fs.appendFileSync(file, Buffer.from([32, 0, 0, 0, 1, 2]));
    expect(history.load("one", "a")).toBe("before crash");
    history.append("one", "a", " after restart");
    expect(history.load("one", "a")).toBe("before crash after restart");
  });
  it("bounds replay while retaining earlier encrypted frames", () => {
    const { history, directory } = fixture(6);
    history.append("one", "a", "older ");
    history.append("one", "a", "latest");
    expect(history.load("one", "a")).toBe("latest");
    expect(createTerminalHistory({ directory, secureStorage }).load("one", "a")).toBe("older latest");
  });
  it("does not fall back to plaintext when encryption is unavailable", () => {
    const { directory } = fixture();
    const history = createTerminalHistory({ directory, secureStorage: { isEncryptionAvailable: () => false } });
    expect(() => history.append("one", "a", "private")).toThrow(/encryption/);
    expect(fs.readdirSync(directory)).toEqual([]);
  });
  it("rotates bounded segments and only reads recent segments for replay", () => {
    const { directory } = fixture();
    const history = createTerminalHistory({ directory, secureStorage, replayLimit: 6, segmentBytes: 5 });
    history.append("one", "a", "older ");
    history.append("one", "a", "latest");
    expect(fs.readdirSync(directory)).toHaveLength(2);
    expect(history.load("one", "a")).toBe("latest");
    expect(createTerminalHistory({ directory, secureStorage }).load("one", "a")).toBe("older latest");
  });
});
