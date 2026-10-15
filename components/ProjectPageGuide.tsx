"use client";

import { usePathname } from "next/navigation";
import { AppIcon } from "@/components/AppIcon";

export interface ProjectGuideContent {
  title: string;
  purpose: string;
  steps: readonly string[];
}

const GUIDES: Record<string, ProjectGuideContent> = {
  "": { title: "Overview", purpose: "Use this as the project pulse check before deciding where to work.", steps: ["Review attention reasons", "Confirm missing source records", "Open the workspace that owns the next action"] },
  analysis: { title: "Analysis", purpose: "Review project evidence and patterns without changing source records.", steps: ["Check the evidence window", "Trace findings back to their source", "Treat AI conclusions as drafts"] },
  schedule: { title: "Plan & Timeline", purpose: "Plan phases and milestones, then review every proposed write before it leaves Mi.", steps: ["Confirm phase sequence", "Set milestone dates", "Review Notion changes before applying"] },
  meetings: { title: "Meetings & Notes", purpose: "Keep dated meeting context and follow-up records together.", steps: ["Add the meeting date", "Capture decisions and actions", "Link only confirmed source material"] },
  decisions: { title: "Decisions", purpose: "Record decisions with their status, rationale, and source trail.", steps: ["Capture the proposed decision", "Add supporting evidence", "Mark it decided only after confirmation"] },
  "architect-tools": { title: "Architect Tools", purpose: "Use focused design utilities while preserving the project record as the source of truth.", steps: ["Choose the relevant tool", "Review assumptions", "Save only confirmed output"] },
  details: { title: "Project Details", purpose: "Maintain confirmed identity, scope, commercial, and integration metadata.", steps: ["Leave unknown fields blank", "Confirm Notion and Dropbox links", "Save reviewed changes"] },
  files: { title: "Project files", purpose: "Find recent documents and PDFs across this project's confirmed folder.", steps: ["Search by filename or path", "Review the destination before saving a PDF", "Share a handoff with the next person or agent"] },
  activity: { title: "Activity & shared handoffs", purpose: "Review changes and pick up work from another session.", steps: ["Review changed files and records", "Share a summary with exact file references", "Continue in a new chat from a handoff"] },
  drawings: { title: "Drawings", purpose: "Track drawing sets and their review state.", steps: ["Identify the exact set", "Record its date and status", "Keep source references attached"] },
  history: { title: "History", purpose: "Read the project chronology assembled from recorded evidence.", steps: ["Scan recent activity", "Open source records for detail", "Correct the source—not the summary"] },
  checklist: { title: "Code Checklist", purpose: "Track code checks as review evidence, not automatic compliance claims.", steps: ["Confirm applicable criteria", "Record evidence", "Resolve or assign open checks"] },
  qaqc: { title: "QA/QC", purpose: "Document review items, responsibility, and closure evidence.", steps: ["Capture the exact issue", "Assign a responsible person", "Close only with reviewed evidence"] },
  questions: { title: "Questions", purpose: "Keep unresolved project questions visible until an answer is confirmed.", steps: ["State one clear question", "Record who owns the answer", "Link the confirmed response"] },
  submissions: { title: "Submissions", purpose: "Track what was sent, when, and what response is expected.", steps: ["Identify the package", "Confirm recipient and date", "Record response or resubmission"] },
  "site-reports": { title: "Site Reports", purpose: "Capture dated observations without overstating what was verified.", steps: ["Record visit context", "Attach factual observations", "Track open follow-ups"] },
  inspiration: { title: "Inspiration", purpose: "Collect references separately from approved project decisions.", steps: ["Save the source", "Note why it matters", "Promote it only after design review"] },
  budget: { title: "Budget", purpose: "Review recorded fee and cost information with its evidence boundaries visible.", steps: ["Confirm the source", "Review current totals", "Resolve missing or conflicting values"] },
  knowledge: { title: "Project Knowledge", purpose: "Keep confirmed facts together and publish reviewed knowledge to the linked Notion page.", steps: ["Review captured facts", "Accept inbox items or add a note", "Preview knowledge before publishing"] },
  contracts: { title: "Contracts", purpose: "Keep agreements and their confirmed source documents together.", steps: ["Review the linked agreement", "Check scope and fees", "Keep the source document attached"] },
  deliverables: { title: "Deliverables", purpose: "Track what needs to be issued and what has already been delivered.", steps: ["Identify the expected output", "Check its current status", "Record the issued package"] },
  terminal: { title: "Project Terminal", purpose: "Work in the project shell and send draft findings to the review inbox.", steps: ["Check the workspace", "Capture findings as review items", "Review and accept them in Mi"] },
};

export function projectGuideForPath(pathname: string): ProjectGuideContent {
  const parts = pathname.split("/").filter(Boolean);
  const route = parts[2] ?? "";
  return GUIDES[route] ?? {
    title: "Project workspace",
    purpose: "Use confirmed project records and keep the source trail visible.",
    steps: ["Review existing evidence", "Make the smallest needed update", "Confirm any external write"],
  };
}

export function ProjectPageGuide() {
  const guide = projectGuideForPath(usePathname());
  return (
    <details className="group rounded-lg border border-border/60 px-3 py-2">
      <summary className="flex cursor-pointer list-none items-center gap-3 text-sm [&::-webkit-details-marker]:hidden">
        <AppIcon name="info" className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 text-muted-foreground">How to use {guide.title}</span>
        <span aria-hidden="true" className="text-muted-foreground transition-transform group-open:rotate-45">+</span>
      </summary>
      <p className="mt-3 text-sm text-muted-foreground">{guide.purpose}</p>
      <ol className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
        {guide.steps.map((step, index) => <li key={step} className="rounded-md bg-muted/60 px-3 py-2"><span className="mr-2 font-mono text-accent">{index + 1}</span>{step}</li>)}
      </ol>
    </details>
  );
}
