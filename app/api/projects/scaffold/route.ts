import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getProjectSlugs } from "@/lib/content";
import { REPO_ROOT } from "@/lib/content/paths";
import { scaffoldProject } from "@/lib/content/scaffoldProject";
import { slugifyProjectName, type ProjectMap } from "@/lib/notion/projectMap";

/**
 * Auto-scaffolds a local projects/<slug>/ folder for a Notion project the
 * chat picker selected that doesn't have one yet. The notionPageId here is
 * trusted, not guessed — it comes straight from a Notion project the user
 * explicitly picked, so setting it immediately doesn't violate this repo's
 * usual "never guess notion_page_id" rule (see lib/schema.ts).
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const notionPageId = typeof body?.notionPageId === "string" ? body.notionPageId.trim() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";

  if (!notionPageId || !name) {
    return NextResponse.json({ error: "notionPageId and name are required." }, { status: 400 });
  }

  const existingSlugs = new Set(getProjectSlugs());
  const baseSlug = slugifyProjectName(name, notionPageId);
  let slug = baseSlug;
  let suffix = 2;
  while (existingSlugs.has(slug)) {
    slug = `${baseSlug}-${suffix}`;
    suffix++;
  }

  // Best-effort pre-fill from the committed Notion snapshot — the scaffold
  // still succeeds with defaults even if this lookup comes up empty.
  let client: string | null = null;
  let status: "not-started" | "in-progress" | "complete" | "abandoned" | null = null;
  try {
    const mapPath = path.join(REPO_ROOT, "notion", "project-map.json");
    const map = JSON.parse(fs.readFileSync(mapPath, "utf-8")) as ProjectMap;
    const entry = map.projects.find((p) => p.notion_page_id === notionPageId);
    if (entry) {
      client = entry.client;
      status = entry.status === "unknown" ? null : entry.status;
    }
  } catch {
    // notion/project-map.json missing or unreadable — scaffold with defaults.
  }

  try {
    scaffoldProject(slug, name, { client, status, notionPageId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to scaffold project." },
      { status: 500 },
    );
  }

  return NextResponse.json({ slug });
}
