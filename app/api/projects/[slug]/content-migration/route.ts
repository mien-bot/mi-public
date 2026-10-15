import path from "node:path";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { getProject, getProjectSlugs } from "@/lib/content";
import { DROPBOX_ROOT, PROJECTS_DIR } from "@/lib/content/paths";
import { applyMigration, markSourceMigrated, previewMigration } from "@/lib/content/contentMigration";
import { patchScalarField } from "@/src/adapters/repo/patchYamlField";
import { recordAudit } from "@/src/audit/log";

function loadProject(slug: string) {
  if (!getProjectSlugs().includes(slug)) throw new Error("Project not found.");
  return getProject(slug);
}

/** Always the per-user local content root -- migration only ever runs local -> Dropbox. */
function sourceDir(slug: string): string {
  return path.join(PROJECTS_DIR, slug);
}

function destDir(slug: string, dropboxPath: string): string {
  return path.join(DROPBOX_ROOT as string, dropboxPath, "Mi", "project");
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const project = loadProject(slug);
    if (project.meta.content_location === "dropbox") {
      return NextResponse.json({ error: "This project's data has already migrated to Dropbox." }, { status: 409 });
    }
    if (!DROPBOX_ROOT || !project.meta.dropbox_path) {
      return NextResponse.json({ error: "Link this project to a Dropbox folder before migrating its data." }, { status: 409 });
    }
    const preview = previewMigration(sourceDir(slug), destDir(slug, project.meta.dropbox_path));
    return NextResponse.json({ preview });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Migration preview failed.";
    return NextResponse.json({ error: message }, { status: message === "Project not found." ? 404 : 400 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = await request.json().catch(() => null);
  if (body?.confirmed !== true) {
    return NextResponse.json({ error: "Explicit confirmation is required." }, { status: 409 });
  }
  try {
    const project = loadProject(slug);
    if (project.meta.content_location === "dropbox") {
      return NextResponse.json({ error: "This project's data has already migrated to Dropbox." }, { status: 409 });
    }
    if (!DROPBOX_ROOT || !project.meta.dropbox_path) {
      return NextResponse.json({ error: "Link this project to a Dropbox folder before migrating its data." }, { status: 409 });
    }
    const source = sourceDir(slug);
    const dest = destDir(slug, project.meta.dropbox_path);
    const preview = previewMigration(source, dest);
    const results = applyMigration(preview, {
      confirmed: true,
      includeRelativePaths: Array.isArray(body?.includeRelativePaths) ? body.includeRelativePaths : [],
    });

    const unresolved = results.filter((result) => result.status === "failed" || (result.status === "skipped" && result.error));
    const migrationComplete = unresolved.length === 0;

    if (migrationComplete) {
      const migratedAt = new Date().toISOString();
      patchScalarField(path.join(PROJECTS_DIR, slug, "project.yaml"), "content_location", "dropbox");
      patchScalarField(path.join(PROJECTS_DIR, slug, "project.yaml"), "content_migrated_at", JSON.stringify(migratedAt));
      markSourceMigrated(source, migratedAt);
      recordAudit({
        command: "project content migration",
        actor: process.env.USERNAME || process.env.USER || "unknown",
        slug,
        diff: results,
        applied: true,
      });
      revalidatePath(`/projects/${slug}`);
      revalidatePath(`/projects/${slug}/dropbox`);
    }

    return NextResponse.json({ migrationComplete, results });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Migration failed.";
    return NextResponse.json({ error: message }, { status: message === "Project not found." ? 404 : 400 });
  }
}
