"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { AppIcon, type AppIconName } from "./AppIcon";
import { MiMark } from "./MiMark";
import { WorkspacePaneButton } from "./WorkspacePaneButton";
import {
  openChatPane,
  openTerminalPane,
  useDesktopPaneWindows,
  useTerminalSurfaceEnabled,
  useWorkspacePaneState,
} from "./workspacePanes";
import {
  PROJECT_CHAT_OPEN_EVENT,
  createProjectChatOpenDetail,
} from "./projectChatUi";

export const DAILY_WORKSPACE_ITEMS = [
  ["Overview", "", "overview"],
  ["Plan", "/schedule", "calendar"],
  // Knowledge sits in the daily row, not under More: it is the readable face of
  // memory/notes.md, which every confirmed review card appends to. Leaving it out is what
  // left a project's accumulated facts, risks and findings with no home but a five-entry
  // preview at the bottom of the overview.
  ["Knowledge", "/knowledge", "journal"],
  ["Files", "/files", "files"],
  ["Activity", "/activity", "history"],
] as const satisfies ReadonlyArray<readonly [string, string, AppIconName]>;

/** Terminal is deliberately absent: it is a workspace mode alongside Talk to Mi (see the
 * pane switch below), not a specialist tool filed under More. */
export const PROJECT_TOOL_ITEMS = [
  ["Architect tools", "architect-tools", "tools"],
  ["Dropbox files", "dropbox", "files"],
] as const satisfies ReadonlyArray<readonly [string, string, AppIconName]>;

export const PROJECT_RECORD_ITEMS = [
  ["Meetings", "meetings", "meeting"],
  ["Decisions", "decisions", "decision"],
  ["Analysis", "analysis", "analysis"],
  ["Drawings", "drawings", "drawings"],
  ["History", "history", "history"],
  ["Code checklist", "checklist", "checklist"],
  ["QA/QC", "qaqc", "qaqc"],
  ["Questions", "questions", "questions"],
  ["Submissions", "submissions", "submissions"],
  ["Site reports", "site-reports", "site"],
  ["Inspiration", "inspiration", "inspiration"],
  ["Budget", "budget", "budget"],
  ["Contracts", "contracts", "files"],
  ["Deliverables", "deliverables", "checklist"],
] as const satisfies ReadonlyArray<readonly [string, string, AppIconName]>;

export function projectWorkspaceActivePath(pathname: string, slug: string): string {
  const base = `/projects/${slug}`;
  if (pathname === base || pathname === `${base}/`) return "";
  if (!pathname.startsWith(`${base}/`)) return "";
  const route = pathname.slice(base.length + 1).split("/")[0];
  return route ? `/${route}` : "";
}

export function CurrentProjectWorkspaceNav({ slug }: { slug: string }) {
  return <ProjectWorkspaceNav slug={slug} active={projectWorkspaceActivePath(usePathname(), slug)} />;
}

