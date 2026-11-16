"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { DeletePermitQaqcButton } from "@/components/DeletePermitQaqcButton";
import { PermitQaqcCompletionButton } from "@/components/PermitQaqcCompletionButton";
import { PermitQaqcForm } from "@/components/PermitQaqcForm";
import { StatusBadge } from "@/components/StatusBadge";
import {
  AdvancedListEmpty,
  AdvancedListField,
  AdvancedListSummary,
  AdvancedListToolbar,
  ListMetric,
  advancedListControlClass,
  formatListDate,
  formatListValueLabel,
} from "@/components/AdvancedListUI";
import type { PermitQaqcStatus } from "@/lib/schema";
import { AppIcon } from "@/components/AppIcon";
import { CountPips, MetricCounter } from "@/components/OverviewGraphics";

export interface PermitQaqcListEntry {
  slug: string;
  name: string;
  submittingFirm: string;
  status: PermitQaqcStatus;
  engagementNumber: string | null;
  roundCount: number;
  latestReceivedDate: string | null;
  completedAt: string | null;
  reopenStatus: PermitQaqcStatus | null;
}

const STATUS_OPTIONS: (PermitQaqcStatus | "all")[] = [
  "all", "received", "in-review", "response-sent", "resubmitted",
];

type PermitQaqcView = "active" | "completed";
type PermitQaqcActivityFilter = "all" | "with-rounds" | "without-rounds";
type PermitQaqcSort = "attention" | "latest" | "number" | "name" | "firm";

/**
 * The two states where a drawing set is sitting with us and a response is owed. Only these
 * carry the Cinematic attention pulse — a badge that pulses on every row would say nothing.
 * Kept in step with ATTENTION_RANK below, which sorts the same two to the top.
 */
const RESPONSE_OWED: ReadonlySet<PermitQaqcStatus> = new Set(["received", "resubmitted"]);

const ATTENTION_RANK: Record<PermitQaqcStatus, number> = {
  resubmitted: 0,
  received: 1,
  "in-review": 2,
  "response-sent": 3,
  closed: 4,
};

