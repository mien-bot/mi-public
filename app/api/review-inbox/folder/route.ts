import { NextResponse } from "next/server";
import { getLeadSlugs, getPermitQaqcSlugs, getProjectSlugs } from "@/lib/content";
import { createReviewFolder, workspaceDropboxPath } from "@/lib/content/reviewFolderTarget";
import { workspaceKindSchema } from "@/lib/content/workspaceOutbox";

// Creates one folder a reviewer named, for a review batch's "Choose folder…" destination.
// The location comes from the workspace's confirmed dropbox_path, never from the request.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const kind = workspaceKindSchema.safeParse(body?.kind);
  const slug = typeof body?.slug === "string" ? body.slug : "";
  if (!kind.success || !slug) return NextResponse.json({ error: "Choose a workspace first." }, { status: 400 });
  const slugs = kind.data === "project" ? getProjectSlugs() : kind.data === "lead" ? getLeadSlugs() : getPermitQaqcSlugs();
  if (!slugs.includes(slug)) return NextResponse.json({ error: "This workspace no longer exists. Refresh the inbox." }, { status: 404 });
  const folderRoot = workspaceDropboxPath(kind.data, slug);
  if (!folderRoot) return NextResponse.json({ error: "This workspace has no confirmed Dropbox folder." }, { status: 400 });
  try {
    const parent = typeof body.parent === "string" && body.parent.trim() ? body.parent.trim() : ".";
    return NextResponse.json(createReviewFolder(folderRoot, parent, typeof body.name === "string" ? body.name : ""));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The folder could not be created." }, { status: 400 });
  }
}
