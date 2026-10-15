"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/StatusBadge";
import { ProjectNotionSyncButton } from "@/components/ProjectNotionSyncButton";
import { ProjectIdentity } from "@/components/ProjectIdentity";
import { EmptyState } from "@/components/UiState";
import type { ProjectPortfolioSnapshot } from "@/lib/content/portfolioAnalytics";
import {
  filterAndSortPortfolioProjects,
  type ProjectListEvidenceFilter,
  type ProjectListSort,
  type ProjectListStatusFilter,
} from "./portfolioFilters";
import { hasMiDragKind, readMiDragData, setMiDragData } from "./miDragData";
import { DEFAULT_PROJECT_LIST_PREFERENCES, PROJECT_LIST_PREFERENCES_KEY, parseProjectListPreferences, type ProjectListPreferences } from "./projectListPreferences";
import { usePortfolioUpdates } from "./usePortfolioUpdates";

export type ProjectListEntry = ProjectPortfolioSnapshot;

const STATUS_OPTIONS: Array<{ value: ProjectListStatusFilter; label: string }> = [
  { value: "active", label: "Active projects" },
  { value: "all", label: "All statuses" },
  { value: "not-started", label: "Not started" },
  { value: "in-progress", label: "In progress" },
  { value: "complete", label: "Complete" },
  { value: "abandoned", label: "Abandoned" },
];

const EVIDENCE_OPTIONS: Array<{ value: ProjectListEvidenceFilter; label: string }> = [
  { value: "all", label: "All evidence states" },
  { value: "needs-attention", label: "Has attention reasons" },
  { value: "unmeasured", label: "Health unmeasured" },
  { value: "partial", label: "Partially measured" },
  { value: "measured", label: "Measured" },
];

const SORT_OPTIONS: Array<{ value: ProjectListSort; label: string }> = [
  { value: "attention", label: "Attention priority" },
  { value: "manual", label: "My order (drag to arrange)" },
  { value: "deadline", label: "Next deadline" },
  { value: "created-desc", label: "Newest project first" },
  { value: "created-asc", label: "Oldest project first" },
  { value: "activity-desc", label: "Latest activity" },
  { value: "name", label: "Project name" },
  { value: "health", label: "Health" },
];

const REASON_STATUS = {
  performance: "overdue",
  planning: "at-risk",
  evidence: "pending",
  integration: "pending",
};

function HealthBadge({ project }: { project: ProjectListEntry }) {
  if (project.healthEvidenceState === "unmeasured") {
    return <StatusBadge status="pending" label="Health unmeasured" title={project.healthExplanation} />;
  }
  if (project.healthEvidenceState === "partial") {
    return <StatusBadge status="warning" label="Partially measured" title={`${project.healthExplanation} Available-record score: ${project.healthScore}.`} />;
  }
  return (
    <StatusBadge
      status={project.healthAssessment === "healthy" ? "complete" : "at-risk"}
      label={`${project.healthScore} health`}
      title={project.healthExplanation}
    />
  );
}

