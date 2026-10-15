import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { getProjectSlugs, writeProjectDetails } from "@/lib/content";
import { projectDetailsPath } from "@/lib/content/projectWorkspace";
import { ContentConflictError, readCurrentHash } from "@/lib/content/atomicContentWrite";
import { projectDetailsSchema } from "@/lib/schema";
import { recordAudit } from "@/src/audit/log";

export async function PUT(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getProjectSlugs().includes(slug)) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  const body = await request.json().catch(() => null);
  if (body?.confirmed !== true) {
    return NextResponse.json({ error: "Explicit confirmation is required." }, { status: 409 });
  }
  const parsed = projectDetailsSchema.safeParse(body.details);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid project details." }, { status: 400 });
  }
  if (!("expectedHash" in body) || (body.expectedHash !== null && typeof body.expectedHash !== "string")) {
    return NextResponse.json({ error: "Reload this project before saving so Mi can verify no one else changed it." }, { status: 409 });
  }
  const expectedHash: string | null = body.expectedHash;
  try {
    writeProjectDetails(slug, parsed.data, { expectedHash });
  } catch (cause) {
    if (cause instanceof ContentConflictError) {
      return NextResponse.json({ error: "conflict", currentHash: cause.currentHash }, { status: 409 });
    }
    throw cause;
  }
  recordAudit({
    command: "project details save",
    actor: process.env.USERNAME || process.env.USER || "unknown",
    slug,
    diff: parsed.data,
    applied: true,
  });
  revalidatePath(`/projects/${slug}`);
  revalidatePath(`/projects/${slug}/details`);
  return NextResponse.json({ saved: true, hash: readCurrentHash(projectDetailsPath(slug)) });
}