export function ProjectWorkspaceNav({ slug, active = "" }: { slug: string; active?: string }) {
  const [toolQuery, setToolQuery] = useState("");
  const matchesTool = ([label, route]: readonly [string, string, AppIconName]) =>
    `${label} ${route}`.toLowerCase().includes(toolQuery.trim().toLowerCase());
  const matchingTools = PROJECT_TOOL_ITEMS.filter(matchesTool);
  const matchingRecords = PROJECT_RECORD_ITEMS.filter(matchesTool);
  const secondaryRoutes = [...PROJECT_TOOL_ITEMS, ...PROJECT_RECORD_ITEMS]
    .map(([, route]) => `/${route}`);
  const secondaryActive = secondaryRoutes.includes(active);
  const activeLabel = active === "/details" ? "Edit project" : active === "/terminal" ? "Terminal"
    : DAILY_WORKSPACE_ITEMS.find(([, suffix]) => suffix === active)?.[0]
      ?? [...PROJECT_TOOL_ITEMS, ...PROJECT_RECORD_ITEMS].find(([, route]) => `/${route}` === active)?.[0]
      ?? "Project workspace";
  const panes = useWorkspacePaneState();
  const desktopPanes = useDesktopPaneWindows();
  const terminalEnabled = useTerminalSurfaceEnabled();
  const terminalWorkspace = `projects/${slug}`;
  const terminalWindowCount = panes.terminals.filter(pane => pane.workspace === terminalWorkspace).length;

  function openProjectChat(mode?: "interview") {
    window.dispatchEvent(new CustomEvent(PROJECT_CHAT_OPEN_EVENT, {
      detail: createProjectChatOpenDetail(slug, mode),
    }));
  }

  return (
    <nav
      aria-label="Project workspace"
      className="project-workspace-nav surface-depth rounded-xl border border-border bg-card p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Project workspace · {activeLabel}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            <Link href={`/projects/${slug}/details`} aria-current={active === "/details" ? "page" : undefined} className="text-link underline-offset-4 hover:underline">Edit project</Link>
            <Link href={`/review?workspace=${encodeURIComponent(`project/${slug}`)}`} className="text-link underline-offset-4 hover:underline">Review inbox</Link>
            {terminalEnabled && terminalWindowCount > 0 && <Link href={`/projects/${slug}/terminal`} className="text-link underline-offset-4 hover:underline">
              {terminalWindowCount} terminal {terminalWindowCount === 1 ? "window" : "windows"} open
            </Link>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Project workspace modes">
          <WorkspacePaneButton
            label="Talk to Mi"
            hint="Reviewed drafts and proposals"
            icon={<MiMark gradient className="h-4 w-4" />}
            onOpen={() => openProjectChat()}
            onPopOut={() => openChatPane(slug)}
            poppedOut={panes.chat && panes.chatProject === slug}
          />
          {terminalEnabled && (
            <WorkspacePaneButton
              label="Terminal"
              hint="Direct project shell"
              icon={<AppIcon name="studio" className="h-4 w-4" />}
              href={`/projects/${slug}/terminal`}
              onPopOut={() => openTerminalPane(terminalWorkspace)}
              canPopOut={desktopPanes}
              active={active === "/terminal"}
              poppedOut={panes.terminals?.some((pane) => pane.workspace === terminalWorkspace && pane.session === "1") ?? false}
            />
          )}
        </div>
      </div>

      <label className="mt-3 block text-sm sm:hidden">Go to project section
        <select aria-label="Go to project section" value={active} onChange={event => window.location.assign(`/projects/${slug}${event.target.value}`)}
          className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-foreground">
          <option value="/details">Edit project</option>
          {DAILY_WORKSPACE_ITEMS.map(([label, suffix]) => <option key={suffix} value={suffix}>{label}</option>)}
          <optgroup label="Project tools">{[...PROJECT_TOOL_ITEMS, ...PROJECT_RECORD_ITEMS].map(([label, route]) => <option key={route} value={`/${route}`}>{label}</option>)}</optgroup>
          {active === "/terminal" && <option value="/terminal">Terminal</option>}
        </select>
      </label>
      <button type="button" onClick={() => openProjectChat("interview")} className="mt-2 rounded-md border border-border px-3 py-2 text-sm sm:hidden">Guided interview</button>
      <div className="mt-3 hidden flex-wrap gap-x-3 gap-y-1 sm:flex" aria-label="Daily project sections">
        {DAILY_WORKSPACE_ITEMS.map(([label, suffix, icon]) => (
          <Link
            key={label}
            href={`/projects/${slug}${suffix}`}
            aria-current={active === suffix ? "page" : undefined}
            className={`tactile-control group flex items-center gap-2 rounded-t-md border-b-2 px-2 py-2 text-sm ${
              active === suffix
                ? "border-accent bg-accent/10 text-foreground"
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
            }`}
          >
            <AppIcon name={icon} className="mode-icon h-4 w-4 text-accent" />
            {label}
          </Link>
        ))}
      </div>

      <details key={active} className="progressive-disclosure mt-2 hidden text-sm sm:block">
        <summary className="tactile-control cursor-pointer rounded-md px-2 py-2 font-medium text-muted-foreground hover:bg-muted/40 hover:text-foreground">
          More project tools{secondaryActive ? ` · ${activeLabel}` : ""}
        </summary>
        <label className="mt-2 block text-xs text-muted-foreground">Find a project tool
          <input type="search" value={toolQuery} onChange={event => setToolQuery(event.target.value)} placeholder="Search drawings, contracts, budget…"
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground" />
        </label>
        {!matchingTools.length && !matchingRecords.length && <p role="status" className="mt-2 text-sm text-muted-foreground">No matching tools. Try another name or <button type="button" onClick={() => setToolQuery("")} className="text-link underline">clear search</button>.</p>}
        <div className="mt-2 grid gap-4 rounded-lg border border-border bg-muted/10 p-4 md:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Setup & assistance</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {matchingTools.map(([label, route, icon]) => (
                <Link
                  key={route}
                  href={`/projects/${slug}/${route}`}
                  aria-current={active === `/${route}` ? "page" : undefined}
                  className={`tactile-control inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-2 hover:border-accent ${
                    active === `/${route}` ? "border-accent text-foreground" : "border-border"
                  }`}
                >
                  <AppIcon name={icon} className="h-3.5 w-3.5 text-accent" />
                  {label}
                </Link>
              ))}
              <button
                type="button"
                onClick={() => openProjectChat("interview")}
                className="tactile-control inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-2 hover:border-accent"
              >
                <AppIcon name="interview" className="h-3.5 w-3.5 text-accent" />
                Guided interview
              </button>
            </div>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Specialist records</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
              {matchingRecords.map(([label, route, icon]) => (
                <Link
                  key={route}
                  href={`/projects/${slug}/${route}`}
                  aria-current={active === `/${route}` ? "page" : undefined}
                  className={`tactile-control inline-flex items-center gap-1.5 rounded px-1 py-1 hover:text-foreground ${
                    active === `/${route}` ? "bg-accent/10 text-foreground" : "text-muted-foreground"
                  }`}
                >
                  <AppIcon name={icon} className="h-3.5 w-3.5" />
                  {label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </details>
    </nav>
  );
}
