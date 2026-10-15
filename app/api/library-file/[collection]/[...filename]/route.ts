import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { LIBRARY_DIR } from "@/lib/content/paths";
import { resolveFileWithinDir } from "@/lib/content/fileServing";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ collection: string; filename: string[] }> },
) {
  const { collection, filename } = await params;
  const collectionDir = path.join(LIBRARY_DIR, collection);

  const resolved = resolveFileWithinDir(collectionDir, filename);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.message }, { status: resolved.status });
  }

  return new NextResponse(fs.readFileSync(resolved.absolutePath), {
    headers: { "Content-Type": resolved.contentType },
  });
}
