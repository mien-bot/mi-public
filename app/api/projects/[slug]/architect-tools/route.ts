import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import {
  applyProjectArchitectToolOperation,
  getProjectArchitectToolkitWithHash,
  getProjectSlugs,
  previewArchitectToolOperation,
} from "@/lib/content";
import { architectToolOperationSchema } from "@/lib/architectTools";
import { ContentConflictError } from "@/lib/content/atomicContentWrite";
import { recordAudit } from "@/src/audit/log";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!getProjectSlugs().includes(slug)) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  const operation = architectToolOperationSchema.safeParse(body?.operation);
  if (!operation.success) {
    return NextResponse.json(
      { error: operation.error.issues[0]?.message ?? "Invalid architect-tool record." },
      { status: 400 },
    );
  }

  try {
    const current = getProjectArchitectToolkitWithHash(slug);
    if (body?.confirmed !== true) {
      return NextResponse.json({
        saved: false,
        preview: previewArchitectToolOperation(current.toolkit, operation.data),
        expectedHash: current.hash,
      });
    }
    if (body?.expectedHash !== current.hash) {
      return NextResponse.json(
        { error: "Architect Tools changed after preview. Review the latest project data and try again." },
        { status: 409 },
      );
    }
    const result = applyProjectArchitectToolOperation({
      slug,
      operation: operation.data,
      expectedHash: current.hash,
    });
    recordAudit({
      command: "project architect tool record create",
      actor: process.env.USERNAME || process.env.USER || "unknown",
      slug,
      diff: {
        kind: operation.data.kind,
        id: operation.data.value.id,
      },
      applied: true,
    });
    revalidatePath(`/projects/${slug}`);
    revalidatePath(`/projects/${slug}/architect-tools`);
    revalidatePath("/search");
    return NextResponse.json({
      saved: true,
      toolkit: result.toolkit,
      hash: result.hash,
      backupCreated: Boolean(result.write.backupPath),
    });
  } catch (cause) {
    const status = cause instanceof ContentConflictError ? 409 : 400;
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "The record could not be saved." },
      { status },
    );
  }
}
