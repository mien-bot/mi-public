import { describe, expect, it } from "vitest";
import {
  AGENT_PROVIDERS,
  AUTOMATIC_MODEL_VALUE,
  CUSTOM_MODEL_OPTION_VALUE,
  createDefaultProviderModels,
  getModelPickerSelection,
  updateProviderModel,
  validateCustomModelId,
} from "./agentModels";

describe("agent model catalog", () => {
  it("contains the verified Codex choices in display order", () => {
    expect(AGENT_PROVIDERS.codex.models.map(({ id }) => id)).toEqual([
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
    ]);
  });

  it("contains the verified Claude choices in display order", () => {
    expect(AGENT_PROVIDERS.claude.models.map(({ id }) => id)).toEqual([
      "claude-fable-5",
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-haiku-4-5",
    ]);
  });

  it("does not leak one provider's catalog models into the other", () => {
    expect(AGENT_PROVIDERS.codex.models.every(({ id }) => !id.startsWith("claude-"))).toBe(true);
    expect(AGENT_PROVIDERS.claude.models.every(({ id }) => !id.startsWith("gpt-"))).toBe(true);
  });
});

describe("model selection", () => {
  it("treats a blank model as Automatic", () => {
    expect(getModelPickerSelection("codex", "  ")).toEqual({
      kind: "automatic",
      optionValue: AUTOMATIC_MODEL_VALUE,
      modelId: "",
    });
  });

  it("selects a provider catalog model normally", () => {
    expect(getModelPickerSelection("claude", "claude-sonnet-5")).toMatchObject({
      kind: "catalog",
      optionValue: "claude-sonnet-5",
      modelId: "claude-sonnet-5",
    });
  });

  it("retains an unknown or older model as Custom", () => {
    expect(getModelPickerSelection("claude", " claude-haiku-4-5-20251001 ")).toEqual({
      kind: "custom",
      optionValue: CUSTOM_MODEL_OPTION_VALUE,
      modelId: "claude-haiku-4-5-20251001",
    });
  });

  it("updates provider preferences independently", () => {
    const codexSelected = updateProviderModel(
      createDefaultProviderModels(),
      "codex",
      "gpt-5.6-sol",
    );
    const bothSelected = updateProviderModel(codexSelected, "claude", "claude-sonnet-5");

    expect(bothSelected).toEqual({
      codex: "gpt-5.6-sol",
      claude: "claude-sonnet-5",
    });
    expect(bothSelected.codex).toBe("gpt-5.6-sol");
    expect(bothSelected.claude).toBe("claude-sonnet-5");
  });

  it("restores each provider's saved model while switching agents", () => {
    const preferences = {
      codex: "gpt-5.6-sol",
      claude: "claude-sonnet-5",
    };

    expect(preferences.codex).toBe("gpt-5.6-sol");
    expect(preferences.claude).toBe("claude-sonnet-5");
    expect(preferences.codex).toBe("gpt-5.6-sol");
  });
});

describe("custom model validation", () => {
  it("trims and accepts conservative model IDs", () => {
    expect(validateCustomModelId("  vendor/model-v2.1  ")).toEqual({
      ok: true,
      modelId: "vendor/model-v2.1",
    });
  });

  it("rejects empty and unsafe model IDs with useful errors", () => {
    expect(validateCustomModelId("   ")).toEqual({
      ok: false,
      error: "Enter a custom model ID.",
    });
    expect(validateCustomModelId("model id; --danger")).toMatchObject({ ok: false });
    expect(validateCustomModelId("-leading-separator")).toMatchObject({ ok: false });
  });
});
