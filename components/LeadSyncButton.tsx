"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ProposalCard, type ProposalAction, type ProposalDiffRow } from "@/components/ProposalReview";
import { ActivityIndicator } from "@/components/UiState";
import { readJsonResponse } from "@/lib/readJsonResponse";
import type { LeadSyncPlan } from "@/src/services/leadSync";

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Blank";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function label(field: string): string {
  return field.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function diffRows(plan: LeadSyncPlan): ProposalDiffRow[] {
  const rows: ProposalDiffRow[] = [];

  if (!plan.dropbox.linked) {
    rows.push({ label: "Dropbox inventory", from: "", to: "No confirmed Dropbox folder is linked." });
  } else if (plan.dropbox.error) {
    rows.push({ label: "Dropbox inventory", from: "", to: plan.dropbox.error });
  } else {
    rows.push({
      label: "Dropbox inventory",
      from: "",
      to: `${plan.dropbox.itemCount} item${plan.dropbox.itemCount === 1 ? "" : "s"}`
        + ` (${plan.dropbox.added.length} added · ${plan.dropbox.changed.length} changed · ${plan.dropbox.removed.length} removed)`
        + (plan.dropbox.truncated ? " — bounded inventory; more items may exist" : ""),
    });
  }

  if (!plan.notion.linked) {
    rows.push({ label: "Notion lead fields", from: "", to: "No confirmed Notion page is linked." });
  } else if (plan.notion.error) {
    rows.push({ label: "Notion lead fields", from: "", to: plan.notion.error });
  } else if (plan.notion.changes.length === 0) {
    rows.push({ label: "Notion lead fields", from: "", to: "Already up to date with Notion." });
  } else {
    for (const change of plan.notion.changes) {
      rows.push({
        label: label(change.field),
        from: displayValue(change.from),
        to: displayValue(change.to),
        badge: { text: change.allowed ? "Will update Mi" : "Review only", tone: change.allowed ? "accent" : "muted" },
      });
    }
  }

  return rows;
}

export function LeadSyncButton({ slug, leadName }: { slug: string; leadName: string }) {
  const router = useRouter();
  const [plan, setPlan] = useState<LeadSyncPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ state: "success" | "error"; label: string } | null>(null);

  async function request(confirmed: boolean): Promise<LeadSyncPlan> {
    const response = await fetch(`/api/leads/${encodeURIComponent(slug)}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmed }),
    });
    const body = await readJsonResponse<{ plan: LeadSyncPlan }>(response, "Lead synchronization failed.");
    return body.plan as LeadSyncPlan;
  }

  async function preview(): Promise<void> {
    setBusy(true);
    setFeedback(null);
    try {
      setPlan(await request(false));
    } catch (cause) {
      setFeedback({ state: "error", label: cause instanceof Error ? cause.message : "Could not preview the lead sync." });
    } finally {
      setBusy(false);
    }
  }

  async function apply(): Promise<{ ok: boolean; message: string }> {
    const result = await request(true);
    const appliedNotion = result.notion.changes.filter((change) => change.allowed).length;
    const partialFailure = result.dropbox.error || result.notion.error;
    const summary = partialFailure
      ? `Mi applied available updates. ${result.dropbox.error ? `Dropbox: ${result.dropbox.error} ` : ""}${result.notion.error ? `Notion: ${result.notion.error}` : ""}`.trim()
      : `Refreshed ${result.dropbox.itemCount} Dropbox item${result.dropbox.itemCount === 1 ? "" : "s"} and ${appliedNotion} Notion field${appliedNotion === 1 ? "" : "s"}.`;
    setPlan(null);
    setFeedback({ state: partialFailure ? "error" : "success", label: summary });
    router.refresh();
    return {
      ok: true,
      message: summary,
    };
  }

  const hasInternalChanges = Boolean(
    plan?.dropbox.inventoryChanged || plan?.notion.changes.some((change) => change.allowed),
  );

  const actions: ProposalAction[] | null = plan ? [
    { key: "cancel", label: "Cancel", run: async () => { setPlan(null); return { ok: true, message: "" }; } },
    { key: "confirm", label: hasInternalChanges ? "Confirm sync to Mi" : "Confirm refresh", primary: true, run: apply },
  ] : null;

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void preview()}
        disabled={busy || Boolean(plan)}
        className="rounded-md border border-border bg-card px-3 py-2 text-sm font-medium hover:border-accent disabled:opacity-50"
      >
        {busy ? <ActivityIndicator label="Checking linked sources…" /> : "Sync Dropbox + Notion"}
      </button>
      {feedback && <ActivityIndicator state={feedback.state} label={feedback.label} className="max-w-96 text-right text-[11px]" />}

      {plan && actions && (
        <div className="w-full max-w-md text-left">
          <ProposalCard
            kindLabel="Dropbox + Notion → Mi preview"
            title={`Sync ${leadName}`}
            reason="Mi reads only the already-confirmed Dropbox folder and Notion page. It never changes either service. Confirming updates Mi's reviewed fields and a filename-only Dropbox inventory."
            diffRows={diffRows(plan)}
            actions={actions}
            defaultExpanded
          />
        </div>
      )}
    </div>
  );
}
