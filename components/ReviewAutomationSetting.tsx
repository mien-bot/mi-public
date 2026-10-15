"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { REVIEW_AUTOMATION_CHOICES, type ReviewAutomationMode } from "@/lib/reviewAutomation";
import type { WorkspaceKind } from "@/lib/content/workspaceOutbox";

/**
 * Per-workspace automation.
 *
 * Kept behind a disclosure and phrased as what it will and will not do. The list of kinds
 * no setting can release is shown next to the choices rather than in documentation,
 * because the only moment anyone reads it is while deciding to loosen the default.
 */
export function ReviewAutomationSetting({ kind, slug, automation }: {
  kind: WorkspaceKind;
  slug: string;
  automation: ReviewAutomationMode;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function save(mode: ReviewAutomationMode) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/review-inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, slug, action: "set-automation", automation: mode }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The setting could not be saved.");
      setMessage("Saved.");
      router.refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "The setting could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="progressive-disclosure mt-3 rounded-md border border-border p-3 text-sm">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
        Capture and confirmation setting
      </summary>
      <fieldset disabled={busy} className="mt-3 flex flex-col gap-2">
        <legend className="sr-only">How this workspace handles incoming entries</legend>
        {REVIEW_AUTOMATION_CHOICES.map((choice) => (
          <label key={choice.mode} className="flex items-start gap-2">
            <input
              type="radio"
              name={`automation-${kind}-${slug}`}
              value={choice.mode}
              checked={automation === choice.mode}
              onChange={() => save(choice.mode)}
              className="mt-1"
            />
            <span>
              <span className="font-medium">{choice.label}</span>
              <span className="block text-xs text-muted-foreground">{choice.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="mt-2 text-xs text-muted-foreground">
        Meeting, decision, risk, and record-change entries — and anything touching fee, contract,
        schedule, or status — always wait for your confirmation, whichever option is selected. So does
        any entry the writing agent marked <code>needs_confirmation: true</code>.
      </p>
      {message && <p className="mt-2 text-xs">{message}</p>}
    </details>
  );
}
