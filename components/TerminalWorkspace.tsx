"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { WorkspaceTerminal } from "@/components/WorkspaceTerminal";
import { StudioScheduleCalendar } from "@/components/StudioScheduleCalendar";

export interface TerminalWorkspaceProject {
  slug: string;
  name: string;
  status: string | null;
  dropboxLinked: boolean;
}

export interface TerminalWorkspaceLead {
  slug: string;
  name: string;
  status: string | null;
  dropboxLinked: boolean;
}

const STORAGE_KEY = "mi.studio.workspace.v1";
const GUIDE_STORAGE_KEY = "mi.studio.guide.v1";
const FIRM_WORKSPACE = "firm";
/** Namespaces a lead's workspace key against the project list, which lives in the same
 * flat string -- a project and a lead could otherwise share a slug and collide. */
const LEAD_PREFIX = "lead:";

type StudioTab = "terminal" | "calendar";

export function TerminalWorkspace({
  projects,
  leads = [],
}: {
  projects: TerminalWorkspaceProject[];
  leads?: TerminalWorkspaceLead[];
}) {
  const [workspace, setWorkspace] = useState<string>(FIRM_WORKSPACE);
  const [filter, setFilter] = useState("");
  const [tab, setTab] = useState<StudioTab>("terminal");
  const [guideOpen, setGuideOpen] = useState(true);

  useEffect(() => {
    // Whether the guide is open is a per-machine display preference, so localStorage is the
    // right home for it -- nothing here is firm data.
    if (window.localStorage.getItem(GUIDE_STORAGE_KEY) === "collapsed") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring a local UI preference after hydration
      setGuideOpen(false);
    }
  }, []);

  function toggleGuide() {
    setGuideOpen((open) => {
      window.localStorage.setItem(GUIDE_STORAGE_KEY, open ? "collapsed" : "open");
      return !open;
    });
  }

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    const validSaved = saved === FIRM_WORKSPACE
      || projects.some((project) => project.slug === saved)
      || (saved?.startsWith(LEAD_PREFIX) && leads.some((lead) => `${LEAD_PREFIX}${lead.slug}` === saved));
    if (saved && validSaved) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring a local UI preference after hydration
      setWorkspace(saved);
    }
  }, [projects, leads]);

  const visibleProjects = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return projects.filter((project) => !query || `${project.name} ${project.slug}`.toLowerCase().includes(query));
  }, [filter, projects]);

  const visibleLeads = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return leads.filter((lead) => !query || `${lead.name} ${lead.slug}`.toLowerCase().includes(query));
  }, [filter, leads]);

  const selectedProject = projects.find((project) => project.slug === workspace) ?? null;
  const selectedLead = workspace.startsWith(LEAD_PREFIX)
    ? leads.find((lead) => `${LEAD_PREFIX}${lead.slug}` === workspace) ?? null
    : null;
  const cwd = selectedProject
    ? `projects/${selectedProject.slug}`
    : selectedLead
      ? `leads/${selectedLead.slug}`
      : ".";

  function selectWorkspace(value: string) {
    setWorkspace(value);
    window.localStorage.setItem(STORAGE_KEY, value);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-sm)]">
      {/* The calendar moves out of the middle column and below the whole workspace when it's
          open (see the section after this grid), so it gets the card's full width instead of
          the ~1fr strip between Explorer and the guide. The grid gives up height to make room
          rather than pushing the calendar off-screen. */}
      <div
        className={`grid lg:overflow-hidden ${
          guideOpen
            ? "lg:grid-cols-[15rem_minmax(0,1fr)_17rem]"
            : "lg:grid-cols-[15rem_minmax(0,1fr)_2.75rem]"
        } ${
          tab === "calendar"
            ? "lg:h-[26rem] lg:min-h-[26rem]"
            : "lg:h-[calc(100dvh-9rem)] lg:min-h-[36rem]"
        }`}
      >
        <aside className="border-b border-border bg-muted/15 p-3 lg:flex lg:min-h-0 lg:flex-col lg:border-b-0 lg:border-r" aria-label="Studio workspaces">
          <div className="px-2 pb-3">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Explorer</p>
            <h1 className="mt-1 font-display text-xl font-light">Mi Studio</h1>
          </div>
          <button
            type="button"
            onClick={() => selectWorkspace(FIRM_WORKSPACE)}
            className={`w-full rounded-md px-2 py-2 text-left text-sm ${
              !selectedProject && !selectedLead ? "bg-accent/15 text-foreground" : "text-muted-foreground hover:bg-muted/40"
            }`}
          >
            <span className="block font-medium">Firm + personal</span>
            <span className="block text-xs opacity-75">Portfolio, schedule, leads, QA/QC</span>
          </button>

          <div className="mt-3">
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter projects and leads"
              aria-label="Filter terminal workspaces"
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-accent"
            />
          </div>

          <div className="mt-3 min-h-0 flex-1 space-y-4 overflow-y-auto lg:flex lg:flex-col">
            <div>
              <div className="flex items-center justify-between px-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Projects</p>
                <span className="text-xs text-muted-foreground">{projects.length}</span>
              </div>
              <div className="mt-2 space-y-0.5">
                {visibleProjects.map((project) => (
                  <button
                    key={project.slug}
                    type="button"
                    onClick={() => selectWorkspace(project.slug)}
                    className={`w-full rounded-md px-2 py-2 text-left text-sm ${
                      selectedProject?.slug === project.slug
                        ? "bg-accent/15 text-foreground"
                        : "text-muted-foreground hover:bg-muted/40"
                    }`}
                  >
                    <span className="block truncate">{project.name}</span>
                    <span className="flex items-center gap-1.5 text-[11px] opacity-70">
                      <span className={`h-1.5 w-1.5 rounded-full ${project.dropboxLinked ? "bg-emerald-500" : "bg-muted-foreground"}`} />
                      {project.dropboxLinked ? "Dropbox workspace" : "Link Dropbox first"}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {leads.length > 0 && (
              <div>
                <div className="flex items-center justify-between px-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Leads</p>
                  <span className="text-xs text-muted-foreground">{leads.length}</span>
                </div>
                <div className="mt-2 space-y-0.5">
                  {visibleLeads.map((lead) => (
                    <button
                      key={lead.slug}
                      type="button"
                      onClick={() => selectWorkspace(`${LEAD_PREFIX}${lead.slug}`)}
                      className={`w-full rounded-md px-2 py-2 text-left text-sm ${
                        selectedLead?.slug === lead.slug
                          ? "bg-accent/15 text-foreground"
                          : "text-muted-foreground hover:bg-muted/40"
                      }`}
                    >
                      <span className="block truncate">{lead.name}</span>
                      <span className="flex items-center gap-1.5 text-[11px] opacity-70">
                        <span className={`h-1.5 w-1.5 rounded-full ${lead.dropboxLinked ? "bg-emerald-500" : "bg-muted-foreground"}`} />
                        {lead.dropboxLinked ? "Dropbox workspace" : "Link Dropbox first"}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <nav className="mt-4 space-y-1 border-t border-border pt-3 text-sm">
            <Link href="/leads" className="block rounded-md px-2 py-1.5 text-muted-foreground hover:bg-muted/40 hover:text-foreground">Leads</Link>
            <Link href="/permit-qaqc" className="block rounded-md px-2 py-1.5 text-muted-foreground hover:bg-muted/40 hover:text-foreground">Permit QA/QC</Link>
            <Link href="/search" className="block rounded-md px-2 py-1.5 text-muted-foreground hover:bg-muted/40 hover:text-foreground">Search all records</Link>
          </nav>
        </aside>

        <main className="flex min-w-0 flex-col bg-background p-3 lg:min-h-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Active workspace</p>
              <p className="mt-0.5 truncate font-display text-lg font-light tracking-wide">{selectedProject?.name ?? selectedLead?.name ?? "Firm + personal"}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {tab === "terminal"
                  ? "Persistent native shell · safe to leave running while you work elsewhere in Mi"
                  : "Firm-wide STUDIO Schedule · synced from Notion"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex rounded-md border border-border p-0.5 text-xs" role="tablist" aria-label="Studio view">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "terminal"}
                  onClick={() => setTab("terminal")}
                  className={`rounded px-2.5 py-1 ${tab === "terminal" ? "bg-accent/15 text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Terminal
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "calendar"}
                  onClick={() => setTab("calendar")}
                  className={`rounded px-2.5 py-1 ${tab === "calendar" ? "bg-accent/15 text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Calendar
                </button>
              </div>
              {selectedProject ? (
                <Link href={`/projects/${selectedProject.slug}`} className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-accent">Open project</Link>
              ) : selectedLead ? (
                <Link href={`/leads/${selectedLead.slug}`} className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-accent">Open lead</Link>
              ) : (
                <Link href="/projects/analysis" className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-accent">Portfolio view</Link>
              )}
            </div>
          </div>
          {/* The shell remains visible above Calendar. Named PTYs also survive view remounts. */}
          <div className="h-[70dvh] min-h-[32rem] flex-none lg:h-auto lg:min-h-0 lg:flex-1">
            <WorkspaceTerminal key={cwd} workspace={cwd} />
          </div>
        </main>

        {!guideOpen && (
          <aside
            className="hidden border-border bg-muted/10 lg:flex lg:min-h-0 lg:flex-col lg:items-center lg:border-l lg:py-3"
            aria-label="Workspace guide, collapsed"
          >
            <button
              type="button"
              onClick={toggleGuide}
              aria-expanded={false}
              title="Show workspace guide"
              className="flex flex-col items-center gap-2 rounded-md px-1.5 py-2 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            >
              <span aria-hidden="true" className="text-xs">‹</span>
              <span className="text-[10px] uppercase tracking-[0.18em] [writing-mode:vertical-rl]">
                Guide
              </span>
            </button>
          </aside>
        )}

        <aside
          className={`border-t border-border bg-muted/10 p-4 lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-t-0 ${
            guideOpen ? "" : "hidden"
          }`}
          aria-label="Workspace guide"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Workspace guide</p>
            <button
              type="button"
              onClick={toggleGuide}
              aria-expanded
              title="Hide workspace guide"
              className="-mr-1 -mt-1 hidden rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground lg:block"
            >
              ›
            </button>
          </div>
          <h2 className="mt-1 text-sm font-medium">
            {selectedProject ? "Project-aware agent" : selectedLead ? "Lead-aware agent" : "Firm-wide helper"}
          </h2>
          <div className="mt-4 space-y-4 text-xs text-muted-foreground">
            <Guide title="Start an agent">
              Run <code>codex</code> or <code>claude</code>. Mi launches a plain <code>codex</code> command in its stable inline display mode. The workspace instructions tell it what it may read, where drafts belong, and what requires confirmation.
            </Guide>
            <Guide title="Scrolling + text">
              Use the mouse wheel over the terminal to review history; scrolling up pauses auto-follow. Choose <strong>Jump to latest</strong> to resume. The minus and plus controls adjust text size, and the size value resets it.
            </Guide>
            <Guide title="Memory">
              {selectedProject
                ? <>Durable reviewed notes live in <code>memory/notes.md</code> for this project.</>
                : selectedLead
                  ? <>Durable reviewed notes live in this lead&apos;s own <code>memory/notes.md</code>, separate from the shared firm-wide lead memory Talk to Mi draws on.</>
                  : <>Use the firm workspace memory for personal preferences, lead follow-ups, QA/QC conventions, and portfolio notes.</>}
            </Guide>
            <Guide title="Files + Dropbox">
              {selectedProject
                ? <>The agent may read this confirmed project folder. Dropbox documents remain in place; move, rename, delete, and shared edits require confirmation.</>
                : selectedLead
                  ? <>Starts in this lead&apos;s exact confirmed Dropbox folder when linked, otherwise its structured Mi folder. Move, rename, delete, and shared edits require confirmation.</>
                  : <>Firm data covers shared clients, leads, and Permit QA/QC. Individual project and lead folders remain isolated until you select one.</>}
            </Guide>
            <Guide title="Notion">
              Refreshed project and schedule context is readable here. A project agent can submit its exact proposal JSON through the generated Mi helper, so review cards appear without copy/paste. <strong>Send proposal file to Mi</strong> remains the manual fallback. Real Mi and Notion changes remain drafts until you review and confirm each write.
            </Guide>
            <Guide title="Two-person firm">
              Machine paths and credentials stay local to each computer account. Reviewed Mi data can live in the confirmed shared Dropbox folders so both partners see the same records.
            </Guide>
            <Guide title="Obsidian-ready">
              Memories and project knowledge are plain Markdown. You can open the confirmed Mi folder as an Obsidian vault without converting or exporting a proprietary database.
            </Guide>
          </div>
          <div className="mt-5 rounded-md border border-border bg-background p-3 text-xs">
            <p className="font-medium text-foreground">Good first prompt</p>
            <p className="mt-1 text-muted-foreground">
              {selectedProject
                ? "Review this workspace, summarize current status, open QA/QC items, missing information, and the safest next actions. Save nothing without asking me."
                : selectedLead
                  ? "Review this lead, summarize where it stands, what's missing, and the safest next follow-up. Save nothing without asking me."
                  : "Give me a power view of active projects, schedule pressure, leads needing follow-up, and QA/QC work. Cite the files you used."}
            </p>
          </div>
        </aside>
      </div>

      {tab === "calendar" && (
        <section className="border-t border-border bg-background p-4" aria-label="STUDIO Schedule">
          <StudioScheduleCalendar />
        </section>
      )}
    </div>
  );
}

function Guide({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="font-medium text-foreground">{title}</h3>
      <p className="mt-1 leading-relaxed">{children}</p>
    </section>
  );
}
