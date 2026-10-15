"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { DeleteLeadButton } from "@/components/DeleteLeadButton";
import { LeadForm } from "@/components/LeadForm";
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
import type { LeadStatus } from "@/lib/schema";
import { AppIcon } from "@/components/AppIcon";

export interface LeadListEntry {
  slug: string;
  name: string;
  source: string;
  status: LeadStatus;
  estimatedValue: number | null;
  dateReceived: string;
}

/**
 * Delete sat exposed on every row, one stray click away from a confirmation dialog while
 * scanning the list. Keeping each card read-only until Edit is pressed makes destroying a lead
 * a deliberate two-step action, without moving it somewhere it can't be found.
 */
function LeadCardActions({ slug, name }: { slug: string; name: string }) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:border-accent"
      >
        Edit
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DeleteLeadButton slug={slug} name={name} compact />
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:border-accent"
      >
        Done
      </button>
    </div>
  );
}

const STATUS_OPTIONS: (LeadStatus | "all")[] = [
  "all", "new", "qualified", "proposal-sent", "won", "lost", "on-hold",
];

type LeadEvidenceFilter = "all" | "with-value" | "missing-value";
type LeadDateFilter = "all" | "last-30" | "last-90" | "older";
type LeadSort = "attention" | "recent" | "name" | "value";

const ATTENTION_RANK: Record<LeadStatus, number> = {
  new: 0,
  qualified: 1,
  "proposal-sent": 2,
  "on-hold": 3,
  won: 4,
  lost: 5,
};

function localDateOffset(days: number): string {
  const value = new Date();
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() + days);
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}

