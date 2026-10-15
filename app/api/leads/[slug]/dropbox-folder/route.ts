import { NextResponse } from "next/server";
import { getLead, getLeadSlugs } from "@/lib/content";
import { applyLeadDropboxFolder, previewLeadDropboxFolder } from "@/lib/content/leadDropboxFolder";
import { DROPBOX_ROOT } from "@/lib/content/paths";

/**
 * Creates the standard folder structure for an already-linked lead. This is the recovery path
 * for an older Mi lead whose confirmed folder has not been created yet; it uses the same plan
 * and confirmation boundary as new-lead creation.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getLeadSlugs().includes(slug)) {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  }

  const { lead } = getLead(slug);
  if (!lead.dropbox_path) {
    return NextResponse.json(
      { error: "This lead has no Dropbox folder set yet — add one in the Edit lead form and save first." },
      { status: 400 },
    );
  }
  if (!DROPBOX_ROOT) {
    return NextResponse.json(
      { error: "Choose the local Dropbox root in Settings first." },
      { status: 400 },
    );
  }
  const body = await request.json().catch(() => null);
  if (body?.confirmed !== true) {
    return NextResponse.json({ error: "Explicit confirmation is required." }, { status: 409 });
  }

  try {
    const plan = previewLeadDropboxFolder(
      DROPBOX_ROOT,
      lead.dropbox_path,
      "create",
      { allowExistingRoot: true },
    );
    const result = applyLeadDropboxFolder(DROPBOX_ROOT, plan, true);
    return NextResponse.json({ created: true, path: plan.relativePath, createdFolders: result.createdFolders });
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Invalid Dropbox folder path." },
      { status: 400 },
    );
  }
}
