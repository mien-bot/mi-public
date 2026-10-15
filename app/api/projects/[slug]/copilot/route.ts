import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import {
  appendProjectMemoryNote,
  appendDropboxProjectMemoryNote,
  getMeetingNotes,
  getProjectWithHash,
  getProjectDetailsWithHash,
  getProjectSlugs,
  getSchedule,
  createProjectDecision,
  createProjectDeliverable,
  createProjectSiteReport,
  getProjectDeliverablesWithHash,
  mirrorProjectKnowledge,
  previewDropboxProjectMemory,
  schedulePath,
  writeMeetingNote,
  writeProjectDetails,
  writeProjectMeta,
  writeProjectSchedule,
  writeReviewFinding,
} from "@/lib/content";
import { readCurrentHash } from "@/lib/content/atomicContentWrite";
import { getProjectWorklog, getProjectWorklogWithHash, projectWorklogPath, summarizeProjectWorklog, writeProjectWorklog } from "@/lib/content/projectWorklog";
import { saveScheduleItemLocally, syncScheduleItems } from "@/lib/content/notionScheduleSync";
import { syncWorklogEntry } from "@/lib/content/worklogSync";
import { projectCopilotProposalSchema } from "@/lib/projectCopilot";
import { projectDetailsSchema, projectMetaSchema, scheduleDraftItemSchema } from "@/lib/schema";
import { resolveNotionPeopleByName } from "@/lib/notion/people";
import { createProjectScheduleEntry } from "@/src/adapters/notion/schedule";
import { getStudioProjectPage } from "@/src/adapters/notion/studioProjects";
import { recordAudit } from "@/src/audit/log";
import { isWriteAllowed } from "@/src/policies/approvals";

