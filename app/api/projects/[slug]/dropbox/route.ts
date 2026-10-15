import fs from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { getProjectSlugs, normalizeDropboxRelativePath, resolveDropboxRelativePath } from "@/lib/content";
import { DROPBOX_ROOT, PROJECTS_DIR } from "@/lib/content/paths";
import { patchScalarField } from "@/src/adapters/repo/patchYamlField";

function preview(relativePath: unknown) {
  if (typeof relativePath !== "string" || !DROPBOX_ROOT) throw new Error("DROPBOX_ROOT and a relative path are required.");
  const normalized = normalizeDropboxRelativePath(DROPBOX_ROOT, relativePath);
  const absolute = resolveDropboxRelativePath(DROPBOX_ROOT, normalized);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) {
    throw new Error("The selected Dropbox folder does not exist on this machine.");
  }
  return normalized;
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getProjectSlugs().includes(slug)) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  const body = await request.json().catch(() => null);
  try {
    return NextResponse.json({ proposed_path: preview(body?.relativePath), changed: false });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Invalid Dropbox path." }, { status: 400 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getProjectSlugs().includes(slug)) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  const body = await request.json().catch(() => null);
  if (body?.confirmed !== true) return NextResponse.json({ error: "Explicit confirmation is required." }, { status: 409 });
  try {
    const normalized = preview(body?.relativePath);
    patchScalarField(path.join(PROJECTS_DIR, slug, "project.yaml"), "dropbox_path", JSON.stringify(normalized));
    revalidatePath(`/projects/${slug}`);
    revalidatePath(`/projects/${slug}/files`);
    return NextResponse.json({ changed: true, dropbox_path: normalized });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Invalid Dropbox path." }, { status: 400 });
  }
}
