import { describe, expect, it } from "vitest";
import { getModelPickerSelection } from "./agentModels";
import { ROOT_PROJECT_VALUE } from "./chatTypes";
import {
  CHAT_PREFS_STORAGE_KEY,
  LEGACY_CHAT_PREFS_STORAGE_KEY,
  V3_CHAT_PREFS_STORAGE_KEY,
  loadChatWidgetPreferences,
} from "./chatPreferences";

function storageWith(values: Record<string, string>) {
  return { getItem: (key: string) => values[key] ?? null };
}

describe("chat model preferences", () => {
  it("migrates the legacy (v2) model into its selected provider, as a single opened tab", () => {
    const preferences = loadChatWidgetPreferences(
      storageWith({
        [LEGACY_CHAT_PREFS_STORAGE_KEY]: JSON.stringify({
          collapsed: false,
          engine: "codex",
          model: "gpt-5.6-sol",
          projectSlug: "north-office",
        }),
      }),
    );

    expect(preferences.collapsed).toBe(false);
    expect(preferences.modelsByEngine).toEqual({ codex: "gpt-5.6-sol", claude: "" });
    expect(preferences.tabs).toHaveLength(1);
    expect(preferences.tabs[0]).toMatchObject({ engine: "codex", projectSlug: "north-office" });
    expect(preferences.activeTabId).toBe(preferences.tabs[0].id);
  });

  it("migrates a blank legacy model to Automatic", () => {
    const preferences = loadChatWidgetPreferences(
      storageWith({
        [LEGACY_CHAT_PREFS_STORAGE_KEY]: JSON.stringify({ engine: "claude", model: "  " }),
      }),
    );

    expect(preferences.modelsByEngine.claude).toBe("");
    expect(getModelPickerSelection("claude", preferences.modelsByEngine.claude).kind).toBe(
      "automatic",
    );
  });

  it("retains an unknown legacy model as Custom", () => {
    const preferences = loadChatWidgetPreferences(
      storageWith({
        [LEGACY_CHAT_PREFS_STORAGE_KEY]: JSON.stringify({
          engine: "claude",
          model: " older-claude-model ",
        }),
      }),
    );

    expect(getModelPickerSelection("claude", preferences.modelsByEngine.claude)).toEqual({
      kind: "custom",
      optionValue: "__custom_model_id__",
      modelId: "older-claude-model",
    });
  });

  it("migrates v3's single (engine, projectSlug) pair into one opened tab", () => {
    const preferences = loadChatWidgetPreferences(
      storageWith({
        [V3_CHAT_PREFS_STORAGE_KEY]: JSON.stringify({
          collapsed: true,
          engine: "claude",
          modelsByEngine: { codex: "gpt-5.6-sol", claude: "claude-sonnet-5" },
          projectSlug: "north-office",
        }),
      }),
    );

    expect(preferences.modelsByEngine).toEqual({ codex: "gpt-5.6-sol", claude: "claude-sonnet-5" });
    expect(preferences.tabs).toHaveLength(1);
    expect(preferences.tabs[0]).toMatchObject({ engine: "claude", projectSlug: "north-office" });
    expect(preferences.activeTabId).toBe(preferences.tabs[0].id);
  });

  it("restores a saved list of open tabs and the active one", () => {
    const preferences = loadChatWidgetPreferences(
      storageWith({
        [CHAT_PREFS_STORAGE_KEY]: JSON.stringify({
          collapsed: true,
          modelsByEngine: { codex: "gpt-5.6-sol", claude: "claude-sonnet-5" },
          tabs: [
            { id: "tab-1", engine: "claude", projectSlug: ROOT_PROJECT_VALUE },
            { id: "tab-2", engine: "codex", projectSlug: "north-office" },
          ],
          activeTabId: "tab-2",
        }),
      }),
    );

    expect(preferences.modelsByEngine).toEqual({ codex: "gpt-5.6-sol", claude: "claude-sonnet-5" });
    expect(preferences.tabs).toEqual([
      { id: "tab-1", engine: "claude", projectSlug: ROOT_PROJECT_VALUE, threadKey: "claude::claude-sonnet-5::__root__" },
      { id: "tab-2", engine: "codex", projectSlug: "north-office", threadKey: "codex::gpt-5.6-sol::north-office" },
    ]);
    expect(preferences.activeTabId).toBe("tab-2");
  });

  it("falls back to the first tab when the saved active id no longer matches any open tab", () => {
    const preferences = loadChatWidgetPreferences(
      storageWith({
        [CHAT_PREFS_STORAGE_KEY]: JSON.stringify({
          modelsByEngine: { codex: "", claude: "" },
          tabs: [{ id: "tab-1", engine: "claude", projectSlug: ROOT_PROJECT_VALUE }],
          activeTabId: "stale-id",
        }),
      }),
    );

    expect(preferences.activeTabId).toBe("tab-1");
  });

  it("falls back to a single fresh root tab when the saved tabs array is missing or empty", () => {
    const preferences = loadChatWidgetPreferences(
      storageWith({
        [CHAT_PREFS_STORAGE_KEY]: JSON.stringify({
          modelsByEngine: { codex: "", claude: "" },
          tabs: [],
        }),
      }),
    );

    expect(preferences.tabs).toHaveLength(1);
    expect(preferences.tabs[0].projectSlug).toBe(ROOT_PROJECT_VALUE);
    expect(preferences.activeTabId).toBe(preferences.tabs[0].id);
  });

  it("prefers current (v4) preferences over v3 and legacy (v2) data", () => {
    const legacy = JSON.stringify({ engine: "codex", model: "legacy-model" });
    const v3 = JSON.stringify({ engine: "codex", modelsByEngine: { codex: "v3-model", claude: "" } });
    const current = JSON.stringify({
      modelsByEngine: { codex: "gpt-5.6-luna", claude: "claude-fable-5" },
      tabs: [{ id: "tab-1", engine: "claude", projectSlug: ROOT_PROJECT_VALUE }],
      activeTabId: "tab-1",
    });

    expect(
      loadChatWidgetPreferences(
        storageWith({
          [CHAT_PREFS_STORAGE_KEY]: current,
          [V3_CHAT_PREFS_STORAGE_KEY]: v3,
          [LEGACY_CHAT_PREFS_STORAGE_KEY]: legacy,
        }),
      ).modelsByEngine,
    ).toEqual({ codex: "gpt-5.6-luna", claude: "claude-fable-5" });

    expect(
      loadChatWidgetPreferences(
        storageWith({
          [V3_CHAT_PREFS_STORAGE_KEY]: v3,
          [LEGACY_CHAT_PREFS_STORAGE_KEY]: legacy,
        }),
      ).modelsByEngine.codex,
    ).toBe("v3-model");
  });
});