export function LeadsBrowser({
  leads,
  projectSlugs,
}: {
  leads: LeadListEntry[];
  projectSlugs: string[];
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<LeadStatus | "all">("all");
  const [evidence, setEvidence] = useState<LeadEvidenceFilter>("all");
  const [dateFilter, setDateFilter] = useState<LeadDateFilter>("all");
  const [sort, setSort] = useState<LeadSort>("attention");
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const last30 = localDateOffset(-30);
    const last90 = localDateOffset(-90);
    return leads
      .filter((lead) => {
        if (status !== "all" && lead.status !== status) return false;
        if (evidence === "with-value" && lead.estimatedValue === null) return false;
        if (evidence === "missing-value" && lead.estimatedValue !== null) return false;
        if (dateFilter === "last-30" && lead.dateReceived < last30) return false;
        if (dateFilter === "last-90" && lead.dateReceived < last90) return false;
        if (dateFilter === "older" && lead.dateReceived >= last90) return false;
        return !q || lead.name.toLowerCase().includes(q) || lead.source.toLowerCase().includes(q);
      })
      .sort((a, b) => {
        if (sort === "attention") {
          return ATTENTION_RANK[a.status] - ATTENTION_RANK[b.status]
            || b.dateReceived.localeCompare(a.dateReceived)
            || a.name.localeCompare(b.name, "en");
        }
        if (sort === "recent") {
          return b.dateReceived.localeCompare(a.dateReceived) || a.name.localeCompare(b.name, "en");
        }
        if (sort === "value") {
          return (b.estimatedValue ?? -1) - (a.estimatedValue ?? -1)
            || a.name.localeCompare(b.name, "en");
        }
        return a.name.localeCompare(b.name, "en");
      });
  }, [leads, query, status, evidence, dateFilter, sort]);

  const openCount = leads.filter((lead) => !["won", "lost"].includes(lead.status)).length;
  const pipelineValue = leads.reduce((total, lead) => total + (lead.estimatedValue ?? 0), 0);
  const filtersActive = Boolean(
    query.trim()
    || status !== "all"
    || evidence !== "all"
    || dateFilter !== "all"
    || sort !== "attention",
  );

  return (
    <section className="flex flex-col gap-4" aria-labelledby="lead-list-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="lead-list-heading" className="font-medium">Lead pipeline</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Review opportunities, missing estimates, and next follow-up priorities.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating((value) => !value)}
          className="rounded-md bg-foreground px-4 py-2 text-sm text-background"
        >
          {creating ? "Close new lead" : "New lead"}
        </button>
      </div>
      {creating && <LeadForm mode="create" projectSlugs={projectSlugs} onCancel={() => setCreating(false)} />}

      <div className="grid gap-3 sm:grid-cols-3">
        <ListMetric label="Total leads" value={leads.length} />
        <ListMetric label="Open pipeline" value={openCount} />
        <ListMetric
          label="Recorded value"
          value={`$${pipelineValue.toLocaleString()}`}
          detail={`${leads.filter((lead) => lead.estimatedValue === null).length} without an estimate`}
        />
      </div>

      <AdvancedListToolbar columnsClassName="md:grid-cols-2 xl:grid-cols-5">
        <AdvancedListField label="Search">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name or source..."
            className={advancedListControlClass}
          />
        </AdvancedListField>
        <AdvancedListField label="Status">
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as LeadStatus | "all")}
            className={advancedListControlClass}
          >
            {STATUS_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value === "all" ? "All statuses" : formatListValueLabel(value)}
              </option>
            ))}
          </select>
        </AdvancedListField>
        <AdvancedListField label="Received">
          <select
            value={dateFilter}
            onChange={(event) => setDateFilter(event.target.value as LeadDateFilter)}
            className={advancedListControlClass}
          >
            <option value="all">Any date</option>
            <option value="last-30">Last 30 days</option>
            <option value="last-90">Last 90 days</option>
            <option value="older">Older than 90 days</option>
          </select>
        </AdvancedListField>
        <AdvancedListField label="Estimate">
          <select
            value={evidence}
            onChange={(event) => setEvidence(event.target.value as LeadEvidenceFilter)}
            className={advancedListControlClass}
          >
            <option value="all">All estimate states</option>
            <option value="with-value">Estimate recorded</option>
            <option value="missing-value">Estimate missing</option>
          </select>
        </AdvancedListField>
        <AdvancedListField label="Sort by">
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as LeadSort)}
            className={advancedListControlClass}
          >
            <option value="attention">Pipeline attention</option>
            <option value="recent">Newest received</option>
            <option value="value">Highest value</option>
            <option value="name">Name</option>
          </select>
        </AdvancedListField>
      </AdvancedListToolbar>

      <AdvancedListSummary
        shown={filtered.length}
        total={leads.length}
        noun="lead"
        filtersActive={filtersActive}
        onClear={() => {
          setQuery("");
          setStatus("all");
          setEvidence("all");
          setDateFilter("all");
          setSort("attention");
        }}
      />

      <div className="grid gap-3">
        {filtered.map((lead, index) => (
          <article
            key={lead.slug}
            /* Same capped cascade as the QAQC list, so the two browsers arrive alike. */
            className="stat-card card-hover animate-fade-in-up rounded-lg border border-border p-4 hover:border-accent"
            style={{ animationDelay: `${Math.min(index, 10) * 45}ms` }}
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <Link href={`/leads/${lead.slug}`} className="group min-w-0 flex-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mode-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent"><AppIcon name="leads" className="h-4 w-4" /></span>
                  <span className="font-medium group-hover:underline">
                    {lead.name}
                  </span>
                  <StatusBadge status={lead.status} />
                </div>
                <dl className="mt-3 grid gap-x-5 gap-y-2 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-muted-foreground">Source</dt>
                    <dd className="mt-0.5">{lead.source}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Received</dt>
                    <dd className="mt-0.5 tabular-nums">{formatListDate(lead.dateReceived)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Estimated value</dt>
                    <dd className="mt-0.5 tabular-nums">
                      {lead.estimatedValue === null ? "Not recorded" : `$${lead.estimatedValue.toLocaleString()}`}
                    </dd>
                  </div>
                </dl>
              </Link>
              <LeadCardActions slug={lead.slug} name={lead.name} />
            </div>
          </article>
        ))}
        {filtered.length === 0 && (
          <AdvancedListEmpty>
            {leads.length === 0 ? "No leads yet. Use New lead to create the first record." : "No leads match your filters."}
          </AdvancedListEmpty>
        )}
      </div>
    </section>
  );
}
