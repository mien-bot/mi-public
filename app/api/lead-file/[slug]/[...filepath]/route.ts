import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { leadDir } from "@/lib/content/leads";
import { resolveFileWithinDir } from "@/lib/content/fileServing";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; filepath: string[] }> },
) {
  const { slug, filepath } = await params;
  const targetDir = path.join(leadDir(slug));

  const resolved = resolveFileWithinDir(targetDir, filepath);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.message }, { status: resolved.status });
  }

  return new NextResponse(fs.readFileSync(resolved.absolutePath), {
    headers: { "Content-Type": resolved.contentType },
  });
}
