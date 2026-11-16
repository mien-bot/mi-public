import { notFound } from "next/navigation";
import { getDrawingIndex, getDrawingPhaseDurations, getProjectSlugs, PHASE_LABELS, PHASE_ORDER } from "@/lib/content";
import { StatusBadge } from "@/components/StatusBadge";

export function generateStaticParams() {
  return getProjectSlugs().map((slug) => ({ slug }));
}

export default async function DrawingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const slugs = new Set(getProjectSlugs());
  if (!slugs.has(slug)) notFound();

  const entries = getDrawingIndex(slug);
  const phaseDurations = getDrawingPhaseDurations(slug);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="mt-1 font-display text-2xl font-light tracking-wide">Drawings</h1>
      </div>

      {phaseDurations.some((d) => d.durationDays !== null) && (
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          {phaseDurations
            .filter((d) => d.durationDays !== null)
            .map((d) => (
              <span key={d.phase}>
                {d.phase.toUpperCase()}: {d.durationDays} day{d.durationDays === 1 ? "" : "s"}
              </span>
            ))}
        </div>
      )}

      {PHASE_ORDER.map((phase) => {
        const phaseEntries = entries.filter((e) => e.phase === phase);
        return (
          <section key={phase}>
            <h2 className="font-medium uppercase tracking-wide text-muted-foreground">
              {phase.toUpperCase()} — {PHASE_LABELS[phase]}
            </h2>
            <ul className="mt-2 flex flex-col gap-2">
              {phaseEntries.map((e) => (
                <li
                  key={`${e.sheet}-${e.revision}`}
                  className="flex items-center justify-between rounded-md border border-border p-3 text-sm"
                >
                  <div>
                    <a
                      href={`/api/project-file/${slug}/drawings/${phase}/${encodeURIComponent(e.file)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium hover:underline"
                    >
                      {e.sheet} rev.{e.revision}
                    </a>
                    <span className="text-muted-foreground"> — {e.date}</span>
                    {e.notes && <div className="text-muted-foreground">{e.notes}</div>}
                  </div>
                  <StatusBadge status={e.status} />
                </li>
              ))}
              {phaseEntries.length === 0 && (
                <li className="text-sm text-muted-foreground">
                  No {phase.toUpperCase()} sheets recorded yet. Mi lists a sheet here once it is added
                  to this project&apos;s drawing index.
                </li>
              )}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
