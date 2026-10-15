"use client";
import { reportMiActivity } from "@/lib/miniMi/activity";

import { useState, type ReactNode } from "react";
import { ProposalCardList, type ProposalListItem } from "@/components/ProposalBatch";
import { type ProposalAction } from "@/components/ProposalReview";
import { ProjectProposalEditor } from "@/components/ProjectProposalEditor";
import {
  proposalKindLabel,
  type ProjectCopilotProposal,
} from "@/lib/projectCopilot";
import { diffRows, proposalSummary, type CurrentProjectValues } from "@/components/proposalDiff";

export type { CurrentProjectValues };

/** A local project a root-chat (no single project in scope) schedule-item proposal can be confirmed into. */
export interface ProjectPickerOption {
  slug: string;
  name: string;
  notionLinked: boolean;
}

export function ProjectCopilotProposalList({
  projectSlug,
  notionLinked,
  proposals,
  projectOptions = [],
  currentValues = {},
  onProposalResolved,
  onProposalDismissed,
}: {
  /** null when no single project is in scope (root/holistic chat) -- schedule-item proposals then need projectOptions to pick one from. */
  projectSlug: string | null;
  notionLinked: boolean;
  proposals: ProjectCopilotProposal[];
  /** Only needed/used when projectSlug is null. */
  projectOptions?: ProjectPickerOption[];
  /** Stored values for the project in scope, used to render before → after diffs. */
  currentValues?: CurrentProjectValues;
  /** Called only after Mi successfully applies the confirmed proposal. */
  onProposalResolved?: (proposalId: string) => Promise<void>;
  /**
   * Closes a proposal without applying it. Only supplied by surfaces backed by a
   * persisted inbox — a chat proposal has nothing to dismiss, it just isn't confirmed.
   */
  onProposalDismissed?: (proposalId: string, reason: string) => Promise<void>;
}) {
  const [pickedProjectSlug, setPickedProjectSlug] = useState<Record<string, string>>({});
  const [editedProposals, setEditedProposals] = useState<Record<string, ProjectCopilotProposal>>({});
  const [dismissReason, setDismissReason] = useState<Record<string, string>>({});

  function targetSlugFor(proposalId: string): string | null {
    if (projectSlug) return projectSlug;
    const picked = pickedProjectSlug[proposalId];
    if (picked !== undefined) return picked || null;
    return projectOptions.length === 1 ? projectOptions[0].slug : null;
  }

  function targetNotionLinkedFor(targetSlug: string | null): boolean {
    if (projectSlug) return notionLinked;
    return projectOptions.find((option) => option.slug === targetSlug)?.notionLinked ?? false;
  }

  async function applyProposal(
    proposal: ProjectCopilotProposal,
    targetSlug: string,
    destination?: "mi" | "notion" | "dropbox",
  ): Promise<{ ok: boolean; message: string }> {
    const response = await fetch(`/api/projects/${encodeURIComponent(targetSlug)}/copilot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposal, confirmed: true, destination }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "The confirmed change could not be applied.");

    const syncStatus =
      body.result?.sync?.status ??
      body.result?.mirror?.status ??
      body.result?.results?.[0]?.status;
    const needsReview = syncStatus === "pending-review" || syncStatus === "failed" ||
      body.result?.results?.some((result: { status?: string }) => result.status === "failed" || result.status === "pending-review");
    let inboxWarning = "";
    if (!needsReview && onProposalResolved) {
      try {
        await onProposalResolved(proposal.id);
      } catch (resolutionError) {
        inboxWarning = ` The change was applied, but Mi could not close its inbox draft: ${
          resolutionError instanceof Error ? resolutionError.message : String(resolutionError)
        }`;
      }
    }
    const tally = body.result?.tally;
    reportMiActivity({ id: `save-${proposal.id}`, scope: `projects/${targetSlug}`, label: `Project · ${targetSlug}`.slice(0,100),
      href: `/projects/${targetSlug}`, state: needsReview || inboxWarning ? "attention" : "saved" });
    const tallyText = tally
      ? ` Company tally: ${Number(tally.companyHours).toFixed(2)} hours across ${tally.entryCount} confirmed entries.`
      : "";
    return {
      ok: !needsReview,
      message: needsReview
        ? (
            body.result?.sync?.error ||
            body.result?.mirror?.error ||
            body.result?.results?.[0]?.error ||
            "This entry needs review before retrying."
          )
        : `Confirmed and saved to ${body.result?.destination ?? "Mi"}.${tallyText}${inboxWarning}`,
    };
  }

  const items: ProposalListItem[] = proposals.map((proposal) => {
    const reviewedProposal = editedProposals[proposal.id] ?? proposal;
    const targetSlug = targetSlugFor(proposal.id);
    const targetNotionLinked = targetNotionLinkedFor(targetSlug);
    const noTarget = !targetSlug;
    const needsNotionLink = Boolean(targetSlug) && !targetNotionLinked
      && (reviewedProposal.kind === "schedule-item" || reviewedProposal.kind === "time-entry");

    const run = (destination?: "mi" | "notion" | "dropbox") => async () => {
      if (!targetSlug) return { ok: false, message: "Choose which project this belongs to first." };
      return applyProposal(reviewedProposal, targetSlug, destination);
    };

    let actions: ProposalAction[];
    if (reviewedProposal.kind === "memory-note") {
      actions = [
        { key: "mi", label: "Confirm Mi only", disabled: noTarget, run: run("mi") },
        { key: "dropbox", label: "Confirm Mi + Dropbox", primary: true, disabled: noTarget, run: run("dropbox") },
      ];
    } else if (reviewedProposal.kind === "schedule-item") {
      actions = [
        { key: "mi", label: "Confirm Mi only", disabled: noTarget, run: run("mi") },
        {
          key: "notion",
          label: "Confirm Mi + Notion",
          primary: true,
          disabled: noTarget || !targetNotionLinked,
          disabledReason: noTarget ? "Choose a project first." : "Link this project to Notion first.",
          run: run("notion"),
        },
      ];
    } else if (reviewedProposal.kind === "time-entry") {
      actions = [
        {
          key: "notion",
          label: "Confirm hours in Notion",
          primary: true,
          disabled: noTarget || !targetNotionLinked,
          disabledReason: noTarget ? "Choose a project first." : "Link this project to Notion first.",
          run: run("notion"),
        },
      ];
    } else {
      actions = [
        { key: "mi", label: "Confirm local save", primary: true, disabled: noTarget, run: run(undefined) },
      ];
    }

    if (onProposalDismissed) {
      actions = [
        {
          key: "dismiss",
          label: "Dismiss",
          completedLabel: "Dismissed",
          run: async () => {
            await onProposalDismissed(proposal.id, (dismissReason[proposal.id] ?? "").trim());
            return { ok: true, message: "Dismissed. Nothing was written to this project." };
          },
        },
        ...actions,
      ];
    }

    const extras: ReactNode[] = [];
    if (onProposalDismissed) {
      extras.push(
        <label key="dismiss-reason" className="mt-3 block text-sm">
          <span className="font-medium">Reason for dismissing</span>
          <input
            value={dismissReason[proposal.id] ?? ""}
            onChange={(event) =>
              setDismissReason((current) => ({ ...current, [proposal.id]: event.target.value }))
            }
            maxLength={500}
            placeholder="Optional — recorded with the dismissal"
            className="mt-1 block w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
          />
        </label>,
      );
    }
    extras.push(
      <ProjectProposalEditor
        key="editor"
        proposal={reviewedProposal}
        onChange={(next) => setEditedProposals((current) => ({ ...current, [proposal.id]: next }))}
      />,
    );
    if (!projectSlug) {
      extras.push(
        <label key="picker" className="mt-3 block text-sm">
          <span className="font-medium">Project</span>
          <select
            value={pickedProjectSlug[proposal.id] ?? (projectOptions.length === 1 ? projectOptions[0].slug : "")}
            onChange={(event) =>
              setPickedProjectSlug((current) => ({ ...current, [proposal.id]: event.target.value }))
            }
            className="mt-1 block w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
          >
            <option value="">Choose which project this belongs to…</option>
            {projectOptions.map((option) => (
              <option key={option.slug} value={option.slug}>{option.name}</option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-muted-foreground">
            This chat isn&apos;t scoped to one project, so the proposal needs an explicit target before it can be confirmed.
          </span>
        </label>,
      );
    }
    if (needsNotionLink) {
      extras.push(
        <p key="notion-hint" className="mt-2 text-xs text-muted-foreground">
          Link this project to Notion before confirming an external write.
        </p>,
      );
    }

    return {
      id: proposal.id,
      kindLabel: proposalKindLabel(reviewedProposal.kind),
      title: reviewedProposal.title,
      summary: proposalSummary(reviewedProposal),
      reason: reviewedProposal.reason,
      diffRows: diffRows(reviewedProposal, currentValues),
      actions,
      extraFields: extras.length > 0 ? <>{extras}</> : undefined,
    };
  });

  return <ProposalCardList items={items} />;
}
