import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import {
  appendProjectMemoryNote,
  getLead,
  getLeadSlugs,
  getProjectDetails,
  getProjectSlugs,
  mirrorProjectKnowledge,
  writeProjectDetails,
} from "@/lib/content";
import { applyLeadHandoff, buildLeadHandoffMarkdown, planLeadHandoff } from "@/lib/content/leadHandoff";
import type { LeadConversionPlan } from "@/lib/content/leadHandoffPlan";
import { leadProjectName } from "@/lib/content/leadProjectName";
import { updateLead, LeadWriteError } from "@/lib/content/leadMutations";
import { syncLeadToNotion } from "@/lib/content/leadNotionSync";
import { DROPBOX_ROOT } from "@/lib/content/paths";
import {
  assertProjectSlugAvailable,
  createDropboxStructure,
  createNotionProjectPage,
  preflightDropbox,
  ProjectCreationError,
  readCreationState,
  writeCreationState,
  type CreationState,
} from "@/lib/content/projectCreation";
import {
  buildProjectCreationPlan,
  isProjectWorkflowProfile,
  safeDropboxFolder,
  safeDropboxFolderList,
  type ProjectWorkflowProfile,
} from "@/lib/content/projectCreationPlan";
import { scaffoldProject } from "@/lib/content/scaffoldProject";
import { slugifyProjectName } from "@/lib/notion/projectMap";
import type { Lead } from "@/lib/schema";
import { recordAudit } from "@/src/audit/log";

/**
 * Converts a lead into a real project: the Mi record, the Dropbox project folder seeded with
 * everything the lead already knows, and the Studio Projects page -- the same three writes the
 * New Project form makes, through the same reviewed-plan machinery (lib/content/projectCreation).
 *
 * The lead's own Dropbox folder is never moved, renamed, or emptied. Its indexed files are
 * copied (originals stay put) and its confirmed path is recorded in the handoff brief, because
 * reorganizing shared team files is a human action, not something Mi automates (see AGENTS.md).
 */

const DEFAULT_WORKFLOW: ProjectWorkflowProfile = "architecture";

interface ConvertInput {
  workflow: ProjectWorkflowProfile;
  dropboxFolder: string;
  customFolders?: string[];
  notionPage: "create" | "skip";
}

function parseInput(lead: Lead, body: Record<string, unknown> | null): ConvertInput {
  const workflow = body?.workflow === undefined ? DEFAULT_WORKFLOW : body.workflow;
  if (!isProjectWorkflowProfile(workflow)) {
    throw new ProjectCreationError("Choose one of the offered working folder profiles.", 400);
  }
  const dropboxFolder = safeDropboxFolder(
    typeof body?.dropboxFolder === "string" && body.dropboxFolder.trim() ? body.dropboxFolder : leadProjectName(lead.name),
  );
  if (!dropboxFolder) {
    throw new ProjectCreationError("A valid Dropbox project folder name is required.", 400);
  }
  const customFolders = body?.folders === undefined ? undefined : safeDropboxFolderList(body.folders);
  if (body?.folders !== undefined && customFolders === null) {
    throw new ProjectCreationError("The edited folder list contains an unsafe folder name.", 400);
  }
  return {
    workflow,
    dropboxFolder,
    customFolders: customFolders ?? undefined,
    notionPage: body?.notionPage === "skip" ? "skip" : "create",
  };
}

/** Derives the project slug from the lead's name, de-duplicated against existing projects. */
function uniqueProjectSlug(lead: Lead, slug: string): string {
  const existingSlugs = new Set(getProjectSlugs());
  const baseSlug = slugifyProjectName(leadProjectName(lead.name), slug);
  let projectSlug = baseSlug;
  let suffix = 2;
  while (existingSlugs.has(projectSlug)) {
    projectSlug = `${baseSlug}-${suffix}`;
    suffix++;
  }
  return projectSlug;
}

