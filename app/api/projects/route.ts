import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { mirrorProjectKnowledge } from "@/lib/content";
import {
  createDropboxStructure,
  createNotionProjectPage,
  preflightProjectCreation,
  ProjectCreationError,
  readCreationState,
  writeCreationState,
  type CreationState,
} from "@/lib/content/projectCreation";
import {
  buildProjectCreationPlan,
  isNotionProjectType,
  isProjectWorkflowProfile,
  parseNotionProjectScopes,
  safeDropboxFolder,
  safeDropboxFolderList,
  safeDropboxRelativePath,
  type ProjectCreationInput,
} from "@/lib/content/projectCreationPlan";
import { scaffoldProject } from "@/lib/content/scaffoldProject";
import { projectStatusSchema } from "@/lib/schema";
import { recordAudit } from "@/src/audit/log";

function parseInput(body: Record<string, unknown> | null): ProjectCreationInput {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const slug = typeof body?.slug === "string" ? body.slug.trim() : "";
  const client = typeof body?.client === "string" ? body.client.trim() : "";
  const location = typeof body?.location === "string" ? body.location.trim() : "";
  const status = projectStatusSchema.safeParse(body?.status);
  const workflow = body?.workflow;
  const requestedProjectType = typeof body?.projectType === "string" ? body.projectType.trim() : "";
  const projectType = requestedProjectType ? requestedProjectType : null;
  const scopes = parseNotionProjectScopes(body?.scopes);
  const dropboxMode = body?.dropboxMode === "link-existing" ? "link-existing" : "create";
  const dropboxFolder = safeDropboxFolder(
    typeof body?.dropboxFolder === "string" && body.dropboxFolder.trim()
      ? body.dropboxFolder
      : name,
  );
  const dropboxPath = dropboxMode === "link-existing"
    ? safeDropboxRelativePath(body?.dropboxPath)
    : null;
  // Present only when the user edited the proposed folder list in the review step;
  // absent (undefined) means "use the chosen profile's default list unchanged".
  const customFolders = body?.folders === undefined ? undefined : safeDropboxFolderList(body.folders);

  if (
    !name
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
    || !status.success
    || !isProjectWorkflowProfile(workflow)
    || (projectType !== null && !isNotionProjectType(projectType))
    || scopes === null
    || (dropboxMode === "create" && !dropboxFolder)
    || (dropboxMode === "link-existing" && !dropboxPath)
    || (body?.folders !== undefined && customFolders === null)
  ) {
    throw new ProjectCreationError(
      "Valid name, slug, status, workflow, confirmed Notion classifications, Dropbox folder, and (if edited) a safe folder list are required.",
      400,
    );
  }

  return {
    name,
    slug,
    client,
    location,
    status: status.data,
    workflow,
    projectType,
    scopes,
    dropboxFolder: dropboxFolder ?? "",
    dropboxMode,
    dropboxPath,
    customFolders,
  };
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;

  try {
    const input = parseInput(body);
    const plan = buildProjectCreationPlan(input);
    const confirmed = body?.confirmed === true;
    const requestId = typeof body?.clientRequestId === "string" ? body.clientRequestId : "";
    const prior = requestId ? readCreationState<typeof plan>(requestId) : null;

    if (!confirmed) {
      preflightProjectCreation(plan, false);
      return NextResponse.json({ confirmed: false, plan });
    }
    if (!requestId) throw new ProjectCreationError("Preview this exact project plan before confirming it.", 409);
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
        slug: plan.project.slug,
        notionUrl: prior.notion?.url,
        dropboxPath: plan.dropbox.relativePath,
      });
    }
    if (prior?.phase === "notion-pending-review") {
      throw new ProjectCreationError(
        "A prior Notion create may have succeeded. Review Studio Projects before retrying so Mi cannot create a duplicate.",
        409,
      );
    }

    const target = preflightProjectCreation(plan, Boolean(prior));
    const state: CreationState<typeof plan> = prior ?? {
      requestId,
      plan,
      phase: "prepared",
      createdFolders: [],
    };
    if (!prior) writeCreationState(state);

    if (state.phase === "prepared") {
      if (plan.dropbox.mode === "create") {
        createDropboxStructure(target, plan.dropbox, state);
      } else {
        // Linking is intentionally read-only. Advancing the durable request state records that
        // the exact previewed existing folder passed validation without writing inside it.
        state.phase = "dropbox-created";
        writeCreationState(state);
      }
    }

    const notion = await createNotionProjectPage(state, {
      name: input.name,
      status: input.status,
      client: input.client,
      location: input.location,
      projectTypes: input.projectType ? [input.projectType] : [],
      scopes: input.scopes,
    });

    scaffoldProject(input.slug, input.name, {
      client: input.client,
      address: input.location,
      status: input.status,
      notionPageId: notion.id,
      dropboxPath: plan.dropbox.relativePath,
      projectType: input.projectType,
      scopeLabels: input.scopes,
    });
    mirrorProjectKnowledge(input.slug);
    state.phase = "complete";
    writeCreationState(state);

    recordAudit({
      command: "project create confirmed",
      actor: process.env.USERNAME || process.env.USER || "unknown",
      slug: input.slug,
      diff: {
        workflow: input.workflow,
        notion_page_id: notion.id,
        project_type: input.projectType,
        scope: input.scopes,
        dropbox_path: plan.dropbox.relativePath,
        folders: plan.dropbox.folders,
      },
      applied: true,
    });
    revalidatePath("/projects");
    return NextResponse.json({
      confirmed: true,
      slug: input.slug,
      notionUrl: notion.url,
      dropboxPath: plan.dropbox.relativePath,
      createdFolders: state.createdFolders,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Project creation failed.";
    const status = cause instanceof ProjectCreationError ? cause.status : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
