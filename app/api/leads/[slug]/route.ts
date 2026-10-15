import path from "node:path";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { ContentConflictError, readCurrentHash } from "@/lib/content/atomicContentWrite";
import { leadDir } from "@/lib/content/leads";
import { syncLeadToNotion } from "@/lib/content/leadNotionSync";
import { deleteLead, LeadWriteError, updateLead } from "@/lib/content/leadMutations";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const body = await request.json().catch(() => null);
  const expectedHash: string | null | undefined = body?.expectedHash;
  try {
    const result = updateLead(slug, body?.lead, expectedHash === undefined ? {} : { expectedHash });
    revalidatePath("/leads");
    revalidatePath(`/leads/${result.slug}`);
    revalidatePath("/search");
    for (const projectSlug of new Set([
      result.previousConvertedProjectSlug,
      result.lead.converted_project_slug,
    ])) {
      if (projectSlug) revalidatePath(`/projects/${projectSlug}`);
    }

    // The Leads database is a deliberate full mirror of leadSchema, so every save pushes the
    // whole record rather than a per-field diff -- see syncLeadToNotion for the create-vs-update
    // gate details.
    const { notionSynced, notionUrl, notionError } = await syncLeadToNotion(result.slug, result.lead);

    const hash = readCurrentHash(path.join(leadDir(result.slug), "lead.yaml"));
    return NextResponse.json({ saved: true, slug: result.slug, hash, notionSynced, notionUrl, notionError });
  } catch (cause) {
    if (cause instanceof ContentConflictError) {
      return NextResponse.json({ error: "conflict", currentHash: cause.currentHash }, { status: 409 });
    }
    const status = cause instanceof LeadWriteError ? cause.status : 500;
    const error = cause instanceof Error ? cause.message : "Lead could not be updated.";
    return NextResponse.json({ error }, { status });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const body = await request.json().catch(() => null);
  try {
    const result = deleteLead(slug, {
      confirmed: body?.confirmed,
      expectedName: body?.expectedName,
    });
    revalidatePath("/leads");
    revalidatePath(`/leads/${result.slug}`);
    revalidatePath("/search");
    if (result.previousConvertedProjectSlug) {
      revalidatePath(`/projects/${result.previousConvertedProjectSlug}`);
    }
    return NextResponse.json({ deleted: true, slug: result.slug, recoverableBackup: true });
  } catch (cause) {
    const status = cause instanceof LeadWriteError ? cause.status : 500;
    const error = cause instanceof Error ? cause.message : "Lead could not be deleted.";
    return NextResponse.json({ error }, { status });
  }
}