function buildPlan(slug: string, lead: Lead, projectSlug: string, input: ConvertInput): LeadConversionPlan {
  const project = buildProjectCreationPlan({
    name: leadProjectName(lead.name),
    slug: projectSlug,
    client: lead.contact_name?.trim() || "",
    location: "",
    status: "not-started",
    workflow: input.workflow,
    projectType: null,
    scopes: [],
    dropboxFolder: input.dropboxFolder,
    dropboxMode: "create",
    dropboxPath: null,
    customFolders: input.customFolders,
  });
  return {
    project,
    lead: { slug, name: lead.name, dropboxFolder: lead.dropbox_path },
    seed: DROPBOX_ROOT
      ? planLeadHandoff(slug, { workflow: input.workflow, folders: project.dropbox.folders })
      : null,
    dropbox: DROPBOX_ROOT ? "create" : "unavailable",
    notionPage: input.notionPage,
  };
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getLeadSlugs().includes(slug)) {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const { lead } = getLead(slug);
  if (lead.converted_project_slug) {
    return NextResponse.json({ error: "This lead has already been converted." }, { status: 409 });
  }

  const convertedDate = new Date().toISOString().slice(0, 10);
  try {
    const input = parseInput(lead, body);
    const requestId = typeof body?.clientRequestId === "string" ? body.clientRequestId : "";
    const prior = requestId ? readCreationState<LeadConversionPlan>(requestId) : null;
    // A resumed request keeps the slug it already created projects/<slug>/ under. Re-deriving
    // it would find that folder taken, pick "<slug>-2", and reject its own reviewed plan.
    const projectSlug = prior?.plan.project.project.slug ?? uniqueProjectSlug(lead, slug);
    const plan = buildPlan(slug, lead, projectSlug, input);

    if (body?.confirmed !== true) {
      assertProjectSlugAvailable(projectSlug, plan.project.mi.localPath);
      if (plan.dropbox === "create") preflightDropbox(plan.project.dropbox, false);
      return NextResponse.json({
        confirmed: false,
        plan,
        handoffPreview: plan.seed
          ? buildLeadHandoffMarkdown(slug, lead, plan.seed, {
            workflow: input.workflow,
            folders: plan.project.dropbox.folders,
            projectSlug,
            dropboxRelativePath: plan.project.dropbox.relativePath,
            convertedDate,
          })
          : null,
      });
    }

    if (!requestId) throw new ProjectCreationError("Preview this exact conversion plan before confirming it.", 409);
    if (JSON.stringify(body?.previewPlan) !== JSON.stringify(plan)) {
      throw new ProjectCreationError("The confirmed plan differs from its preview. Preview again.", 409);
    }
    if (prior && JSON.stringify(prior.plan) !== JSON.stringify(plan)) {
      throw new ProjectCreationError("The confirmed plan differs from its preview. Preview again.", 409);
    }
    if (prior?.phase === "complete") {
      return NextResponse.json({
        confirmed: true,
        alreadyApplied: true,
        projectSlug,
        convertedDate,
        dropboxPath: plan.dropbox === "create" ? plan.project.dropbox.relativePath : null,
      });
    }
    if (prior?.phase === "notion-pending-review") {
      throw new ProjectCreationError(
        "A prior Notion create may have succeeded. Review Studio Projects before retrying so Mi cannot create a duplicate.",
        409,
      );
    }

    // Skipped once the project has been scaffolded: on a resumed request projects/<slug>/
    // exists precisely because this request created it.
    if (prior?.phase !== "scaffolded") {
      assertProjectSlugAvailable(projectSlug, plan.project.mi.localPath);
    }
    const target = plan.dropbox === "create"
      ? preflightDropbox(plan.project.dropbox, Boolean(prior))
      : null;

    const state: CreationState<LeadConversionPlan> = prior ?? {
      requestId,
      plan,
      phase: "prepared",
      createdFolders: [],
    };
    if (!prior) writeCreationState(state);

    if (state.phase === "prepared") {
      if (target) {
        createDropboxStructure(target, plan.project.dropbox, state);
      } else {
        state.phase = "dropbox-created";
        writeCreationState(state);
      }
    }

    let seeded: { written: string[]; skipped: string[] } = { written: [], skipped: [] };
    if (state.phase === "dropbox-created") {
      if (target && plan.seed) {
        seeded = applyLeadHandoff(
          slug,
          target,
          plan.seed,
          buildLeadHandoffMarkdown(slug, lead, plan.seed, {
            workflow: input.workflow,
            folders: plan.project.dropbox.folders,
            projectSlug,
            dropboxRelativePath: plan.project.dropbox.relativePath,
            convertedDate,
          }),
        );
      }
      state.phase = "lead-data-copied";
      writeCreationState(state);
    }

    if (state.phase === "lead-data-copied") {
      if (plan.notionPage === "create") {
        await createNotionProjectPage(state, {
          name: plan.project.project.name,
          status: "not-started",
          client: lead.contact_name?.trim() || "",
        });
      } else {
        state.phase = "notion-created";
        writeCreationState(state);
      }
    }

    if (state.phase === "notion-created") {
      scaffoldProject(projectSlug, plan.project.project.name, {
        client: lead.contact_name?.trim() || null,
        notionPageId: state.notion?.id ?? null,
        dropboxPath: plan.dropbox === "create" ? plan.project.dropbox.relativePath : null,
      });
      if (lead.estimated_value !== null) {
        const details = getProjectDetails(projectSlug);
        writeProjectDetails(projectSlug, { ...details, fee: lead.estimated_value });
      }
      state.phase = "scaffolded";
      writeCreationState(state);
    }

    let updatedLead = lead;
    try {
      const result = updateLead(slug, {
        ...lead,
        converted_project_slug: projectSlug,
        converted_date: convertedDate,
        status: "won",
      });
      updatedLead = result.lead;
    } catch (cause) {
      const status = cause instanceof LeadWriteError ? cause.status : 500;
      const error = cause instanceof Error
        ? cause.message
        : "Project was created, but the lead could not be linked to it.";
      return NextResponse.json({ error, projectSlug }, { status });
    }

    const { notionSynced, notionError } = await syncLeadToNotion(slug, updatedLead);

    // Carries the lead's accumulated context into the new project's own memory instead of leaving
    // it stranded on a lead record that may later be deleted -- see appendProjectMemoryNote. The
    // Dropbox brief covers the same ground for people working in the folder itself.
    const memoryParts = [
      `Converted from lead "${lead.name}" (received ${lead.date_received}, source: ${lead.source}).`,
    ];
    if (lead.notes?.trim()) memoryParts.push(`Lead notes:\n\n${lead.notes.trim()}`);
    if (lead.contract_notes.trim()) memoryParts.push(`Contract notes:\n\n${lead.contract_notes.trim()}`);
    if (plan.dropbox === "create") {
      memoryParts.push(
        `Lead material copied into ${plan.project.dropbox.relativePath}/ (see ${plan.seed?.handoffFile}).`,
      );
    }
    appendProjectMemoryNote(projectSlug, { title: "Converted from lead", entry: memoryParts.join("\n\n") });

    if (plan.dropbox === "create") mirrorProjectKnowledge(projectSlug);
    state.phase = "complete";
    writeCreationState(state);

    recordAudit({
      command: "lead convert confirmed",
      actor: process.env.USERNAME || process.env.USER || "unknown",
      slug: projectSlug,
      diff: {
        lead_slug: slug,
        workflow: input.workflow,
        notion_page_id: state.notion?.id ?? null,
        dropbox_path: plan.dropbox === "create" ? plan.project.dropbox.relativePath : null,
        folders: plan.dropbox === "create" ? plan.project.dropbox.folders : [],
        seeded_files: seeded.written,
        skipped_files: seeded.skipped,
      },
      applied: true,
    });

    revalidatePath("/leads");
    revalidatePath(`/leads/${slug}`);
    revalidatePath("/projects");
    revalidatePath(`/projects/${projectSlug}`);
    return NextResponse.json({
      confirmed: true,
      projectSlug,
      convertedDate,
      dropboxPath: plan.dropbox === "create" ? plan.project.dropbox.relativePath : null,
      createdFolders: state.createdFolders,
      seededFiles: seeded.written,
      skippedFiles: seeded.skipped,
      notionUrl: state.notion?.url ?? null,
      notionSynced,
      notionError,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Lead conversion failed.";
    const status = cause instanceof ProjectCreationError ? cause.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
