import { describe, expect, it, vi } from "vitest";

const { detectOptionalTools, testCliConnection, validToolCommand } = require("./toolDetection");

describe("optional agent CLI detection", () => {
  it("checks Codex and Claude independently", async () => {
    const detect = vi.fn(async (command: string) => (
      command === "codex-local"
        ? { available: true, version: "codex 1" }
        : { available: false, version: null }
    ));
    const result = await detectOptionalTools({
      codexCommand: "codex-local",
      claudeCommand: "claude-local",
      detect,
      env: { PATH: "C:\\Windows" },
    });
    expect(result.codex).toEqual({ available: true, version: "codex 1" });
    expect(result.claude).toEqual({ available: false, version: null });
    expect(detect.mock.calls.map((call) => call[0])).toEqual(["codex-local", "claude-local"]);
  });

  it("rejects shell metacharacters in configured commands", () => {
    expect(validToolCommand("C:\\Program Files\\Codex\\codex.exe")).toBe(true);
    expect(validToolCommand("codex & whoami")).toBe(false);
    expect(validToolCommand("%COMSPEC%")).toBe(false);
    expect(validToolCommand("codex (unsafe)")).toBe(false);
  });

  it("reports installation and authentication as separate parts of a CLI test", async () => {
    const spawnImpl = vi.fn()
      .mockImplementationOnce((_command, _args, options) => fakeChild(0, "codex-cli 1.0", options))
      .mockImplementationOnce((_command, _args, options) => fakeChild(1, "not logged in", options));

    await expect(testCliConnection("codex-cli", "codex", { spawnImpl, platform: "linux" }))
      .resolves.toEqual({
        kind: "codex-cli",
        ok: false,
        version: "codex-cli 1.0",
        detail: "Codex CLI is installed but not authenticated. Sign in from a terminal and test again.",
      });
    expect(spawnImpl.mock.calls.map((call) => call[1])).toEqual([["--version"], ["login", "status"]]);
  });
});

function fakeChild(code: number, output: string, options: { stdio: string[] }) {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const stdoutListeners = new Map<string, (value: Buffer) => void>();
  const child = {
    stdout: { on: (name: string, callback: (value: Buffer) => void) => stdoutListeners.set(name, callback) },
    stderr: { on: () => undefined },
    on: (name: string, callback: (...args: unknown[]) => void) => {
      listeners.set(name, callback);
      if (name === "exit") queueMicrotask(() => {
        stdoutListeners.get("data")?.(Buffer.from(output));
        callback(code);
      });
    },
    kill: vi.fn(),
  };
  expect(options.stdio).toEqual(["ignore", "pipe", "pipe"]);
  return child;
}
