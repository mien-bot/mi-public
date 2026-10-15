import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { getEngine } = require("./agentEngines.js");

describe("project-scoped agent arguments", () => {
  it("uses a noninteractive read-only Codex sandbox for project chat", () => {
    const args = getEngine("codex").buildArgs({
      sessionId: null,
      model: null,
      images: [],
      readOnly: true,
    });

    expect(args).toContain("never");
    expect(args.slice(args.indexOf("--sandbox"), args.indexOf("--sandbox") + 2)).toEqual([
      "--sandbox",
      "read-only",
    ]);
    expect(args).not.toContain("workspace-write");
  });

  it("uses resume-supported config overrides before the session id", () => {
    const sessionId = "11111111-1111-4111-8111-111111111111";
    const args = getEngine("codex").buildArgs({
      sessionId,
      model: null,
      images: [],
      readOnly: true,
    });

    expect(args.slice(0, 2)).toEqual(["exec", "resume"]);
    expect(args).not.toContain("--sandbox");
    expect(args).toEqual(expect.arrayContaining([
      "-c",
      'sandbox_mode="read-only"',
      'approval_policy="never"',
      'service_tier="fast"',
      "features.fast_mode=true",
    ]));
    expect(args.indexOf('sandbox_mode="read-only"')).toBeLessThan(args.indexOf(sessionId));
    expect(args.slice(-3)).toEqual([sessionId, "-", "--json"]);
  });

  it("enables subscription-backed Codex Fast mode for new and resumed Mi chats", () => {
    const newArgs = getEngine("codex").buildArgs({
      sessionId: null,
      model: null,
      images: [],
    });
    const resumedArgs = getEngine("codex").buildArgs({
      sessionId: "11111111-1111-4111-8111-111111111111",
      model: null,
      images: [],
    });

    for (const args of [newArgs, resumedArgs]) {
      expect(args).toEqual(expect.arrayContaining([
        "-c",
        'service_tier="fast"',
        "-c",
        "features.fast_mode=true",
      ]));
    }
  });

  it("allows Mi's validated non-Git workspaces for new and resumed Codex sessions", () => {
    const newArgs = getEngine("codex").buildArgs({
      sessionId: null,
      model: null,
      images: [],
      readOnly: true,
      skipGitRepoCheck: true,
    });
    const resumedArgs = getEngine("codex").buildArgs({
      sessionId: "11111111-1111-4111-8111-111111111111",
      model: null,
      images: [],
      readOnly: true,
      skipGitRepoCheck: true,
    });

    expect(newArgs).toContain("--skip-git-repo-check");
    expect(newArgs.indexOf("--skip-git-repo-check")).toBeGreaterThan(newArgs.indexOf("exec"));
    expect(resumedArgs).toContain("--skip-git-repo-check");
    expect(resumedArgs.indexOf("--skip-git-repo-check")).toBeLessThan(
      resumedArgs.indexOf("11111111-1111-4111-8111-111111111111"),
    );
  });

  it("limits project-scoped Claude to inspection tools in plan mode", () => {
    const args = getEngine("claude").buildArgs({
      sessionId: "11111111-1111-4111-8111-111111111111",
      isNewSession: true,
      model: null,
      readOnly: true,
    });

    expect(args).toEqual(expect.arrayContaining([
      "--permission-mode",
      "plan",
      "--tools",
      "Read,Glob,Grep",
    ]));
    expect(args).not.toContain("--allowedTools");
  });

  it("preserves normal tool access for root development chat", () => {
    const codexArgs = getEngine("codex").buildArgs({
      sessionId: null,
      model: null,
      images: [],
      readOnly: false,
    });
    const claudeArgs = getEngine("claude").buildArgs({
      sessionId: "11111111-1111-4111-8111-111111111111",
      isNewSession: true,
      model: null,
      readOnly: false,
    });

    expect(codexArgs).toContain("workspace-write");
    expect(claudeArgs).not.toContain("--permission-mode");
    expect(claudeArgs).not.toContain("--tools");
  });
});
