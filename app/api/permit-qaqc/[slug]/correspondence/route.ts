import { NextResponse } from "next/server";
import { getPermitQaqcDropboxDir, getPermitQaqcEngagement, getPermitQaqcSlugs, listDropboxTree } from "@/lib/content";
import { listPermitQaqcCorrespondence } from "@/lib/permitQaqcEmail/listCorrespondence";

/**
 * Read-only: parses every .eml file found anywhere in the engagement's real, linked
 * Dropbox folder on the fly. Nothing is persisted locally -- Dropbox stays the source
 * of truth for the emails themselves, matching how every other Dropbox read in Mi works.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getPermitQaqcSlugs().includes(slug)) {
    return NextResponse.json({ error: "Permit QAQC engagement not found." }, { status: 404 });
  }

  const { engagement } = getPermitQaqcEngagement(slug);
  const dropboxDir = getPermitQaqcDropboxDir(engagement);
  if (!dropboxDir) {
    return NextResponse.json({ emails: [], errors: [], linked: false });
  }

  const { emails, errors } = await listPermitQaqcCorrespondence(dropboxDir, listDropboxTree(dropboxDir));
  return NextResponse.json({ emails, errors, linked: true });
}
