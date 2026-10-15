import { listAgentProposalInbox } from "./agentProposalInbox";
import { getProjectDecisions } from "./projectDecisions";
import { getProjectSiteReports } from "./projectSiteReports";
import { getProject, getProjectSlugs } from "./projects";

export type PendingApprovalKind = "agent-proposal" | "decision-record" | "site-report";

export interface PendingApprovalGroup {
  kind: PendingApprovalKind;
  count: number;
  /** Plain-language description of what is waiting and what confirming it would do. */
  label: string;
  /** Anchor or route within the project that reviews this group. */
  href: string;
}

export interface ProjectPendingApprovals {
  slug: string;
  name: string;
  total: number;
  groups: PendingApprovalGroup[];
}

/**
 * Everything on this project that an agent produced and a person has not yet
 * accepted or rejected.
 *
 * Mi's contract is that AI output is a draft until a human confirms each write.
 * That contract only works if the waiting drafts are visible: four confirmed
 * memory notes once looked like no-ops because nothing rendered them, and an
 * 18-card inbox sat unnoticed because the only way to know was to scroll to the
 * right section of the right project.
 *
 * Deliberately excludes anything a person authored themselves -- a hand-written
 * draft site report is ordinary unfinished work, not an AI write awaiting review.
 */
export function getProjectPendingApprovals(slug: string): ProjectPendingApprovals {
  const groups: PendingApprovalGroup[] = [];

  const proposalCount = listAgentProposalInbox(slug)
    .reduce((sum, record) => sum + record.pendingProposals.length, 0);
  if (proposalCount > 0) {
    groups.push({
      kind: "agent-proposal",
      count: proposalCount,
      label: `${proposalCount} agent proposal${proposalCount === 1 ? "" : "s"} waiting to be applied or dismissed`,
      href: `/projects/${slug}#project-agent-proposal-inbox`,
    });
  }

  const proposedDecisions = getProjectDecisions(slug)
    .filter(({ decision }) => decision.status === "proposed").length;
  if (proposedDecisions > 0) {
    groups.push({
      kind: "decision-record",
      count: proposedDecisions,
      label: `${proposedDecisions} proposed decision${proposedDecisions === 1 ? "" : "s"} nobody has confirmed`,
      href: `/projects/${slug}/decisions`,
    });
  }

  // Only AI-assisted drafts: a manual draft is someone's own unfinished writing.
  const aiDraftReports = getProjectSiteReports(slug)
    .filter(({ report }) => report.status === "draft" && report.origin === "ai-assisted").length;
  if (aiDraftReports > 0) {
    groups.push({
      kind: "site-report",
      count: aiDraftReports,
      label: `${aiDraftReports} AI-drafted site report${aiDraftReports === 1 ? "" : "s"} needing professional review`,
      href: `/projects/${slug}/site-reports`,
    });
  }

  let name = slug;
  try {
    name = getProject(slug).meta.name;
  } catch {
    // A project whose registry entry is unreadable still reports its counts by slug.
  }

  return { slug, name, total: groups.reduce((sum, group) => sum + group.count, 0), groups };
}

/**
 * Same, across every project, keeping only those with something waiting. Used by
 * the global badge so a pending card on a project you are not looking at is still
 * visible. A project whose content root is briefly unreachable (offline Dropbox)
 * is skipped rather than failing the whole list.
 */
export function listPendingApprovals(): ProjectPendingApprovals[] {
  return getProjectSlugs()
    .map((slug) => {
      try {
        return getProjectPendingApprovals(slug);
      } catch {
        return null;
      }
    })
    .filter((entry): entry is ProjectPendingApprovals => entry !== null && entry.total > 0)
    .sort((left, right) => right.total - left.total || left.slug.localeCompare(right.slug));
}
