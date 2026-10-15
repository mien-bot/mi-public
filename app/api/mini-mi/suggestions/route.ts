import { NextResponse } from "next/server";
import { getProject, getSchedule } from "@/lib/content/projects";
import { milestoneSuggestions, type CompanionSuggestion } from "@/lib/miniMi/suggestions";
export const dynamic = "force-dynamic";

/** Read-only saved records. No discovery, synchronization, automation, or external writes. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const slug = params.get("project") ?? "";
  const today = params.get("today") ?? "";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !/^\d{4}-\d{2}-\d{2}$/.test(today) || Number.isNaN(Date.parse(`${today}T12:00:00Z`)) || new Date(`${today}T12:00:00Z`).toISOString().slice(0,10) !== today) {
    return NextResponse.json({ error: "Invalid project or date." }, { status: 400 });
  }
  try {
    const { meta } = getProject(slug);
    const items: CompanionSuggestion[] = [];
    if (!meta.dropbox_path) items.push({ id: `folder:${slug}`, title: "Review the project folder link",
      detail: "This project has no confirmed Dropbox folder. Link one when shared files are needed.", href: `/projects/${slug}/files` });
    let unavailable = false;
    try { items.push(...milestoneSuggestions(slug, getSchedule(slug).milestones, today)); }
    catch { unavailable = true; }
    return NextResponse.json({ items, checkedAt: Date.now(), warning: unavailable ? "The saved schedule could not be read. Check the project's files and connection." : null });
  } catch { return NextResponse.json({ error: "Project suggestions are unavailable. Reopen the project and try again." }, { status: 404 }); }
}
