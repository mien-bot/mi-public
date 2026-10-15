import { describe, expect, it } from "vitest";
import { ROOT_PROJECT_VALUE } from "./chatTypes";
import { resolveProjectChatLaunch } from "./projectChatLaunch";

const AVAILABLE = ["example-record-35", "example-project-59"] as const;

describe("project chat launch contract", () => {
  it("selects an exact valid launch target and derives its project cwd", () => {
    const launch = resolveProjectChatLaunch({
      requestedSlug: "example-record-35",
      preferredSlug: ROOT_PROJECT_VALUE,
      availableSlugs: AVAILABLE,
      engine: "codex",
      model: "gpt-5.6-sol",
    });

    expect(launch).toEqual({
      projectSlug: "example-record-35",
      cwd: "projects/example-record-35",
      threadKey: "codex::gpt-5.6-sol::example-record-35",
      error: null,
    });
  });

  it("restores the saved project only when no explicit launch target exists", () => {
    expect(
      resolveProjectChatLaunch({
        preferredSlug: "example-project-59",
        availableSlugs: AVAILABLE,
        engine: "claude",
        model: null,
      }).projectSlug,
    ).toBe("example-project-59");
  });

  it("makes an invalid explicit slug visible and remains explicitly at root", () => {
    const launch = resolveProjectChatLaunch({
      requestedSlug: "../outside",
      preferredSlug: "example-record-35",
      availableSlugs: AVAILABLE,
      engine: "claude",
      model: null,
    });

    expect(launch.projectSlug).toBe(ROOT_PROJECT_VALUE);
    expect(launch.cwd).toBe(".");
    expect(launch.threadKey).toBe("claude::default::__root__");
    expect(launch.error).toContain("requested project chat");
    expect(launch.error).toContain("Root chat is active");
  });

  it("keeps provider, model, and exact project in separate thread keys", () => {
    const resolve = (
      engine: "codex" | "claude",
      model: string | null,
      requestedSlug: string,
    ) =>
      resolveProjectChatLaunch({
        requestedSlug,
        availableSlugs: AVAILABLE,
        engine,
        model,
      }).threadKey;

    const base = resolve("codex", "gpt-5.6-sol", "example-record-35");
    expect(resolve("claude", "gpt-5.6-sol", "example-record-35")).not.toBe(base);
    expect(resolve("codex", "gpt-5.6-terra", "example-record-35")).not.toBe(base);
    expect(resolve("codex", "gpt-5.6-sol", "example-project-59")).not.toBe(base);
  });
});
