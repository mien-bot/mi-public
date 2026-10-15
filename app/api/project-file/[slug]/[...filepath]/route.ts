import fs from "node:fs";
import { NextResponse } from "next/server";
import { contentDir } from "@/lib/content/projects";
import { resolveFileWithinDir } from "@/lib/content/fileServing";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; filepath: string[] }> },
) {
  const { slug, filepath } = await params;
  let projectDir: string;
  try {
    projectDir = contentDir(slug);
  } catch {
    return NextResponse.json({ error: "Project not found or its content folder is unavailable" }, { status: 404 });
  }

  const resolved = resolveFileWithinDir(projectDir, filepath);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.message }, { status: resolved.status });
  }

  return new NextResponse(fs.readFileSync(resolved.absolutePath), {
    headers: { "Content-Type": resolved.contentType },
  });
}
