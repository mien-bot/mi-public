"use client";

import type { NotionSetupHealth, NotionSourceHealth } from "@/types/electron";

type Verdict = "ok" | "partial" | "fail";

/**
 * Reading works but the schema is wrong is a real, separate state: Mi can list pages and still
 * be unable to map them. It reads as "partial" rather than "working" so a missing property is
 * never mistaken for a healthy connection.
 */
function verdictOf(health: NotionSetupHealth): Verdict {
  const sources = [health.projects, health.schedule];
  const readable = sources.filter((source) => source.read === "available");
  if (readable.length === 0) return "fail";
  const degraded = readable.some((source) => source.schema.status === "incompatible");
  return readable.length === sources.length && !degraded ? "ok" : "partial";
}

const VERDICT: Record<Verdict, { panel: string; dot: string; title: string }> = {
  ok: {
    panel: "border-status-success-foreground/40 bg-status-success/30",
    dot: "bg-status-success-foreground",
    title: "Notion is connected and readable",
  },
  partial: {
    panel: "border-status-warning-foreground/40 bg-status-warning/30",
    dot: "bg-status-warning-foreground",
    title: "Notion is partly working",
  },
  fail: {
    panel: "border-status-danger-foreground/40 bg-status-danger/30",
    dot: "bg-status-danger-foreground",
    title: "Notion could not be read",
  },
};

const SCHEMA_LABEL: Record<NotionSourceHealth["schema"]["status"], string> = {
  compatible: "All expected properties present",
  incompatible: "Property mismatch",
  "not-reported": "Properties not reported",
  unavailable: "Not checked",
};

function SourceRow({ source }: { source: NotionSourceHealth }) {
  const readable = source.read === "available";
  const broken = source.schema.status === "incompatible";
  return (
    <div className="border-t border-border/50 py-2.5 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{source.label}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${
            readable
              ? "bg-status-success text-status-success-foreground"
              : "bg-status-danger text-status-danger-foreground"
          }`}
        >
          {readable ? "Readable" : "Unreachable"}
        </span>
      </div>
      <p className={`mt-1 text-xs ${broken ? "text-status-warning-foreground" : "text-muted-foreground"}`}>
        {SCHEMA_LABEL[source.schema.status]}
      </p>
      {source.error && <p className="mt-1 break-words text-xs">{source.error}</p>}
      {source.schema.missing.length > 0 && (
        <p className="mt-1 text-xs">
          Missing propert{source.schema.missing.length === 1 ? "y" : "ies"}:{" "}
          <span className="font-medium">{source.schema.missing.join(", ")}</span>
        </p>
      )}
      {source.schema.incompatible.map((entry) => (
        <p key={entry.name} className="mt-1 text-xs">
          <span className="font-medium">{entry.name}</span> is <code>{entry.actual}</code>; Mi
          expects <code>{entry.expected.join(" or ")}</code>.
        </p>
      ))}
    </div>
  );
}

export function NotionHealthPanel({ health }: { health: NotionSetupHealth }) {
  const verdict = verdictOf(health);
  const style = VERDICT[verdict];

  return (
    <div role="status" className={`rounded-md border p-4 ${style.panel}`}>
      <div className="flex items-start gap-2">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{style.title}</p>
          {verdict === "fail" && (
            <p className="mt-1 text-xs">
              Check that the integration token is current and that both databases are shared
              with the integration in Notion.
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 rounded-md border border-border/60 bg-card/50 p-3">
        <SourceRow source={health.projects} />
        <SourceRow source={health.schedule} />
      </div>

      {(health.localSnapshot || health.scheduleSnapshot) && (
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          {health.localSnapshot && (
            <div className="rounded-md border border-border/60 bg-card/50 p-2.5">
              <dt className="text-muted-foreground">Projects read from Notion</dt>
              <dd className="mt-0.5 text-base font-medium tabular-nums">
                {health.localSnapshot.projectCount}
              </dd>
            </div>
          )}
          {health.scheduleSnapshot && (
            <div className="rounded-md border border-border/60 bg-card/50 p-2.5">
              <dt className="text-muted-foreground">
                Schedule entries ({health.scheduleSnapshot.window.from.slice(0, 10)} to{" "}
                {health.scheduleSnapshot.window.to.slice(0, 10)})
              </dt>
              <dd className="mt-0.5 text-base font-medium tabular-nums">
                {health.scheduleSnapshot.entryCount}
              </dd>
            </div>
          )}
        </dl>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        This test only reads — it made {health.mutationCount} changes in Notion. Saving to Notion
        is never tested automatically; a real write happens only when you confirm one item at a
        time.
      </p>
    </div>
  );
}
