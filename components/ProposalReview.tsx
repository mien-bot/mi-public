"use client";

import { useState, type ReactNode } from "react";
import { MiMark } from "@/components/MiMark";
import { ActivityIndicator } from "@/components/UiState";

export interface ProposalDiffRow {
  label: string;
  /** Empty string renders as a plain "to" value with no "from →" prefix (e.g. a new record). */
  from: string;
  to: string;
  /** e.g. "Will update Mi" vs "Review only" -- shown as a small pill next to the row label. */
  badge?: { text: string; tone: "accent" | "muted" | "danger" };
}

export interface ProposalAction {
  key: string;
  label: string;
  /** Shown on the disclosure toggle once this action succeeds. Defaults to "Applied". */
  completedLabel?: string;
  primary?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  run: () => Promise<{ ok: boolean; message: string }>;
}

export type ApplyState = { status: "idle" | "applying" | "applied" | "review" | "error"; message: string };

/** What a batch run reports back into one card. See `components/ProposalBatch.tsx`. */
export interface ProposalOutcome extends ApplyState {
  completedLabel?: string;
}

/**
 * The one shared "propose -> review -> confirm" card used everywhere Mi drafts a change
 * (project copilot, lead copilot, lead sync, schedule adjust). Review is an inline
 * disclosure, not a full-screen modal -- every field is always shown as an explicit
 * `from -> to` row so a stale value is never ambiguous.
 */
export function ProposalCard({
  kindLabel,
  title,
  reason,
  summary,
  diffRows,
  actions,
  extraFields,
  defaultExpanded = false,
  expanded: controlledExpanded,
  onExpandedChange,
  outcome,
  selection,
}: {
  kindLabel: string;
  title: string;
  reason?: string;
  summary?: string;
  diffRows: ProposalDiffRow[];
  actions: ProposalAction[];
  /** Extra controls rendered between the diff rows and the action buttons, e.g. a project picker. */
  extraFields?: ReactNode;
  defaultExpanded?: boolean;
  /** Supplied by a list that runs a batch, so "show me all of these" can open them together. */
  expanded?: boolean;
  onExpandedChange?: (next: boolean) => void;
  /**
   * A result produced outside this card, by a batch confirmation. While it is set it wins
   * over the card's own state, so one card cannot show "idle" for a write a batch already
   * made through it.
   */
  outcome?: ProposalOutcome | null;
  /** Adds this card to a batch selection. Absent means the card is not selectable. */
  selection?: { selected: boolean; onToggle: () => void; disabled?: boolean };
}) {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const [internalState, setInternalState] = useState<ApplyState>({ status: "idle", message: "" });
  const [applyingKey, setApplyingKey] = useState<string | null>(null);
  const [internalCompletedLabel, setInternalCompletedLabel] = useState("Applied");
  const expanded = controlledExpanded ?? internalExpanded;
  const state: ApplyState = outcome ?? internalState;
  const completedLabel = outcome?.completedLabel ?? internalCompletedLabel;
  const locked = state.status === "applying" || state.status === "applied";

  function setExpanded(next: boolean) {
    if (onExpandedChange) onExpandedChange(next);
    else setInternalExpanded(next);
  }

  async function handle(action: ProposalAction) {
    setApplyingKey(action.key);
    setInternalState({ status: "applying", message: "" });
    try {
      const result = await action.run();
      setInternalState({ status: result.ok ? "applied" : "review", message: result.message });
      if (result.ok) {
        setInternalCompletedLabel(action.completedLabel ?? "Applied");
        setExpanded(false);
      }
    } catch (error) {
      setInternalState({
        status: "error",
        message: error instanceof Error ? error.message : "The confirmed change could not be applied.",
      });
    } finally {
      setApplyingKey(null);
    }
  }

  return (
    <section className="mt-2 overflow-hidden rounded-lg border border-accent/40 bg-background text-left">
      <div className="flex items-start justify-between gap-3 p-3">
        {selection && (
          <input
            type="checkbox"
            checked={selection.selected}
            disabled={selection.disabled || locked}
            onChange={selection.onToggle}
            aria-label={`Select ${title}`}
            className="mt-1 h-4 w-4 shrink-0"
          />
        )}
        {/* flex-1 keeps the title against the checkbox: with three children a bare
            `justify-between` row centres the middle one instead. */}
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {kindLabel} · Proposed only
          </div>
          <h3 className="mt-1 text-sm font-medium">{title}</h3>
          {summary && <p className="mt-1 text-xs text-muted-foreground">{summary}</p>}
          {reason && <p className="mt-2 text-xs">{reason}</p>}
        </div>
        <button
          type="button"
          disabled={locked}
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="shrink-0 rounded-md border border-border px-2 py-1 text-xs transition-colors hover:border-accent disabled:opacity-50"
        >
          {state.status === "applied" ? <ActivityIndicator state="success" label={completedLabel} /> : expanded ? "Hide" : "Review"}
        </button>
      </div>

      {expanded && state.status !== "applied" && (
        <div className="animate-fade-in-up border-t border-border bg-card/40 p-3">
          <p className="text-xs text-muted-foreground">
            Review every value below. Nothing is saved until you confirm.
          </p>
          {diffRows.length > 0 && (
            <dl className="mt-3 max-h-72 space-y-2.5 overflow-auto rounded-md border border-border p-3 text-sm">
              {diffRows.map((row) => (
                <div key={row.label} className="grid gap-1 sm:grid-cols-[9rem_1fr]">
                  <dt className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
                    <span>{row.label}</span>
                    {row.badge && (
                      <span
                        className={`rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${
                          row.badge.tone === "accent"
                            ? "border-accent/50 text-accent"
                            : row.badge.tone === "danger"
                              ? "border-status-danger-foreground/60 bg-status-danger font-semibold text-status-danger-foreground"
                              : "border-border text-muted-foreground"
                        }`}
                      >
                        {row.badge.text}
                      </span>
                    )}
                  </dt>
                  <dd className="break-words">
                    {row.from && row.from !== row.to && (
                      <span className="text-muted-foreground line-through decoration-muted-foreground/50">
                        {row.from}
                      </span>
                    )}
                    {row.from && row.from !== row.to && <span className="text-muted-foreground"> → </span>}
                    {row.to === "" ? (
                      // A blank "to" against a real "from" is a field being emptied. Saying so
                      // beats rendering nothing after the arrow, which reads as a render bug.
                      <span className={row.from ? "font-semibold text-status-danger-foreground" : "italic text-muted-foreground"}>
                        {row.from ? "cleared" : "blank"}
                      </span>
                    ) : (
                      <span className="font-medium text-foreground">{row.to}</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {extraFields}
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            {actions.map((action) => (
              <button
                key={action.key}
                type="button"
                disabled={locked || action.disabled}
                onClick={() => void handle(action)}
                title={action.disabled ? action.disabledReason : undefined}
                className={
                  action.primary
                    ? "rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-40"
                    : "rounded-md border border-border px-3 py-2 text-sm disabled:opacity-40"
                }
              >
                {applyingKey === action.key ? (
                  <span className="inline-flex items-center gap-1.5">
                    <MiMark gradient className="h-3.5 w-3.5 animate-mark-loading" />
                    Applying…
                  </span>
                ) : (
                  action.label
                )}
              </button>
            ))}
          </div>
        </div>
      )}
      {state.message && state.status !== "applying" && (
        <p
          className={`px-3 pb-3 text-xs ${
            state.status === "error" || state.status === "review" ? "text-status-danger-foreground" : "text-muted-foreground"
          }`}
        >
          {state.message}
        </p>
      )}
    </section>
  );
}
