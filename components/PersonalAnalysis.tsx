import Link from "next/link";
import type { PersonalAnalytics as PersonalAnalyticsData } from "@/lib/personal/analytics";
import { PersonalKnowledgeGraph } from "./PersonalKnowledgeGraph";
import { MetricCounter } from "@/components/OverviewGraphics";

function BarGroup({ title, values }: { title: string; values: Array<[string, number]> }) {
  const max = Math.max(1, ...values.map(([, value]) => value));
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="font-medium">{title}</h2>
      <ul className="mt-5 space-y-4">
        {values.map(([label, value], index) => (
          <li key={label}>
            <div className="flex justify-between text-sm"><span>{label}</span><span className="tabular-nums"><MetricCounter value={value} /></span></div>
            <div className="meter-sheen mt-1.5 h-2 overflow-hidden rounded-full bg-muted"><div className="segment-bar-fill h-full rounded-full bg-accent" style={{ width: `${Math.round((value / max) * 100)}%`, animationDelay: `${index * 70}ms` }} /></div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PersonalAnalysis({ analytics }: { analytics: PersonalAnalyticsData }) {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link href="/personal" className="text-sm text-muted-foreground hover:underline">← Personal</Link>
        <h1 className="mt-2 font-display text-3xl font-light tracking-wide">Personal analysis</h1>
        <p className="mt-2 text-sm text-muted-foreground">Private, local-only patterns calculated from your Mi records and chat metadata.</p>
      </header>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ["Records", analytics.totalRecords],
          ["Scheduled plans", analytics.scheduledPlans],
          ["Shared plans", analytics.sharedPlans],
          ["Chats", analytics.conversations],
          ["Chat messages", analytics.chatMessages],
        ].map(([label, value], index) => (
          <div
            key={label}
            className="stat-card card-hover holo-sheen animate-fade-in-up overflow-hidden rounded-lg border border-border bg-card p-4"
            style={{ animationDelay: `${index * 60}ms` }}
          >
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-light tabular-nums"><MetricCounter value={Number(value)} /></p>
          </div>
        ))}
      </section>
      <PersonalKnowledgeGraph nodes={analytics.graph.nodes} links={analytics.graph.links} />
      <div className="grid gap-6 lg:grid-cols-2">
        <BarGroup title="Record types" values={Object.entries(analytics.kindDistribution).map(([key, value]) => [key, value])} />
        <BarGroup title="Record status" values={Object.entries(analytics.statusDistribution).map(([key, value]) => [key, value])} />
        <BarGroup title="Sharing boundary" values={Object.entries(analytics.shareDistribution).map(([key, value]) => [key, value])} />
        <BarGroup title="Six-month activity" values={analytics.monthlyActivity.map(({ month, count }) => [month, count])} />
      </div>
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-medium">Most-used tags</h2>
        {analytics.topTags.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {analytics.topTags.map(({ tag, count }) => <span key={tag} className="rounded-full border border-border px-3 py-1 text-sm">{tag} · {count}</span>)}
          </div>
        ) : <p className="mt-4 text-sm text-muted-foreground">No tags recorded yet.</p>}
      </section>
    </div>
  );
}
