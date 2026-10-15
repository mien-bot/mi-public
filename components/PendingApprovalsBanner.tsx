import Link from "next/link";
import type { ProjectPendingApprovals } from "@/lib/content/pendingApprovals";

/**
 * Top-of-project alert for AI output that is waiting on a person.
 *
 * Renders nothing when nothing is pending — this must stay silent in the normal
 * case or it becomes furniture people stop reading. It states what would happen
 * on confirmation rather than just a count, because "3 items" does not tell you
 * whether they touch project records or Notion.
 */
export function PendingApprovalsBanner({ approvals }: { approvals: ProjectPendingApprovals }) {
  if (approvals.total === 0) return null;

  return (
    <section
      aria-labelledby="pending-approvals-heading"
      className="rounded-lg border border-accent bg-accent/10 p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="pending-approvals-heading" className="font-medium">
          {approvals.total} change{approvals.total === 1 ? "" : "s"} waiting for your approval
        </h2>
        <span className="text-xs text-muted-foreground">Nothing here has been applied.</span>
      </div>
      <ul className="mt-2 space-y-1 text-sm">
        {approvals.groups.map((group) => (
          <li key={group.kind}>
            <Link href={group.href} className="text-accent underline-offset-2 hover:underline">
              {group.label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