function refreshProject(slug: string) {
  revalidatePath(`/projects/${slug}`);
  revalidatePath(`/projects/${slug}/details`);
  revalidatePath(`/projects/${slug}/meetings`);
  revalidatePath(`/projects/${slug}/schedule`);
  revalidatePath(`/projects/${slug}/decisions`);
  revalidatePath(`/projects/${slug}/site-reports`);
  revalidatePath("/search");
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!getProjectSlugs().includes(slug)) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = projectCopilotProposalSchema.safeParse(body?.proposal);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid project proposal." },
      { status: 400 },
    );
  }
  const proposal = parsed.data;

  // Preview is deliberately side-effect free. The model output is validated
  // again on the server, but no local file or external system is touched.
  if (body?.confirmed !== true) {
    return NextResponse.json({ confirmed: false, preview: proposal });
  }

  try {
    const loadedProject = getProjectWithHash(slug);
    const project = loadedProject.project;
    let result: unknown;

    if (proposal.kind === "project-details") {
      const { details: currentDetails, hash } = getProjectDetailsWithHash(slug);
      const details = projectDetailsSchema.parse({
        ...currentDetails,
        ...proposal.data,
      });
      writeProjectDetails(slug, details, { expectedHash: hash });
      result = { destination: "Mi project details", details };
    } else if (proposal.kind === "meeting-note") {
      const duplicate = getMeetingNotes(slug).some(
        (meeting) => meeting.id === proposal.data.id && meeting.date === proposal.data.date,
      );
      if (duplicate) throw new Error("That meeting note already exists. Change its id or review the existing note.");
      const file = writeMeetingNote(slug, proposal.data);
      result = { destination: "Mi meeting notes", file };
    } else if (proposal.kind === "schedule-item") {
      const item = scheduleDraftItemSchema.parse({
        client_request_id: proposal.id,
        ...proposal.data,
      });
      if (body?.destination === "mi") {
        // Captured at load() time, checked at save() time -- protects against a concurrent
        // schedule write (another tab, another machine sharing this Dropbox-migrated project)
        // landing in between, same "capture hash at read" fix as appendProjectMemoryNote above.
        let scheduleHashAtLoad: string | null = null;
        const { id } = saveScheduleItemLocally(item, {
          load: () => {
            scheduleHashAtLoad = readCurrentHash(schedulePath(slug));
            return getSchedule(slug, { includeArchived: true }).milestones;
          },
          save: (milestones) => writeProjectSchedule(slug, milestones, { expectedHash: scheduleHashAtLoad }),
        });
        result = { destination: "Mi timeline", id };
      } else if (body?.destination === "notion") {
        if (!isWriteAllowed("schedule", "create")) {
          return NextResponse.json(
            { error: "Notion schedule-item creation is disabled in mi.config.yaml." },
            { status: 409 },
          );
        }
        let notionScheduleHashAtLoad: string | null = null;
        const results = await syncScheduleItems({
          confirmed: true,
          projectPageId: project.meta.notion_page_id,
          items: [item],
          repository: {
            load: () => {
              notionScheduleHashAtLoad = readCurrentHash(schedulePath(slug));
              return getSchedule(slug, { includeArchived: true }).milestones;
            },
            save: (milestones) => {
              writeProjectSchedule(slug, milestones, { expectedHash: notionScheduleHashAtLoad });
              notionScheduleHashAtLoad = readCurrentHash(schedulePath(slug));
            },
          },
          adapter: { create: (input) => createProjectScheduleEntry(input) },
        });
        result = { destination: "STUDIO Schedule", results };
      } else {
        return NextResponse.json({ error: "Choose Mi only or STUDIO Schedule." }, { status: 400 });
      }
    } else if (proposal.kind === "memory-note") {
      let dropboxMemoryPreview: ReturnType<typeof previewDropboxProjectMemory> | null = null;
      if (body?.destination === "dropbox") {
        try {
          dropboxMemoryPreview = previewDropboxProjectMemory(slug);
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "Dropbox memory is unavailable.";
          return NextResponse.json({ error: message }, { status: 409 });
        }
        if (!dropboxMemoryPreview.available) {
          return NextResponse.json(
            { error: `Dropbox memory is unavailable (${dropboxMemoryPreview.reason}). No memory was saved.` },
            { status: 409 },
          );
        }
      } else if (body?.destination !== undefined && body.destination !== "mi") {
        return NextResponse.json(
          { error: "Choose Mi only or Mi + Dropbox for project memory." },
          { status: 400 },
        );
      }

      const file = appendProjectMemoryNote(slug, { title: proposal.title, entry: proposal.data.entry });
      if (body?.destination !== "dropbox") {
        result = { destination: "Mi project memory", file };
      } else {
        try {
          const dropboxFile = appendDropboxProjectMemoryNote(
            slug,
            { title: proposal.title, entry: proposal.data.entry },
            dropboxMemoryPreview?.currentHash,
          );
          result = {
            destination: "Mi project memory + Dropbox",
            file,
            mirror: {
              status: "success",
              destination: dropboxFile,
              fileCount: 1,
            },
          };
        } catch (cause) {
          result = {
            destination: "Mi project memory",
            file,
            mirror: {
              status: "failed",
              error: cause instanceof Error
                ? `Local memory was saved, but Dropbox mirroring failed: ${cause.message}`
                : "Local memory was saved, but Dropbox mirroring failed.",
            },
          };
        }
      }
    } else if (proposal.kind === "deliverable") {
      // package_path is not in the agent's draft schema at all; it is stored null here and the
      // human links the issued folder in Mi, exactly like notion_page_id and dropbox_path.
      const loaded = getProjectDeliverablesWithHash(slug);
      const deliverable = createProjectDeliverable(
        slug,
        { ...proposal.data, package_path: null },
        loaded.hash,
      );
      result = { destination: "Mi deliverables register", deliverable };
    } else if (proposal.kind === "review-finding") {
      const file = writeReviewFinding(slug, { id: proposal.id, title: proposal.title, ...proposal.data });
      result = { destination: "Mi review findings", file };
    } else if (proposal.kind === "decision-record") {
      const document = createProjectDecision(slug, {
        ...proposal.data,
        recorded_at: new Date().toISOString(),
      });
      let mirror: ReturnType<typeof mirrorProjectKnowledge> | { mirrored: false; error: string };
      try {
        mirror = mirrorProjectKnowledge(slug);
      } catch (cause) {
        mirror = {
          mirrored: false,
          error: cause instanceof Error ? cause.message : "Dropbox Mi mirror failed.",
        };
      }
      result = { destination: "Mi decision register", document, mirror };
    } else if (proposal.kind === "site-report") {
      const timestamp = new Date().toISOString();
      const document = createProjectSiteReport(slug, {
        ...proposal.data,
        created_at: timestamp,
        updated_at: timestamp,
      });
      let mirror: ReturnType<typeof mirrorProjectKnowledge> | { mirrored: false; error: string };
      try {
        mirror = mirrorProjectKnowledge(slug);
      } catch (cause) {
        mirror = {
          mirrored: false,
          error: cause instanceof Error ? cause.message : "Dropbox Mi mirror failed.",
        };
      }
      result = { destination: "Mi site reports", document, mirror };
    } else if (proposal.kind === "project-meta") {
      const meta = projectMetaSchema.parse({
        ...project.meta,
        ...proposal.data,
      });
      writeProjectMeta(slug, meta, { expectedHash: loadedProject.hash });
      result = { destination: "Mi project settings", meta };
    } else {
      if (body?.destination !== "notion") {
        return NextResponse.json({ error: "Hours are confirmed into STUDIO Schedule." }, { status: 400 });
      }
      if (!isWriteAllowed("schedule", "create")) {
        return NextResponse.json(
          { error: "Notion time-entry creation is disabled in mi.config.yaml." },
          { status: 409 },
        );
      }
      if (!project.meta.notion_page_id) {
        return NextResponse.json({ error: "This project is not linked to Notion." }, { status: 409 });
      }
      const page = await getStudioProjectPage(project.meta.notion_page_id);
      const attendeeIds = resolveNotionPeopleByName(
        proposal.data.attendees,
        page.properties.Team?.people ?? [],
      );
      const loadedWorklog = getProjectWorklogWithHash(slug);
      let worklogHash = loadedWorklog.hash;
      const sync = await syncWorklogEntry({
        confirmed: true,
        syncKey: proposal.id,
        projectPageId: project.meta.notion_page_id,
        attendeeIds,
        draft: proposal.data,
        repository: {
          load: () => loadedWorklog.entries,
          save: (entries) => {
            writeProjectWorklog(slug, entries, { expectedHash: worklogHash });
            worklogHash = readCurrentHash(projectWorklogPath(slug));
          },
        },
        adapter: {
          create: (input) => createProjectScheduleEntry({
            projectPageId: input.projectPageId,
            name: input.name,
            date: input.date,
            type: "Work Session",
            hours: input.hours,
            attendeeIds: input.attendeeIds,
          }),
        },
      });
      result = {
        destination: "STUDIO Schedule hours",
        sync,
        tally: summarizeProjectWorklog(getProjectWorklog(slug)),
      };
    }

    refreshProject(slug);
    recordAudit({
      command: `project copilot confirmed ${proposal.kind}`,
      actor: process.env.USERNAME || process.env.USER || "unknown",
      slug,
      diff: proposal.kind === "decision-record"
        ? {
            proposal_id: proposal.id,
            kind: proposal.kind,
            record_id: proposal.data.id,
            status: proposal.data.status,
            source_count: proposal.data.sources.length,
          }
        : proposal.kind === "site-report"
          ? {
              proposal_id: proposal.id,
              kind: proposal.kind,
              record_id: proposal.data.id,
              status: proposal.data.status,
              item_count: proposal.data.items.length,
              photo_reference_count: proposal.data.items.reduce(
                (count, item) => count + item.photo_refs.length,
                0,
              ),
            }
          : { proposal, result },
      applied: true,
    });
    return NextResponse.json({ confirmed: true, result });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "The proposed change could not be applied.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
