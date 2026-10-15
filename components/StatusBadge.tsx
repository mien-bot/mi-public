/**
 * Every status keyword in the app maps to one of four semantic buckets
 * (success/warning/danger/neutral) defined in app/globals.css, rather than
 * hardcoding raw Tailwind palette classes per status. Keeps every badge —
 * schedule, budget, checklist, permits, markups — in the same documented
 * blueprint-blue system (see docs/design/blue-palette.md): success/danger
 * stay true green/red for genuine pass/fail state, warning is an
 * accessible blue-violet, never amber/orange.
 */
type StatusBucket = "success" | "warning" | "danger" | "neutral";

const BUCKET_CLASSES: Record<StatusBucket, string> = {
  success: "bg-status-success text-status-success-foreground",
  warning: "bg-status-warning text-status-warning-foreground",
  danger: "bg-status-danger text-status-danger-foreground",
  neutral: "bg-status-neutral text-status-neutral-foreground",
};

const STATUS_BUCKETS: Record<string, StatusBucket> = {
  // generic
  pending: "neutral",
  "in-progress": "warning",
  complete: "success",
  "n/a": "neutral",
  flagged: "danger",
  // review / markup
  open: "danger",
  resolved: "success",
  addressed: "success",
  issued: "success",
  superseded: "neutral",
  // project / permits
  "not-started": "neutral",
  abandoned: "neutral",
  submitted: "warning",
  "under-review": "warning",
  approved: "success",
  rejected: "danger",
  // schedule
  upcoming: "neutral",
  "on-track": "success",
  "at-risk": "warning",
  overdue: "danger",
  // budget
  warning: "warning",
  over: "danger",
  // clients
  active: "success",
  prospect: "warning",
  past: "neutral",
  // leads
  new: "neutral",
  qualified: "warning",
  "proposal-sent": "warning",
  won: "success",
  lost: "danger",
  "on-hold": "neutral",
  // permit QAQC engagements
  received: "neutral",
  "in-review": "warning",
  "response-sent": "success",
  resubmitted: "warning",
  closed: "success",
};

export function StatusBadge({
  status,
  label,
  title,
  className = "",
}: {
  status: string;
  label?: string;
  title?: string;
  /**
   * Extra classes for the badge itself. The only intended use is `status-alert`, the
   * Cinematic attention pulse — and only where the status genuinely means work is owed,
   * never as decoration on every badge, which would make the signal worthless.
   */
  className?: string;
}) {
  const bucket = STATUS_BUCKETS[status] ?? "neutral";
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${BUCKET_CLASSES[bucket]} ${className}`}
      title={title}
    >
      {label ?? status}
    </span>
  );
}
