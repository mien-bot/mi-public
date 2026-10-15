import type { AgentEngine } from "@/types/electron";

export interface AgentModelDefinition {
  id: string;
  label: string;
  guidance: string;
}

export interface AgentProviderDefinition {
  engine: AgentEngine;
  agentLabel: string;
  cliLabel: string;
  models: readonly AgentModelDefinition[];
}

export const AUTOMATIC_MODEL_VALUE = "";
export const CUSTOM_MODEL_OPTION_VALUE = "__custom_model_id__";
export const MODEL_AVAILABILITY_NOTE =
  "Uses your local CLI setup.";

export const AGENT_PROVIDER_ORDER: readonly AgentEngine[] = ["codex", "claude"];

export const AGENT_PROVIDERS: Record<AgentEngine, AgentProviderDefinition> = {
  codex: {
    engine: "codex",
    agentLabel: "Codex agent",
    cliLabel: "Codex CLI",
    models: [
      {
        id: "gpt-5.6-sol",
        label: "GPT-5.6 Sol",
        guidance: "Most capable for difficult, open-ended work.",
      },
      {
        id: "gpt-5.6-terra",
        label: "GPT-5.6 Terra",
        guidance: "Everyday balance of intelligence and speed.",
      },
      {
        id: "gpt-5.6-luna",
        label: "GPT-5.6 Luna",
        guidance: "Faster for clear, repeatable tasks.",
      },
    ],
  },
  claude: {
    engine: "claude",
    agentLabel: "Claude agent",
    cliLabel: "Claude CLI",
    models: [
      {
        id: "claude-fable-5",
        label: "Claude Fable 5",
        guidance: "Most capable for long-horizon complex work.",
      },
      {
        id: "claude-opus-5",
        label: "Claude Opus 5",
        guidance: "Deep analysis and coding.",
      },
      {
        id: "claude-sonnet-5",
        label: "Claude Sonnet 5",
        guidance: "Balanced intelligence and speed.",
      },
      {
        id: "claude-haiku-4-5",
        label: "Claude Haiku 4.5",
        guidance: "Fastest for simple or high-volume work.",
      },
    ],
  },
};

export interface ProviderModelPreferences {
  codex: string;
  claude: string;
}

export type ModelPickerSelection =
  | { kind: "automatic"; optionValue: typeof AUTOMATIC_MODEL_VALUE; modelId: "" }
  | { kind: "catalog"; optionValue: string; modelId: string; model: AgentModelDefinition }
  | { kind: "custom"; optionValue: typeof CUSTOM_MODEL_OPTION_VALUE; modelId: string };

export type CustomModelValidation =
  | { ok: true; modelId: string }
  | { ok: false; error: string };

export function createDefaultProviderModels(): ProviderModelPreferences {
  return { codex: AUTOMATIC_MODEL_VALUE, claude: AUTOMATIC_MODEL_VALUE };
}

export function normalizeStoredModelId(value: unknown): string {
  return typeof value === "string" ? value.trim() : AUTOMATIC_MODEL_VALUE;
}

export function updateProviderModel(
  preferences: ProviderModelPreferences,
  engine: AgentEngine,
  modelId: string,
): ProviderModelPreferences {
  return { ...preferences, [engine]: normalizeStoredModelId(modelId) };
}

export function getModelPickerSelection(
  engine: AgentEngine,
  modelId: string,
): ModelPickerSelection {
  const normalized = normalizeStoredModelId(modelId);
  if (!normalized) {
    return { kind: "automatic", optionValue: AUTOMATIC_MODEL_VALUE, modelId: "" };
  }

  const model = AGENT_PROVIDERS[engine].models.find((entry) => entry.id === normalized);
  if (model) {
    return { kind: "catalog", optionValue: model.id, modelId: model.id, model };
  }

  return { kind: "custom", optionValue: CUSTOM_MODEL_OPTION_VALUE, modelId: normalized };
}

export function getModelGuidance(engine: AgentEngine, modelId: string): string {
  const provider = AGENT_PROVIDERS[engine];
  const selection = getModelPickerSelection(engine, modelId);
  if (selection.kind === "automatic") {
    return `Uses the installed ${provider.cliLabel} default.`;
  }
  if (selection.kind === "catalog") return selection.model.guidance;
  return "Passes this custom model ID directly to the installed CLI.";
}

export function validateCustomModelId(value: string): CustomModelValidation {
  const modelId = value.trim();
  if (!modelId) {
    return { ok: false, error: "Enter a custom model ID." };
  }
  if (modelId.length > 128) {
    return { ok: false, error: "Custom model IDs must be 128 characters or fewer." };
  }
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._:/-]*[A-Za-z0-9])?$/.test(modelId)) {
    return {
      ok: false,
      error:
        "Use letters, numbers, periods, underscores, colons, slashes, or hyphens, and start and end with a letter or number.",
    };
  }
  return { ok: true, modelId };
}
