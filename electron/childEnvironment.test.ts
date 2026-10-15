import { describe, expect, it } from "vitest";

const { agentEnvironmentForEngine, minimizedEnvironment } = require("./childEnvironment");

describe("child process environment", () => {
  it("preserves operating-system launch keys but strips credentials and project roots", () => {
    const env = minimizedEnvironment({
      PATH: "C:\\Windows",
      SystemRoot: "C:\\Windows",
      NOTION_API_KEY: "secret-token",
      DROPBOX_ROOT: "D:\\Dropbox",
      PRIVATE_VALUE: "private",
      CLAUDE_CODE_OAUTH_TOKEN: "source-oauth-token",
      ANTHROPIC_API_KEY: "source-api-key",
    });
    expect(env.PATH).toBe("C:\\Windows");
    expect(env.SystemRoot).toBe("C:\\Windows");
    expect(env).not.toHaveProperty("NOTION_API_KEY");
    expect(env).not.toHaveProperty("DROPBOX_ROOT");
    expect(env).not.toHaveProperty("PRIVATE_VALUE");
    expect(env).not.toHaveProperty("CLAUDE_CODE_OAUTH_TOKEN");
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
  });

  it("adds the subscription token only for an explicitly selected Claude child", () => {
    const source = {
      PATH: "C:\\Windows",
      CLAUDE_CODE_OAUTH_TOKEN: "untrusted-source-token",
      ANTHROPIC_API_KEY: "pay-as-you-go-key",
    };
    const claude = agentEnvironmentForEngine("claude", source, "stored-subscription-token");
    const codex = agentEnvironmentForEngine("codex", source, "stored-subscription-token");
    const terminal = minimizedEnvironment(source);

    expect(claude.CLAUDE_CODE_OAUTH_TOKEN).toBe("stored-subscription-token");
    expect(claude.MI_AGENT_MODE).toBe("chat");
    expect(codex.MI_AGENT_MODE).toBe("chat");
    expect(claude).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(codex).not.toHaveProperty("CLAUDE_CODE_OAUTH_TOKEN");
    expect(codex).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(terminal).not.toHaveProperty("CLAUDE_CODE_OAUTH_TOKEN");
    expect(terminal).not.toHaveProperty("ANTHROPIC_API_KEY");
  });

  it("uses an explicit Mi-supplied mode instead of inferring it from cwd or tools", () => {
    const terminalAgent = agentEnvironmentForEngine("codex", { PATH: "C:\\Windows" }, null, "terminal-agent");
    expect(terminalAgent.MI_AGENT_MODE).toBe("terminal-agent");
  });

  it("allows explicit non-secret Mi loopback context without copying unrelated variables", () => {
    const environment = minimizedEnvironment(
      { PATH: "C:\\Tools", SECRET_VALUE: "do-not-copy" },
      { MI_LOCAL_ORIGIN: "http://127.0.0.1:3210" },
    );
    expect(environment).toMatchObject({
      PATH: "C:\\Tools",
      MI_LOCAL_ORIGIN: "http://127.0.0.1:3210",
    });
    expect(environment).not.toHaveProperty("SECRET_VALUE");
  });

  it("deduplicates case-insensitive Windows environment keys", () => {
    const env = minimizedEnvironment({
      Path: "C:\\Windows\\System32",
      PATH: "C:\\duplicate",
      SystemRoot: "C:\\Windows",
    });

    expect(env.Path).toBe("C:\\Windows\\System32");
    expect(env).not.toHaveProperty("PATH");
  });
});
