import fs from "node:fs";
import { NextResponse } from "next/server";
import { resolveLocalCodeLibraryFile } from "@/lib/content/localCodeLibrary";

export const runtime = "nodejs";

function contentDisposition(fileName: string): string {
  const asciiName = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ filepath: string[] }> },
) {
  const { filepath } = await params;
  const resolved = resolveLocalCodeLibraryFile(filepath);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.message }, { status: resolved.status });
  }

  return new NextResponse(
    fs.readFileSync(/* turbopackIgnore: true */ resolved.absolutePath),
    {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": contentDisposition(resolved.fileName),
        "Content-Type": resolved.contentType,
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
