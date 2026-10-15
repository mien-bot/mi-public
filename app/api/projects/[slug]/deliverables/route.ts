import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import {
  createProjectDeliverable,
  deleteProjectDeliverable,
  getProjectDeliverablesWithHash,
  getProjectSlugs,
  updateProjectDeliverable,
} from "@/lib/content";
import { projectDeliverableSchema } from "@/lib/schema";
import { recordAudit } from "@/src/audit/log";

function refreshDeliverableViews(slug: string) {
  revalidatePath(`/projects/${slug}`);
  revalidatePath(`/projects/${slug}/deliverables`);
  revalidatePath("/search");
}

function auditDiff(slug: string, action: string, deliverable: { id: string; kind: string; status: string; issued_date: string | null }) {
  recordAudit({
    command: `project deliverable ${action}`,
    actor: process.env.USERNAME || process.env.USER || "unknown",
    slug,
    diff: {
      id: deliverable.id,
      kind: deliverable.kind,
      status: deliverable.status,
      issued_date: deliverable.issued_date,
    },
    applied: true,
  });
}

/**
 * Both verbs take the same shape: an unconfirmed request returns the parsed preview and writes
 * nothing, matching the site-report route. `expectedHash` is the register's hash as the client
 * read it -- the whole register is one file, so an edit to a different deliverable still has to
 * lose rather than silently overwrite.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!getProjectSlugs().includes(slug)) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  const parsed = projectDeliverableSchema.safeParse(body?.deliverable);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid deliverable." },
      { status: 400 },
    );
  }
  if (body?.confirmed !== true) {
    return NextResponse.json({ preview: parsed.data, saved: false });
  }

  try {
    const deliverable = createProjectDeliverable(slug, parsed.data, body?.expectedHash ?? null);
    auditDiff(slug, "create", deliverable);
    refreshDeliverableViews(slug);
    return NextResponse.json({
      saved: true,
      deliverable,
      hash: getProjectDeliverablesWithHash(slug).hash,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "The deliverable could not be saved.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!getProjectSlugs().includes(slug)) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  const parsed = projectDeliverableSchema.safeParse(body?.deliverable);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid deliverable." },
      { status: 400 },
    );
  }
  if (typeof body?.id !== "string") {
    return NextResponse.json({ error: "Name the deliverable being updated." }, { status: 400 });
  }
  if (body?.confirmed !== true) {
    return NextResponse.json({ preview: parsed.data, saved: false });
  }

  try {
    const deliverable = updateProjectDeliverable(
      slug,
      body.id,
      parsed.data,
      body?.expectedHash ?? null,
    );
    auditDiff(slug, "update", deliverable);
    refreshDeliverableViews(slug);
    return NextResponse.json({
      saved: true,
      deliverable,
      hash: getProjectDeliverablesWithHash(slug).hash,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "The deliverable could not be saved.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}

/**
 * Removes a deliverable from the register. The register is one YAML array, so the guard
 * that matters is the file hash: without it a page loaded before someone else added a row
 * would silently drop that row along with the one being deleted.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!getProjectSlugs().includes(slug)) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  if (body?.confirmed !== true) {
    return NextResponse.json({ error: "Explicit confirmation is required." }, { status: 409 });
  }
  if (typeof body?.id !== "string" || body.id.length === 0) {
    return NextResponse.json({ error: "Name the deliverable being deleted." }, { status: 400 });
  }

  try {
    const deliverable = deleteProjectDeliverable(slug, body.id, body?.expectedHash ?? null);
    auditDiff(slug, "delete", deliverable);
    refreshDeliverableViews(slug);
    return NextResponse.json({
      deleted: true,
      deliverable,
      hash: getProjectDeliverablesWithHash(slug).hash,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "The deliverable could not be deleted.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
