import Link from "next/link";
import type { ReadinessItem } from "@/lib/workflows/operationsReadiness";

const STATE_LABEL = {
  ready: "Ready",
  attention: "Review",
  missing: "Missing",
} as const;

export function WorkflowReadiness({
  title,
  description,
  baseHref,
  items,
}: {
  title: string;
  description: string;
  baseHref: string;
  items: ReadinessItem[];
}) {
  const readyCount = items.filter((item) => item.state === "ready").length;
  const completion = items.length > 0 ? Math.round((readyCount / items.length) * 100) : 0;

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card/50">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border p-4">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-accent">Workflow signal</p>
          <h2 className="mt-1 font-medium">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="min-w-40 text-right">
          <p className="font-mono text-xs text-muted-foreground">{readyCount}/{items.length} ready</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`${title}: ${completion}% ready`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={completion}>
            <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${completion}%` }} />
          </div>
        </div>
      </div>
      <ul className="mt-4 grid gap-3 px-4 md:grid-cols-2">
        {items.map((item) => {
          const content = (
            <>
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">{item.label}</span>
                <span className={`status-chip ${item.state === "ready" ? "status-chip-success" : item.state === "attention" ? "status-chip-attention" : "status-chip-missing"}`}>
                  {STATE_LABEL[item.state]}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
            </>
          );
          return (
            <li key={item.id}>
              {item.href ? (
                <Link
                  href={`${baseHref}/${item.href}`}
                  className="card-hover block h-full rounded-lg border border-border bg-background/65 p-3 transition-colors hover:border-accent"
                >
                  {content}
                </Link>
              ) : (
                <div className="h-full rounded-lg border border-border bg-background/65 p-3">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="h-4" aria-hidden="true" />
    </section>
  );
}
