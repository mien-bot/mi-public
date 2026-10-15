import { describe, expect, it } from "vitest";
import { MAX_OPEN_TABS, ROOT_PROJECT_VALUE, closeTab, createTab, makeThreadKey, openTab } from "./chatTypes";

describe("chat thread keys", () => {
  it("changes when the provider, model, or project changes", () => {
    const base = makeThreadKey("codex", "gpt-5.6-sol", "north-office");

    expect(makeThreadKey("claude", "gpt-5.6-sol", "north-office")).not.toBe(base);
    expect(makeThreadKey("codex", "gpt-5.6-terra", "north-office")).not.toBe(base);
    expect(makeThreadKey("codex", "gpt-5.6-sol", "south-office")).not.toBe(base);
  });

  it("uses a stable Automatic and root-project key", () => {
    expect(makeThreadKey("codex", null, ROOT_PROJECT_VALUE)).toBe(
      "codex::default::__root__",
    );
  });

  it("omitting mode is identical to explicitly passing \"chat\" -- every pre-existing call site is unaffected", () => {
    expect(makeThreadKey("codex", "gpt-5.6-sol", "north-office")).toBe(
      makeThreadKey("codex", "gpt-5.6-sol", "north-office", "chat"),
    );
    expect(makeThreadKey("claude", null, ROOT_PROJECT_VALUE)).toBe(
      makeThreadKey("claude", null, ROOT_PROJECT_VALUE, "chat"),
    );
  });

  it("keys an interview thread apart from free-form chat for the same engine/model/project", () => {
    const chatKey = makeThreadKey("claude", "claude-sonnet-5", "north-office", "chat");
    const interviewKey = makeThreadKey("claude", "claude-sonnet-5", "north-office", "interview");
    expect(interviewKey).not.toBe(chatKey);
    expect(interviewKey.startsWith(chatKey)).toBe(true);
  });
});

describe("openTab", () => {
  it("adds a new tab and activates it", () => {
    const tab = createTab("claude", ROOT_PROJECT_VALUE);
    const result = openTab([tab], tab.id, { engine: "codex", projectSlug: "north-office" });

    expect(result.tabs).toHaveLength(2);
    expect(result.tabs[1]).toMatchObject({ engine: "codex", projectSlug: "north-office" });
    expect(result.activeTabId).toBe(result.tabs[1].id);
  });

  it("activates an already-open tab instead of duplicating it", () => {
    const tab = createTab("claude", "north-office");
    const other = createTab("claude", ROOT_PROJECT_VALUE);
    const result = openTab([tab, other], other.id, { engine: "claude", projectSlug: "north-office" });

    expect(result.tabs).toEqual([tab, other]);
    expect(result.activeTabId).toBe(tab.id);
  });

  it("refuses to open past MAX_OPEN_TABS", () => {
    const tabs = Array.from({ length: MAX_OPEN_TABS }, (_, i) => createTab("claude", `project-${i}`));
    const result = openTab(tabs, tabs[0].id, { engine: "claude", projectSlug: "one-too-many" });

    expect(result.tabs).toHaveLength(MAX_OPEN_TABS);
    expect(result.activeTabId).toBe(tabs[0].id);
  });
});

describe("closeTab", () => {
  it("removes an inactive tab without changing which tab is active", () => {
    const a = createTab("claude", "a");
    const b = createTab("claude", "b");
    const result = closeTab([a, b], a.id, b.id);

    expect(result.tabs).toEqual([a]);
    expect(result.activeTabId).toBe(a.id);
  });

  it("activates the nearest neighbor when closing the active tab", () => {
    const a = createTab("claude", "a");
    const b = createTab("claude", "b");
    const c = createTab("claude", "c");
    const result = closeTab([a, b, c], b.id, b.id);

    expect(result.tabs).toEqual([a, c]);
    expect(result.activeTabId).toBe(c.id);
  });

  it("falls back to a fresh root tab when closing the last open tab", () => {
    const only = createTab("codex", "north-office");
    const result = closeTab([only], only.id, only.id);

    expect(result.tabs).toHaveLength(1);
    expect(result.tabs[0].id).not.toBe(only.id);
    expect(result.tabs[0]).toMatchObject({ engine: "claude", projectSlug: ROOT_PROJECT_VALUE });
    expect(result.activeTabId).toBe(result.tabs[0].id);
  });
});
