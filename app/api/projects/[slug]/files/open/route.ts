import { NextResponse } from "next/server";
import { guardedPath, projectDiscoveryRoots } from "@/lib/content/projectDiscovery";
import { resolveFileWithinDir } from "@/lib/content/fileServing";

/**
 * Where a catalogued file lives on this computer, for the desktop app to open in its default
 * application. Remote access never reaches this route (see lib/remoteAccess/policy.ts).
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const roots = projectDiscoveryRoots(slug);
    const query = new URL(request.url).searchParams;
    const source = query.get("source");
    const root = source === "dropbox" ? roots.sharedRoot : source === "local" ? roots.localRoot : null;
    const relative = query.get("path") || "";
    if (!root || !relative) throw new Error("File not available.");
    guardedPath(root, relative);
    const resolved = resolveFileWithinDir(root, relative.split("/"));
    if (!resolved.ok) return NextResponse.json({ error: resolved.message }, { status: resolved.status });
    return NextResponse.json({ absolutePath: resolved.absolutePath });
  } catch {
    return NextResponse.json({ error: "File unavailable. Check that it is downloaded locally and refresh the project file list." }, { status: 404 });
  }
}
