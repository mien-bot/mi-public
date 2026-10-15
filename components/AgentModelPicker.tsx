"use client";

import { useEffect, useMemo, useState } from "react";
import type { AgentEngine } from "@/types/electron";
import {
  AGENT_PROVIDERS,
  AUTOMATIC_MODEL_VALUE,
  CUSTOM_MODEL_OPTION_VALUE,
  MODEL_AVAILABILITY_NOTE,
  getModelGuidance,
  getModelPickerSelection,
  validateCustomModelId,
} from "./agentModels";

interface AgentModelPickerProps {
  engine: AgentEngine;
  model: string;
  onModelChange(modelId: string): void;
  onValidityChange(valid: boolean): void;
  controlClassName: string;
  groupClassName: string;
  labelClassName: string;
  disabled?: boolean;
}

export function AgentModelPicker({
  engine,
  model,
  onModelChange,
  onValidityChange,
  controlClassName,
  groupClassName,
  labelClassName,
  disabled = false,
}: AgentModelPickerProps) {
  const provider = AGENT_PROVIDERS[engine];
  const selection = useMemo(() => getModelPickerSelection(engine, model), [engine, model]);
  const [customActive, setCustomActive] = useState(selection.kind === "custom");
  const [customDraft, setCustomDraft] = useState(
    selection.kind === "custom" ? selection.modelId : "",
  );

  const customValidation = validateCustomModelId(customDraft);
  const customIsApplied =
    customValidation.ok &&
    selection.kind === "custom" &&
    customValidation.modelId === selection.modelId;
  const valid = !customActive || customIsApplied;
  const customError = customActive
    ? !customValidation.ok
      ? customValidation.error
      : !customIsApplied
        ? "Apply this custom model ID before sending."
        : null
    : null;

  useEffect(() => {
    onValidityChange(valid);
  }, [onValidityChange, valid]);

  function applyCustomModel() {
    const validation = validateCustomModelId(customDraft);
    if (!validation.ok) return;
    setCustomDraft(validation.modelId);
    onModelChange(validation.modelId);
  }

  const guidance =
    customActive && !customIsApplied
      ? "Enter and apply a custom model ID."
      : getModelGuidance(engine, model);

  return (
    <div className={groupClassName}>
      <label htmlFor={`agent-model-${engine}`} className={labelClassName}>
        Model
      </label>
      <select
        id={`agent-model-${engine}`}
        value={customActive ? CUSTOM_MODEL_OPTION_VALUE : selection.optionValue}
        onChange={(event) => {
          const value = event.target.value;
          if (value === CUSTOM_MODEL_OPTION_VALUE) {
            setCustomActive(true);
            setCustomDraft(selection.kind === "custom" ? selection.modelId : "");
            return;
          }
          setCustomActive(false);
          setCustomDraft("");
          onModelChange(value);
        }}
        disabled={disabled}
        className={controlClassName}
      >
        <option value={AUTOMATIC_MODEL_VALUE}>Automatic</option>
        {provider.models.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.label}
          </option>
        ))}
        <option value={CUSTOM_MODEL_OPTION_VALUE}>Custom model ID…</option>
      </select>
      {customActive && (
        <div className="mt-2 flex gap-1.5">
          <input
            value={customDraft}
            onChange={(event) => setCustomDraft(event.target.value)}
            disabled={disabled}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyCustomModel();
              }
            }}
            aria-label={`Custom ${provider.agentLabel} model ID`}
            aria-invalid={customError !== null}
            placeholder="Provider model ID"
            className={controlClassName}
          />
          <button
            type="button"
            onClick={applyCustomModel}
            disabled={disabled || !customValidation.ok}
            className="rounded-md border border-border px-2 text-xs transition-colors hover:border-accent disabled:opacity-50"
          >
            Apply
          </button>
        </div>
      )}
      {customError && (
        <p role="alert" className="mt-1 text-[10px] leading-tight text-red-600 dark:text-red-400">
          {customError}
        </p>
      )}
      <p className="mt-1 text-[10px] leading-tight text-muted-foreground">{guidance}</p>
      <p className="mt-1 text-[10px] leading-tight text-muted-foreground">
        {MODEL_AVAILABILITY_NOTE}
      </p>
    </div>
  );
}
