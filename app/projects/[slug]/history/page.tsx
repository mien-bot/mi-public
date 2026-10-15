import Link from "next/link";
import { notFound } from "next/navigation";
import { getProject, getProjectSlugs, getProjectTimeline, type TimelineEntryType } from "@/lib/content";
import { StatusBadge } from "@/components/StatusBadge";

export function generateStaticParams() {
  return getProjectSlugs().map((slug) => ({ slug }));
}

const TYPE_LABELS: Record<TimelineEntryType, string> = {
  "progress-log": "Progress Log",
  review: "Review",
  markup: "Markup",
  permit: "Permit",
  milestone: "Milestone",
  drawing: "Drawing",
  "lead-conversion": "Lead",
};

export default async function HistoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const slugs = new Set(getProjectSlugs());
  if (!slugs.has(slug)) notFound();

  const project = getProject(slug);
  const timeline = getProjectTimeline(slug);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/projects/${slug}`} className="text-sm text-muted-foreground hover:underline">
          ← {project.meta.name}
        </Link>
        <h1 className="mt-1 font-display text-2xl font-light tracking-wide">History</h1>
      </div>

      <ul className="flex flex-col gap-2">
        {timeline.map((entry, i) => (
          <li
            key={`${entry.date}-${i}`}
            className="flex items-center justify-between rounded-md border border-border p-3 text-sm"
          >
            <div>
              <span className="text-muted-foreground">{entry.date}</span>{" "}
              <span className="font-medium">{TYPE_LABELS[entry.type]}</span> — {entry.title}
              {entry.detail && <span className="text-muted-foreground"> ({entry.detail})</span>}
            </div>
            {entry.status && <StatusBadge status={entry.status} />}
          </li>
        ))}
        {timeline.length === 0 && <p className="text-sm text-muted-foreground">No history recorded yet.</p>}
      </ul>
    </div>
  );
}
