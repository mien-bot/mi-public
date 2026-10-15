import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { getLastSiteVisitDate, getSiteVisits } from "@/lib/content/leads";
import { createLead, updateLead, LeadWriteError } from "@/lib/content/leadMutations";
import {
  applyLeadDropboxFolder,
  previewLeadDropboxFolder,
  type LeadDropboxAction,
  type LeadDropboxPlan,
} from "@/lib/content/leadDropboxFolder";
import { DROPBOX_ROOT } from "@/lib/content/paths";
import { createNotionLead } from "@/src/adapters/notion/leads";
import { isWriteAllowed } from "@/src/policies/approvals";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  try {
    let leadInput = body?.lead;
    let dropboxPlan: LeadDropboxPlan | null = null;
    const requestedPath = typeof leadInput?.dropbox_path === "string" && leadInput.dropbox_path.trim()
      ? leadInput.dropbox_path
      : null;
    if (requestedPath) {
      const action: LeadDropboxAction | null = body?.dropboxAction === "create" || body?.dropboxAction === "link-existing"
        ? body.dropboxAction
        : null;
      if (!action || body?.dropboxConfirmed !== true) {
        throw new LeadWriteError("Review and explicitly confirm whether to create or link the Dropbox folder.");
      }
      if (!DROPBOX_ROOT) throw new LeadWriteError("Choose the local Dropbox root in Settings first.");
      try {
        dropboxPlan = previewLeadDropboxFolder(DROPBOX_ROOT, requestedPath, action);
      } catch (cause) {
        throw new LeadWriteError(cause instanceof Error ? cause.message : "Invalid Dropbox folder choice.");
      }
      leadInput = { ...leadInput, dropbox_path: dropboxPlan.relativePath };
    }

    const result = createLead(body?.slug, leadInput);
    let dropboxCreated = false;
    let dropboxError: string | null = null;
    if (dropboxPlan?.action === "create" && DROPBOX_ROOT) {
      try {
        applyLeadDropboxFolder(DROPBOX_ROOT, dropboxPlan, true);
        dropboxCreated = true;
      } catch (cause) {
        // The Mi record is already durable. Report this as a separate result so a retry cannot
        // collide with the lead slug while hiding that only Dropbox setup was partial.
        dropboxError = cause instanceof Error ? cause.message : "Dropbox folder creation failed.";
      }
    }
    revalidatePath("/leads");
    revalidatePath(`/leads/${result.slug}`);
    revalidatePath("/search");
    if (result.lead.converted_project_slug) {
      revalidatePath(`/projects/${result.lead.converted_project_slug}`);
    }

    let notionSynced = false;
    let notionUrl: string | null = null;
    let notionError: string | null = null;
    if (isWriteAllowed("lead", "create")) {
      try {
        const page = await createNotionLead(result.lead, getLastSiteVisitDate(result.slug), getSiteVisits(result.slug));
        updateLead(result.slug, { ...result.lead, notion_page_id: page.id });
        notionSynced = true;
        notionUrl = page.url;
      } catch (cause) {
        notionError = cause instanceof Error ? cause.message : "Notion sync failed.";
      }
    }

    return NextResponse.json(
      {
        saved: true,
        slug: result.slug,
        notionSynced,
        notionUrl,
        notionError,
        dropboxAction: dropboxPlan?.action ?? null,
        dropboxCreated,
        dropboxError,
      },
      { status: 201 },
    );
  } catch (cause) {
    const status = cause instanceof LeadWriteError ? cause.status : 500;
    const error = cause instanceof Error ? cause.message : "Lead could not be created.";
    return NextResponse.json({ error }, { status });
  }
}
