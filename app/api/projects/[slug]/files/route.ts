import fs from "node:fs";
import { NextResponse } from "next/server";
import { guardedPath, projectDiscoveryRoots } from "@/lib/content/projectDiscovery";
import { resolveFileWithinDir } from "@/lib/content/fileServing";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const roots = projectDiscoveryRoots(slug);
    const query = new URL(request.url).searchParams;
    const source = query.get("source");
    const root = source === "dropbox" ? roots.sharedRoot : source === "local" ? roots.localRoot : null;
    const relative = query.get("path") || "";
    if (!root || !/\.(pdf|docx?|xlsx?|pptx?|rtf|txt|csv|dwg|dxf|rvt|ifc|jpg|jpeg|png|webp|tiff?)$/i.test(relative)) throw new Error("File not available.");
    guardedPath(root, relative);
    const resolved = resolveFileWithinDir(root, relative.split("/"));
    if (!resolved.ok) return NextResponse.json({ error: resolved.message }, { status: resolved.status });
    if (fs.statSync(resolved.absolutePath).size > 64 * 1024 * 1024) throw new Error("Open files larger than 64 MB from the project folder.");
    return new NextResponse(await fs.promises.readFile(resolved.absolutePath), { headers: {
      "Content-Type": resolved.contentType, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store",
      "Content-Disposition": `${resolved.contentType === "application/pdf" || resolved.contentType.startsWith("image/") ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(relative.split("/").at(-1)!)}`,
    } });
  } catch { return NextResponse.json({ error: "File unavailable. Check that it is downloaded locally and refresh the project file list." }, { status: 404 }); }
}
