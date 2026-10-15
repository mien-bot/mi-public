import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { appendReplayOutput, createTerminalManager, shellArgsFor } = require("./terminalManager.js");

function fakePty() {
  let onData: ((data: string) => void) | undefined;
  let onExit: ((event: { exitCode: number; signal?: number }) => void) | undefined;
  const terminal = {
    onData: vi.fn((callback) => { onData = callback; }),
    onExit: vi.fn((callback) => { onExit = callback; }),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
  };
  return {
    pty: { spawn: vi.fn(() => terminal) },
    terminal,
    emitData: (data: string) => onData?.(data),
    emitExit: (exitCode: number) => onExit?.({ exitCode }),
  };
}

describe("terminal manager", () => {
  it("keeps a running shell reachable after a confirmed folder change and restarts in the new folder", () => {
    const fake = fakePty();
    let folder = "old";
    const manager = createTerminalManager({ pty: fake.pty, resolveCwd: () => folder, send: vi.fn() });
    const options = { cwd: "projects/current", sessionKey: "workspace:projects/current" };
    const first = manager.create(options);
    folder = "new";
    const attached = manager.create(options);
    expect(attached.id).toBe(first.id);
    expect(attached.replay).toContain("confirmed folder has changed");
    expect(fake.terminal.kill).not.toHaveBeenCalled();
    expect(fake.terminal.write).not.toHaveBeenCalled();
    manager.kill(first.id);
    manager.create(options);
    expect(fake.pty.spawn).toHaveBeenLastCalledWith(expect.any(String), expect.any(Array), expect.objectContaining({ cwd: "new" }));
  });
  it("contains native PTY and closing-window errors without losing other sessions", () => {
    const fake = fakePty();
    const manager = createTerminalManager({ pty: fake.pty, resolveCwd: (cwd: string) => cwd, send: () => { throw new Error("closed"); } });
    const { id } = manager.create({ cwd: "a" });
    for (const operation of [fake.terminal.write, fake.terminal.resize, fake.terminal.kill]) {
      operation.mockImplementation(() => { throw new Error("PTY exited"); });
    }
    expect(() => fake.emitData("output")).not.toThrow();
    expect(() => manager.write(id, "x")).not.toThrow();
    expect(() => manager.resize(id, 100, 30)).not.toThrow();
    expect(() => manager.killAll()).not.toThrow();
  });
  it("limits live shells without evicting an existing project session", () => {
    const fake = fakePty();
    const manager = createTerminalManager({ pty: fake.pty, resolveCwd: (cwd: string) => cwd, send: vi.fn(), maxTerminals: 1 });
    const first = manager.create({ cwd: "a", sessionKey: "a" });
    expect(() => manager.create({ cwd: "b", sessionKey: "b" })).toThrow(/Exit an unused shell/);
    expect(manager.create({ cwd: "a", sessionKey: "a" }).id).toBe(first.id);
  });
  it("records output before shutdown and restores it without executing previous commands", () => {
    const fake = fakePty();
    const history = { load: vi.fn(() => "previous output"), append: vi.fn() };
    const manager = createTerminalManager({ pty: fake.pty, resolveCwd: (cwd: string) => cwd, send: vi.fn(), history });
    const result = manager.create({ cwd: "a", sessionKey: "a" });
    expect(result.replay).toContain("previous output");
    expect(result.replay).toContain("previous running commands were not restarted");
    fake.emitData("new output");
    manager.killAll();
    expect(history.append).toHaveBeenCalledWith("a", "a", "new output");
    expect(fake.terminal.write).not.toHaveBeenCalled();
  });
  it("starts a PTY at the contained project cwd and forwards data", () => {
    const fake = fakePty();
    const send = vi.fn();
    const manager = createTerminalManager({
      pty: fake.pty,
      resolveCwd: (cwd: string) => `C:\\repo\\${cwd}`,
      send,
      shell: "cmd.exe",
      platform: "win32",
      env: { PATH: "test" },
      sessionEnvironment: ({ cwd }: { cwd: string }) => ({ MI_SCOPED_TEST: cwd }),
    });

    const { id } = manager.create({ cwd: "projects/demo", cols: 120, rows: 40 });
    fake.emitData("ready");

    expect(fake.pty.spawn).toHaveBeenCalledWith("cmd.exe", [
      "/Q",
      "/K",
      'doskey codex=codex --no-alt-screen -c service_tier="fast" -c features.fast_mode=true $*',
    ], expect.objectContaining({
      cwd: "C:\\repo\\projects/demo",
      cols: 120,
      rows: 40,
      name: "xterm-256color",
      env: expect.objectContaining({ MI_AGENT_SESSION_ID: expect.stringMatching(/^terminal-/) }),
    }));
    expect(fake.pty.spawn.mock.calls[0][2].env).toMatchObject({ MI_SCOPED_TEST: "projects/demo" });
    expect(send).toHaveBeenCalledWith("terminal:data", { id, data: "ready" });
  });

  it("forwards input and resize operations to the PTY", () => {
    const fake = fakePty();
    const manager = createTerminalManager({
      pty: fake.pty,
      resolveCwd: (cwd: string) => cwd,
      send: vi.fn(),
    });

    const { id } = manager.create({ cwd: ".", cols: 0, rows: 0 });
    manager.write(id, "git status\r");
    manager.resize(id, 132, 36);
    manager.resize(id, 132, 36);

    expect(fake.pty.spawn).toHaveBeenCalledWith(expect.any(String), expect.any(Array), expect.objectContaining({
      cols: 80,
      rows: 24,
    }));
    expect(fake.terminal.write).toHaveBeenCalledWith("git status\r");
    expect(fake.terminal.resize).toHaveBeenCalledWith(132, 36);
    expect(fake.terminal.resize).toHaveBeenCalledOnce();
  });

  it("uses Codex inline mode for a plain codex command in Mi's Windows cmd shell", () => {
    expect(shellArgsFor("C:\\Windows\\System32\\cmd.exe", "win32")).toEqual([
      "/Q",
      "/K",
      'doskey codex=codex --no-alt-screen -c service_tier="fast" -c features.fast_mode=true $*',
    ]);
    expect(shellArgsFor("powershell.exe", "win32")).toEqual([]);
    expect(shellArgsFor("/bin/bash", "linux")).toEqual([]);
  });

  it("cleans up exited and killed PTYs", () => {
    const fake = fakePty();
    const send = vi.fn();
    const manager = createTerminalManager({
      pty: fake.pty,
      resolveCwd: (cwd: string) => cwd,
      send,
    });

    const first = manager.create({ cwd: "." });
    fake.emitExit(0);
    manager.write(first.id, "ignored");
    expect(fake.terminal.write).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith("terminal:exit", {
      id: first.id,
      exitCode: 0,
      signal: undefined,
    });

    const second = manager.create({ cwd: "." });
    manager.kill(second.id);
    expect(fake.terminal.kill).toHaveBeenCalledOnce();
  });

  it("reattaches to a named session with buffered output instead of spawning again", () => {
    const fake = fakePty();
    const manager = createTerminalManager({
      pty: fake.pty,
      resolveCwd: (cwd: string) => `C:\\Mi\\${cwd}`,
      send: vi.fn(),
      shell: "cmd.exe",
    });

    const first = manager.create({
      cwd: "projects/demo",
      cols: 100,
      rows: 30,
      sessionKey: "project:demo",
    });
    fake.emitData("analysis still running\r\n");
    const attached = manager.create({
      cwd: "projects/demo",
      cols: 132,
      rows: 42,
      sessionKey: "project:demo",
    });

    expect(attached).toEqual({
      id: first.id,
      replay: "analysis still running\r\n",
      reused: true,
    });
    expect(fake.pty.spawn).toHaveBeenCalledOnce();
    expect(fake.pty.spawn).toHaveBeenCalledWith(expect.any(String), expect.any(Array), expect.objectContaining({
      env: expect.objectContaining({ MI_AGENT_SESSION_ID: "project:demo" }),
    }));
    expect(fake.terminal.resize).toHaveBeenLastCalledWith(132, 42);
  });

  it("does not let a session key move to a different workspace", () => {
    const fake = fakePty();
    const manager = createTerminalManager({
      pty: fake.pty,
      resolveCwd: (cwd: string) => `C:\\Mi\\${cwd}`,
      send: vi.fn(),
    });
    manager.create({ cwd: "projects/one", sessionKey: "project:one" });

    expect(() => manager.create({
      cwd: "projects/two",
      sessionKey: "project:one",
    })).toThrow(/different workspace/);
  });

  it("bounds the replay buffer without changing live output forwarding", () => {
    const fake = fakePty();
    const send = vi.fn();
    const manager = createTerminalManager({
      pty: fake.pty,
      resolveCwd: (cwd: string) => cwd,
      send,
      scrollbackBytes: 8,
    });
    const first = manager.create({ cwd: ".", sessionKey: "firm" });
    fake.emitData("123456");
    fake.emitData("7890");

    expect(manager.create({ cwd: ".", sessionKey: "firm" }).replay).toBe("34567890");
    expect(send).toHaveBeenLastCalledWith("terminal:data", { id: first.id, data: "7890" });
  });

  it("trims replay output at a complete line when possible", () => {
    expect(appendReplayOutput("discarded line\nsafe", " output\nlatest", 18)).toBe("safe output\nlatest");
    expect(appendReplayOutput("123456", "7890", 8)).toBe("34567890");
  });
});