export function ProjectsBrowser({ projects }: { projects: ProjectListEntry[] }) {
  const { updates, errors: updateErrors, refresh: refreshUpdates } = usePortfolioUpdates(projects.map(p => p.slug));
  const [onlyUpdated, setOnlyUpdated] = useState(false);
  const [updatedFirst, setUpdatedFirst] = useState(false);
  const [query, setQuery] = useState("");
  const [preferences, setPreferences] = useState(DEFAULT_PROJECT_LIST_PREFERENCES);
  const { status, evidence, sort } = preferences;
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [manualOrder, setManualOrder] = useState<string[]>([]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [orderMessage, setOrderMessage] = useState("");
  const reordering = sort === "manual";

  useEffect(() => {
    const restore = () => {
      try { setPreferences(parseProjectListPreferences(window.localStorage.getItem(PROJECT_LIST_PREFERENCES_KEY))); }
      catch { /* Keep the default view if storage is unavailable. */ }
      setPreferencesReady(true);
    };
    restore();
  }, []);

  function changeView(next: Partial<ProjectListPreferences>) {
    const value = { ...preferences, ...next };
    setPreferences(value);
    try { window.localStorage.setItem(PROJECT_LIST_PREFERENCES_KEY, JSON.stringify(value)); }
    catch { /* The current view still works without persistence. */ }
  }

  useEffect(() => {
    let active = true;
    fetch("/api/personal/project-order")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (active && Array.isArray(data?.order?.slugs)) setManualOrder(data.order.slugs);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const filtered = useMemo(
    () => filterAndSortPortfolioProjects(projects, { query, status, evidence, sort, manualOrder })
      .filter(project => !onlyUpdated || updates[project.slug]?.count > 0)
      .sort((a, b) => updatedFirst ? (updates[b.slug]?.observedAt ?? 0) - (updates[a.slug]?.observedAt ?? 0) : 0),
    [projects, query, status, evidence, sort, manualOrder, onlyUpdated, updatedFirst, updates],
  );

  /**
   * Every project in current personal order, not just the visible ones -- dragging while a
   * filter is applied must not discard the position of everything filtered out.
   */
  const fullOrder = useMemo(
    () => filterAndSortPortfolioProjects(projects, { status: "all", sort: "manual", manualOrder })
      .map((project) => project.slug),
    [projects, manualOrder],
  );

  async function persistOrder(slugs: string[]) {
    setManualOrder(slugs);
    setOrderMessage("");
    try {
      const response = await fetch("/api/personal/project-order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slugs }),
      });
      if (!response.ok) throw new Error("Could not save your order.");
      const data = await response.json();
      if (Array.isArray(data?.order?.slugs)) setManualOrder(data.order.slugs);
    } catch {
      setOrderMessage("Your order was applied here but could not be saved for next time.");
    }
  }

  function moveRelativeTo(slug: string, targetSlug: string) {
    if (slug === targetSlug) return;
    const visible = filtered.map((project) => project.slug);
    const movingDown = visible.indexOf(slug) < visible.indexOf(targetSlug);
    const next = fullOrder.filter((entry) => entry !== slug);
    const targetIndex = next.indexOf(targetSlug);
    if (targetIndex === -1) return;
    next.splice(movingDown ? targetIndex + 1 : targetIndex, 0, slug);
    void persistOrder(next);
  }

  /** Keyboard equivalent of a drag: swap with the neighbour that is actually on screen. */
  function nudge(slug: string, direction: -1 | 1) {
    const visible = filtered.map((project) => project.slug);
    const neighbour = visible[visible.indexOf(slug) + direction];
    if (neighbour) moveRelativeTo(slug, neighbour);
  }

  return (
    <section aria-labelledby="project-list-heading" className="flex min-w-0 flex-col gap-4">
      <div>
        <h2 id="project-list-heading" className="font-medium">Project list</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Active means in progress. Your status, evidence filter, and sort order are remembered on this device.
        </p>
      </div>

      <fieldset disabled={!preferencesReady} className="grid min-w-0 gap-3 rounded-lg border border-border bg-card p-4 md:grid-cols-2 xl:grid-cols-4">
        <label className="md:col-span-2 xl:col-span-1">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Search</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, address, client, type…"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Status</span>
          <select
            value={status}
            onChange={(event) => changeView({ status: event.target.value as ProjectListStatusFilter })}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
          >
            {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Attention / evidence</span>
          <select
            value={evidence}
            onChange={(event) => changeView({ evidence: event.target.value as ProjectListEvidenceFilter })}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
          >
            {EVIDENCE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Sort by</span>
          <select
            value={sort}
            onChange={(event) => changeView({ sort: event.target.value as ProjectListSort })}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
          >
            {SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyUpdated} onChange={event => setOnlyUpdated(event.target.checked)} />Updated since my review</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={updatedFirst} onChange={event => { setUpdatedFirst(event.target.checked); if (event.target.checked && sort === "manual") changeView({ sort: "attention" }); }} />Latest detected changes first</label>
        <button type="button" onClick={refreshUpdates} className="rounded border border-border px-3 py-1.5 text-xs">Refresh updates</button>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          Showing {filtered.length} of {projects.length} portfolio projects.
        </p>
        <button type="button" disabled={!preferencesReady} onClick={() => { changeView(DEFAULT_PROJECT_LIST_PREFERENCES); setQuery(""); setOnlyUpdated(false); setUpdatedFirst(false); }}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">Reset view</button>
        {reordering && manualOrder.length > 0 && (
          <button
            type="button"
            onClick={() => void persistOrder([])}
            className="text-xs text-muted-foreground underline"
          >
            Clear my order
          </button>
        )}
      </div>
      {reordering && (
        <p className="rounded-md border border-border bg-muted/10 p-3 text-xs text-muted-foreground">
          Drag the handle, or use the arrows, to arrange projects. This order is yours alone — it
          stays on this computer and is never shared through Dropbox or Notion. Projects you
          haven&apos;t placed stay in attention order underneath.
        </p>
      )}
      {orderMessage && <p role="status" className="text-xs text-status-danger-foreground">{orderMessage}</p>}
      <p className="text-xs text-muted-foreground">Update highlights compare project files and records with your last review on this device. The first scan establishes a baseline.{updateErrors > 0 ? ` ${updateErrors} project scan(s) unavailable; open the project to check its folder connection.` : ""}</p>
      {sort === "created-desc" || sort === "created-asc" ? (
        <p className="text-xs text-muted-foreground">
          Creation date comes from the linked Notion page. Projects without a confirmed Notion
          link sort to the end.
        </p>
      ) : null}

      <div className="grid min-w-0 gap-3">
        {filtered.map((project, index) => (
          <article
            key={project.slug}
            className={`card-hover relative min-w-0 rounded-lg border p-4 hover:border-accent ${
              dragging === project.slug
                ? "border-accent opacity-60"
                : dropTarget === project.slug
                  ? "border-accent bg-accent/10 ring-2 ring-accent"
                  : updates[project.slug]?.count > 0 ? "border-accent bg-accent/5" : "border-border"
            }`}
            onDragEnter={reordering ? (event) => {
              if (hasMiDragKind(event.dataTransfer, "portfolio-project")) setDropTarget(project.slug);
            } : undefined}
            onDragOver={reordering ? (event) => {
              if (!hasMiDragKind(event.dataTransfer, "portfolio-project")) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            } : undefined}
            onDragLeave={reordering ? (event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
            } : undefined}
            onDrop={reordering ? (event) => {
              event.preventDefault();
              const payload = readMiDragData(event.dataTransfer);
              if (payload?.kind === "portfolio-project") moveRelativeTo(payload.id, project.slug);
              setDragging(null);
              setDropTarget(null);
            } : undefined}
          >
            <Link
              href={`/projects/${project.slug}`}
              className="absolute inset-0 z-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-hidden="true"
              tabIndex={-1}
            />
            <div className="pointer-events-none relative z-10 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              {reordering && (
                <div className="pointer-events-auto flex shrink-0 items-center gap-1 lg:flex-col lg:items-start">
                  <button
                    type="button"
                    draggable
                    onDragStart={(event) => {
                      setMiDragData(event.dataTransfer, { kind: "portfolio-project", id: project.slug, mode: "move" });
                      setDragging(project.slug);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setDropTarget(null);
                    }}
                    aria-label={`Drag ${project.name} to reorder`}
                    title="Drag to reorder"
                    className="cursor-grab select-none rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:border-accent hover:bg-muted/40 active:cursor-grabbing"
                  >
                    ⠿ Drag
                  </button>
                  <span className="flex gap-1">
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => nudge(project.slug, -1)}
                      aria-label={`Move ${project.name} up`}
                      className="rounded border border-border px-1.5 py-0.5 text-xs disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={index === filtered.length - 1}
                      onClick={() => nudge(project.slug, 1)}
                      aria-label={`Move ${project.name} down`}
                      className="rounded border border-border px-1.5 py-0.5 text-xs disabled:opacity-30"
                    >
                      ↓
                    </button>
                  </span>
                </div>
              )}
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <ProjectIdentity name={project.name} slug={project.slug} compact />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/projects/${project.slug}`}
                    className="pointer-events-auto relative z-10 font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {project.name}
                  </Link>
                  <StatusBadge status={project.status} />
                  {updates[project.slug]?.count > 0 && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-foreground" title={updates[project.slug].label}>Updated · {updates[project.slug].count}</span>}
                  </div>
                  {updates[project.slug]?.count > 0 && <p className="mt-1 break-all text-xs text-muted-foreground">Changed: {updates[project.slug].label}{updates[project.slug].count > 1 ? ` and ${updates[project.slug].count - 1} more` : ""}</p>}
                  <div className="mt-1 text-sm text-muted-foreground">
                  {project.address || "No address recorded"}
                  {project.client ? ` · ${project.client}` : ""}
                  </div>
                  <dl className="mt-3 grid gap-x-5 gap-y-2 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-muted-foreground">Next incomplete milestone</dt>
                    <dd className="mt-0.5">
                      {project.nextIncompleteMilestone ? (
                        <Link
                          href={`/projects/${project.slug}/schedule`}
                          className="pointer-events-auto relative z-10 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          {project.nextIncompleteMilestone.name} · {project.nextIncompleteMilestone.plannedDate}
                        </Link>
                      ) : "No upcoming milestone"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Tracking coverage</dt>
                    <dd className="mt-0.5 tabular-nums">
                      {project.trackingCoverage.populated}/{project.trackingCoverage.total} populated areas
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Latest recorded activity</dt>
                    <dd className="mt-0.5">{project.latestRecordedActivity ?? "No recorded activity"}</dd>
                  </div>
                  </dl>
                  {project.attentionReasons.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {project.attentionReasons.slice(0, 5).map((reason) =>
                      reason.href ? (
                        <Link
                          key={reason.code}
                          href={reason.href}
                          title={`${reason.category} · Source: ${reason.source} · Click to confirm`}
                          className="pointer-events-auto relative z-10 inline-block rounded-full bg-status-neutral px-2.5 py-0.5 text-xs font-medium text-status-neutral-foreground underline decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          {reason.label} →
                        </Link>
                      ) : (
                        <StatusBadge
                          key={reason.code}
                          status={REASON_STATUS[reason.category]}
                          label={reason.label}
                          title={`${reason.category} · Source: ${reason.source}`}
                        />
                      ),
                    )}
                    {project.attentionReasons.length > 5 ? (
                      <span className="self-center text-xs text-muted-foreground">
                        +{project.attentionReasons.length - 5} more
                      </span>
                    ) : null}
                  </div>
                ) : null}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
                {project.notionLinkState === "confirmed" && (
                  <ProjectNotionSyncButton slug={project.slug} projectName={project.name} />
                )}
                <HealthBadge project={project} />
                <span className="text-xs text-muted-foreground">
                  {project.populatedHealthAreas.length}/6 health areas
                </span>
              </div>
            </div>
          </article>
        ))}
        {filtered.length === 0 ? (
          <EmptyState
            icon={projects.length === 0 ? "projects" : "search"}
            title={projects.length === 0 ? "No projects yet" : "No matching projects"}
            description={projects.length === 0
              ? <>Create a project above, or add a reviewed folder under <code>projects/</code>.</>
              : "Adjust the project filters to bring more work back into view."}
          />
        ) : null}
      </div>
    </section>
  );
}
