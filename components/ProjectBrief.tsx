import Link from "next/link";

export function ProjectBrief({ slug, scope, attention, nextMilestone, decisions, knowledge }: {
  slug: string;
  scope: string;
  attention: Array<{ code: string; label: string; href?: string }>;
  nextMilestone: { name: string; plannedDate: string } | null;
  decisions: Array<{ id: string; title: string; status: string }>;
  knowledge: Array<{ id: string; title: string }>;
}) {
  const base = `/projects/${slug}`;
  return <section className="space-y-3 rounded-xl border border-border bg-card p-4" aria-label="Current project brief">
    <h2 className="font-medium">Current project brief</h2>
    <p className="text-sm">{scope || "Project scope has not been recorded."} <Link href={`${base}/details`} className="text-link underline">Project details</Link></p>
    <p className="text-xs text-muted-foreground">From saved project records. Follow each source to review the details; missing records do not mean work has not happened.</p>
    <div className="grid gap-4 md:grid-cols-3">
      <div>
        <h3 className="text-sm font-medium">Needs your attention</h3>
        <ul className="mt-2 space-y-2 text-sm">{attention.slice(0, 3).map(reason => <li key={reason.code}><Link className="text-link underline" href={reason.href || `${base}/schedule`}>{reason.label}</Link></li>)}</ul>
        {attention.length === 0 && <p className="mt-2 text-sm text-muted-foreground">No attention flags in the saved records.</p>}
        <Link className="mt-2 block text-sm text-link underline" href={`/review?workspace=${encodeURIComponent(`project/${slug}`)}`}>Review project inbox</Link>
      </div>
      <div>
        <h3 className="text-sm font-medium">Next step</h3>
        <Link className="mt-2 block text-sm text-link underline" href={`${base}/schedule`}>{nextMilestone ? `${nextMilestone.name} · ${nextMilestone.plannedDate}` : "No upcoming milestone recorded — open Plan"}</Link>
        <Link className="mt-2 block text-sm text-link underline" href={`${base}/meetings`}>Meetings and action items</Link>
        <Link href={`${base}/questions`} className="mt-2 block text-sm text-link underline">Open project questions</Link>
      </div>
      <div>
        <h3 className="text-sm font-medium">Decisions &amp; knowledge</h3>
        <ul className="mt-2 space-y-2 text-sm">
          {decisions.slice(0, 2).map(decision => <li key={decision.id}><Link href={`${base}/decisions`} className="text-link underline">{decision.title} · {decision.status}</Link></li>)}
          {knowledge.slice(0, 2).map(note => <li key={note.id}><Link href={`${base}/knowledge`} className="text-link underline">{note.title}</Link></li>)}
        </ul>
        {decisions.length === 0 && knowledge.length === 0 && <p className="mt-2 text-sm text-muted-foreground">No decisions or knowledge entries recorded yet.</p>}
        <Link href={`${base}/knowledge`} className="mt-2 block text-sm text-link underline">All project knowledge</Link>
      </div>
    </div>
  </section>;
}
