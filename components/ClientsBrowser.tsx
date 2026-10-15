"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
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
import { StatusBadge } from "@/components/StatusBadge";
import type { ClientStatus } from "@/lib/schema";

export interface ClientListEntry {
  slug: string;
  name: string;
  status: ClientStatus;
  industry: string | null;
  summary: string | null;
  contactName: string | null;
  contactEmail: string | null;
  firstEngaged: string | null;
  projectCount: number;
}

type ClientSort = "projects" | "name" | "recent";

const STATUS_OPTIONS: Array<ClientStatus | "all"> = ["all", "active", "prospect", "past"];

export function ClientsBrowser({ clients }: { clients: ClientListEntry[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ClientStatus | "all">("all");
  const [sort, setSort] = useState<ClientSort>("projects");

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return clients
      .filter((client) => {
        if (status !== "all" && client.status !== status) return false;
        if (!normalized) return true;
        return [
          client.name,
          client.industry ?? "",
          client.summary ?? "",
          client.contactName ?? "",
          client.contactEmail ?? "",
        ].some((value) => value.toLocaleLowerCase().includes(normalized));
      })
      .sort((a, b) => {
        if (sort === "projects") {
          return b.projectCount - a.projectCount || a.name.localeCompare(b.name, "en");
        }
        if (sort === "recent") {
          return (b.firstEngaged ?? "").localeCompare(a.firstEngaged ?? "")
            || a.name.localeCompare(b.name, "en");
        }
        return a.name.localeCompare(b.name, "en");
      });
  }, [clients, query, status, sort]);

  const filtersActive = Boolean(query.trim() || status !== "all" || sort !== "projects");
  const totalProjects = clients.reduce((total, client) => total + client.projectCount, 0);

  return (
    <section className="flex flex-col gap-4" aria-labelledby="client-list-heading">
      <div>
        <h2 id="client-list-heading" className="font-medium">Client directory</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Search relationships, contacts, industries, and project history.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <ListMetric label="Total clients" value={clients.length} />
        <ListMetric label="Active clients" value={clients.filter((client) => client.status === "active").length} />
        <ListMetric label="Linked projects" value={totalProjects} />
      </div>

      <AdvancedListToolbar columnsClassName="md:grid-cols-3">
        <AdvancedListField label="Search">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, contact, industry..."
            className={advancedListControlClass}
          />
        </AdvancedListField>
        <AdvancedListField label="Status">
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as ClientStatus | "all")}
            className={advancedListControlClass}
          >
            {STATUS_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value === "all" ? "All statuses" : formatListValueLabel(value)}
              </option>
            ))}
          </select>
        </AdvancedListField>
        <AdvancedListField label="Sort by">
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as ClientSort)}
            className={advancedListControlClass}
          >
            <option value="projects">Most projects</option>
            <option value="recent">Most recently engaged</option>
            <option value="name">Name</option>
          </select>
        </AdvancedListField>
      </AdvancedListToolbar>

      <AdvancedListSummary
        shown={filtered.length}
        total={clients.length}
        noun="client"
        filtersActive={filtersActive}
        onClear={() => {
          setQuery("");
          setStatus("all");
          setSort("projects");
        }}
      />

      <div className="grid gap-3">
        {filtered.map((client) => (
          <Link
            key={client.slug}
            href={`/clients/${client.slug}`}
            className="card-hover rounded-lg border border-border p-4 hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{client.name}</span>
                  <StatusBadge status={client.status} />
                </div>
                {client.summary ? (
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{client.summary}</p>
                ) : null}
                <dl className="mt-3 grid gap-x-5 gap-y-2 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-xs text-muted-foreground">Industry</dt>
                    <dd className="mt-0.5">{client.industry || "Not recorded"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Primary contact</dt>
                    <dd className="mt-0.5">
                      <span className="block">{client.contactName || "Not recorded"}</span>
                      {client.contactEmail ? (
                        <span className="block break-all text-xs text-muted-foreground">{client.contactEmail}</span>
                      ) : null}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">First engaged</dt>
                    <dd className="mt-0.5 tabular-nums">{formatListDate(client.firstEngaged)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Projects</dt>
                    <dd className="mt-0.5 tabular-nums">{client.projectCount}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </Link>
        ))}
        {filtered.length === 0 ? (
          <AdvancedListEmpty>
            {clients.length === 0 ? "No clients have been recorded yet." : "No clients match the selected filters."}
          </AdvancedListEmpty>
        ) : null}
      </div>
    </section>
  );
}
