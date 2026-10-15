import fs from "node:fs";
import { NextResponse } from "next/server";
import { getPermitQaqcDropboxDir, getPermitQaqcEngagement } from "@/lib/content";
import { resolveFileWithinDir } from "@/lib/content/fileServing";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; filepath: string[] }> },
) {
  const { slug, filepath } = await params;

  let dropboxDir: string | null;
  try {
    dropboxDir = getPermitQaqcDropboxDir(getPermitQaqcEngagement(slug).engagement);
  } catch {
    return NextResponse.json({ error: "Permit QAQC engagement not found" }, { status: 404 });
  }

  if (!dropboxDir) {
    return NextResponse.json({ error: "No Dropbox folder linked for this engagement" }, { status: 404 });
  }

  const resolved = resolveFileWithinDir(dropboxDir, filepath);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.message }, { status: resolved.status });
  }

  return new NextResponse(fs.readFileSync(resolved.absolutePath), {
    headers: { "Content-Type": resolved.contentType },
  });
}
