import Link from "next/link";
import type { Milestone } from "@/lib/schema";
import { milestoneTrail } from "@/lib/projectSnapshot";
import { isScheduleEvent } from "@/lib/scheduleInsights";

export function ProjectJourney({ slug, milestones }: { slug: string; milestones: Milestone[] }) {
  const trail = milestoneTrail(milestones.filter((item) => !isScheduleEvent(item)));
  return <section aria-label="Project milestone trail" className="rounded-xl border border-border bg-card p-4">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="font-medium">The road ahead</h2>
      <Link href={`/projects/${slug}/schedule`} className="text-sm text-link underline">Open Plan</Link>
    </div>
    <p className="mt-1 text-xs text-muted-foreground">{trail.total ? `${trail.completed} of ${trail.total} saved milestones complete · ${trail.remaining} remaining` : "Your trail starts with a milestone. Add one in Plan."}</p>
    {trail.next.length > 0 && <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {trail.next.map((item, index) => <li key={item.id} className="relative min-w-0 border-l-2 border-accent/40 pl-4">
        <span aria-hidden="true" className="absolute -left-2 top-1 h-3.5 w-3.5 rounded-full border-2 border-accent bg-card" />
        <span className="text-xs text-muted-foreground">{index === 0 ? "Next on the plan" : `Then · ${index + 1}`}</span>
        <Link href={`/projects/${slug}/schedule`} className="mt-1 block break-words text-sm font-medium text-link underline-offset-2 hover:underline">{item.name}</Link>
        <time className="mt-1 block text-xs text-muted-foreground" dateTime={item.planned_date}>{item.planned_date}</time>
      </li>)}
    </ol>}
    {trail.total > 0 && trail.remaining === 0 && <p className="mt-3 text-sm">All saved milestones are complete. Ready to plan what comes next?</p>}
    {trail.remaining > 4 && <p className="mt-3 text-xs text-muted-foreground">+{trail.remaining - 4} more in Plan</p>}
    {trail.total > 0 && <p className="mt-3 text-xs text-muted-foreground">Planned date order, including overdue items. This is a milestone trail, not overall project completion.</p>}
  </section>;
}
