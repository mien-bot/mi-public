import Link from "next/link";
import type { ProjectPendingApprovals } from "@/lib/content/pendingApprovals";

/**
 * Portfolio-wide roll-up of AI output awaiting a person, so a proposal sitting on
 * a project nobody has opened is still visible. Silent when nothing is pending.
 */
export function PendingApprovalsSummary({ approvals }: { approvals: ProjectPendingApprovals[] }) {
  if (approvals.length === 0) return null;
  const total = approvals.reduce((sum, entry) => sum + entry.total, 0);

  return (
    <section
      aria-labelledby="portfolio-approvals-heading"
      className="rounded-lg border border-accent bg-accent/10 p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="portfolio-approvals-heading" className="font-medium">
          {total} change{total === 1 ? "" : "s"} waiting for your approval
          {approvals.length > 1 ? ` across ${approvals.length} projects` : ""}
        </h2>
        <span className="text-xs text-muted-foreground">Nothing has been applied.</span>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {approvals.map((entry) => (
          <li key={entry.slug}>
            <Link
              href={`/projects/${entry.slug}#project-agent-proposal-inbox`}
              className="text-accent underline-offset-2 hover:underline"
            >
              {entry.name}
            </Link>
            <span className="text-muted-foreground"> · {entry.total}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