export function PermitQaqcBrowser({ engagements }: { engagements: PermitQaqcListEntry[] }) {
  const [view, setView] = useState<PermitQaqcView>("active");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<PermitQaqcStatus | "all">("all");
  const [activity, setActivity] = useState<PermitQaqcActivityFilter>("all");
  const [sort, setSort] = useState<PermitQaqcSort>("attention");
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return engagements
      .filter((entry) => {
        if ((entry.status === "closed") !== (view === "completed")) return false;
        if (view === "active" && status !== "all" && entry.status !== status) return false;
        if (activity === "with-rounds" && entry.roundCount === 0) return false;
        if (activity === "without-rounds" && entry.roundCount > 0) return false;
        return !q
          || entry.name.toLowerCase().includes(q)
          || entry.submittingFirm.toLowerCase().includes(q)
          || entry.engagementNumber?.toLowerCase().includes(q);
      })
      .sort((a, b) => {
        if (sort === "attention") {
          return ATTENTION_RANK[a.status] - ATTENTION_RANK[b.status]
            || (a.engagementNumber ?? "999999").localeCompare(b.engagementNumber ?? "999999")
            || a.name.localeCompare(b.name, "en");
        }
        if (sort === "number") {
          return (a.engagementNumber ?? "999999").localeCompare(b.engagementNumber ?? "999999")
            || a.name.localeCompare(b.name, "en");
        }
        if (sort === "latest") {
          return (b.latestReceivedDate ?? "").localeCompare(a.latestReceivedDate ?? "")
            || a.name.localeCompare(b.name, "en");
        }
        if (sort === "firm") {
          return a.submittingFirm.localeCompare(b.submittingFirm, "en")
            || a.name.localeCompare(b.name, "en");
        }
        return a.name.localeCompare(b.name, "en");
      });
  }, [engagements, view, query, status, activity, sort]);

  const completedCount = engagements.filter((entry) => entry.status === "closed").length;
  const activeCount = engagements.length - completedCount;
  const totalRounds = engagements.reduce((total, entry) => total + entry.roundCount, 0);
  const filtersActive = Boolean(
    query.trim() || (view === "active" && status !== "all") || activity !== "all" || sort !== "attention",
  );

  return (
    <section className="flex flex-col gap-4" aria-labelledby="permit-qaqc-list-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="permit-qaqc-list-heading" className="font-medium">Engagement list</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Triage active review work and keep response status visible.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating((value) => !value)}
          className="rounded-md bg-foreground px-4 py-2 text-sm text-background"
        >
          {creating ? "Close new engagement" : "New engagement"}
        </button>
      </div>
      {creating && <PermitQaqcForm mode="create" onCancel={() => setCreating(false)} />}

      <div className="grid gap-3 sm:grid-cols-3">
        <ListMetric label="Total engagements" value={engagements.length} />
        <ListMetric label="Active reviews" value={activeCount} />
        <ListMetric label="Review rounds" value={totalRounds} detail={`${completedCount} completed`} />

      </div>

      <div className="flex w-fit gap-1 rounded-lg border border-border bg-card p-1" role="group" aria-label="Engagement view">
        {([["active", "Active", activeCount], ["completed", "Completed", completedCount]] as const).map(([value, label, count]) => (
          <button
            key={value}
            type="button"
            aria-pressed={view === value}
            onClick={() => setView(value)}
            className={`rounded-md px-3 py-1.5 text-sm ${view === value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
          >
            {label} ({count})
          </button>
        ))}
      </div>

      <AdvancedListToolbar columnsClassName={view === "active" ? "md:grid-cols-2 xl:grid-cols-4" : "md:grid-cols-3"}>
        <AdvancedListField label="Search">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Number, project, or firm..."
            className={advancedListControlClass}
          />
        </AdvancedListField>
        {view === "active" && (
          <AdvancedListField label="Status">
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as PermitQaqcStatus | "all")}
              className={advancedListControlClass}
            >
              {STATUS_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value === "all" ? "All statuses" : formatListValueLabel(value)}
                </option>
              ))}
            </select>
          </AdvancedListField>
        )}
        <AdvancedListField label="Recorded activity">
          <select
            value={activity}
            onChange={(event) => setActivity(event.target.value as PermitQaqcActivityFilter)}
            className={advancedListControlClass}
          >
            <option value="all">All activity states</option>
            <option value="with-rounds">Review rounds recorded</option>
            <option value="without-rounds">No review rounds</option>
          </select>
        </AdvancedListField>
        <AdvancedListField label="Sort by">
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as PermitQaqcSort)}
            className={advancedListControlClass}
          >
            <option value="attention">Review attention</option>
            <option value="latest">Latest received activity</option>
            <option value="number">Engagement number</option>
            <option value="name">Project name</option>
            <option value="firm">Submitting firm</option>
          </select>
        </AdvancedListField>
      </AdvancedListToolbar>

      <AdvancedListSummary
        shown={filtered.length}
        total={view === "active" ? activeCount : completedCount}
        noun={view === "active" ? "active engagement" : "completed engagement"}
        filtersActive={filtersActive}
        onClear={() => {
          setQuery("");
          setStatus("all");
          setActivity("all");
          setSort("attention");
        }}
      />

      <div className="grid gap-3">
        {filtered.map((entry, index) => (
          <article
            key={entry.slug}
            /* Capped at ten steps: past that a long list would take longer to finish
               arriving than it takes to read the top of it. */
            className="stat-card card-hover animate-fade-in-up rounded-lg border border-border p-4 hover:border-accent"
            style={{ animationDelay: `${Math.min(index, 10) * 45}ms` }}
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <Link href={`/permit-qaqc/${entry.slug}`} className="group min-w-0 flex-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mode-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent"><AppIcon name="qaqc" className="h-4 w-4" /></span>
                  <span className="font-medium group-hover:underline">
                    {entry.name}
                  </span>
                  <StatusBadge
                    status={entry.status}
                    label={entry.status === "closed" ? "completed" : undefined}
                    className={RESPONSE_OWED.has(entry.status) ? "status-alert" : ""}
                  />
                  {entry.completedAt && (
                    <span className="text-xs text-muted-foreground">{formatListDate(entry.completedAt)}</span>
                  )}
                </div>
                <dl className="mt-3 grid gap-x-5 gap-y-2 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-xs text-muted-foreground">Engagement number</dt>
                    <dd className="mt-0.5 tabular-nums">{entry.engagementNumber || "Not assigned"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Submitting firm</dt>
                    <dd className="mt-0.5">{entry.submittingFirm}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Review rounds</dt>
                    <dd className="mt-0.5 flex items-center gap-2 tabular-nums">
                      <MetricCounter value={entry.roundCount} />
                      {entry.roundCount > 0 && (
                        <CountPips filled={entry.roundCount} total={entry.roundCount} label="review rounds" />
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Latest received</dt>
                    <dd className="mt-0.5 tabular-nums">{formatListDate(entry.latestReceivedDate)}</dd>
                  </div>
                </dl>
              </Link>
              <div className="flex shrink-0 gap-2">
                <PermitQaqcCompletionButton
                  slug={entry.slug}
                  name={entry.name}
                  status={entry.status}
                  reopenStatus={entry.reopenStatus}
                />
                <DeletePermitQaqcButton slug={entry.slug} name={entry.name} compact />
              </div>
            </div>
          </article>
        ))}
        {filtered.length === 0 && (
          <AdvancedListEmpty>
            {engagements.length === 0
              ? "No Permit QAQC engagements yet. Run `npm run suggest-permit-qaqc-links` to find real Dropbox folders to onboard, or use New engagement."
              : filtersActive
                ? "No engagements match your filters."
                : view === "active"
                  ? "No active engagements."
                  : "No completed engagements yet."}
          </AdvancedListEmpty>
        )}
      </div>
    </section>
  );
}
