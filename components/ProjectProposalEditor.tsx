"use client";

import { useState } from "react";
import {
  projectCopilotProposalSchema,
  type ProjectCopilotProposal,
} from "@/lib/projectCopilot";

export function validateProjectProposalEdit(
  original: ProjectCopilotProposal,
  raw: string,
): { proposal?: ProjectCopilotProposal; error?: string } {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return { error: "The adjusted proposal is not valid JSON." };
  }
  const parsed = projectCopilotProposalSchema.safeParse(decoded);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.map((segment) => typeof segment === "number" ? `[${segment}]` : segment).join(".")
      .replaceAll(".[", "[");
    return { error: `${path || "proposal"}: ${issue?.message ?? "Invalid proposal."}` };
  }
  if (parsed.data.id !== original.id || parsed.data.kind !== original.kind) {
    return { error: "Proposal id and kind are fixed. Adjust its title, reason, or data fields only." };
  }
  return { proposal: parsed.data };
}

export function ProjectProposalEditor({
  proposal,
  onChange,
}: {
  proposal: ProjectCopilotProposal;
  onChange: (proposal: ProjectCopilotProposal) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => JSON.stringify(proposal, null, 2));
  const [error, setError] = useState("");

  function validateAndClose() {
    const result = validateProjectProposalEdit(proposal, draft);
    if (!result.proposal) {
      setError(result.error ?? "The adjusted proposal is invalid.");
      return;
    }
    onChange(result.proposal);
    setDraft(JSON.stringify(result.proposal, null, 2));
    setError("");
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(JSON.stringify(proposal, null, 2));
          setError("");
          setOpen(true);
        }}
        className="mt-3 rounded-md border border-border px-2.5 py-1.5 text-xs hover:border-accent"
      >
        Adjust before confirming
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-md border border-border bg-background/70 p-3">
      <p className="text-xs font-medium">Adjust proposal</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Change values only. Mi validates the complete proposal; its id and kind stay fixed.
      </p>
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={14}
        spellCheck={false}
        className="mt-2 w-full rounded-md border border-border bg-card p-2 font-mono text-xs"
        aria-label={`Adjust ${proposal.title}`}
      />
      {error && <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-300">{error}</p>}
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setError("");
            setOpen(false);
          }}
          className="rounded-md border border-border px-2.5 py-1.5 text-xs"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={validateAndClose}
          className="rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background"
        >
          Validate changes
        </button>
      </div>
    </div>
  );
}
