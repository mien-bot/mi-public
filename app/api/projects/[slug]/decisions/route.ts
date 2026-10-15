import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import {
  createProjectDecision,
  getProjectSlugs,
  mirrorProjectKnowledge,
} from "@/lib/content";
import { projectDecisionSchema } from "@/lib/schema";
import { recordAudit } from "@/src/audit/log";

function refreshDecisionViews(slug: string) {
  revalidatePath(`/projects/${slug}`);
  revalidatePath(`/projects/${slug}/decisions`);
  revalidatePath("/search");
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!getProjectSlugs().includes(slug)) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  const recordedAt = new Date().toISOString();
  const parsed = projectDecisionSchema.safeParse({
    ...body?.decision,
    recorded_at: body?.confirmed === true
      ? recordedAt
      : body?.decision?.recorded_at ?? recordedAt,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid decision record." },
      { status: 400 },
    );
  }
  if (body?.confirmed !== true) {
    return NextResponse.json({ preview: parsed.data, saved: false });
  }

  try {
    const document = createProjectDecision(slug, parsed.data);
    let mirror: ReturnType<typeof mirrorProjectKnowledge> | { mirrored: false; error: string };
    try {
      mirror = mirrorProjectKnowledge(slug);
    } catch (cause) {
      mirror = {
        mirrored: false,
        error: cause instanceof Error ? cause.message : "Dropbox Mi mirror failed.",
      };
    }
    recordAudit({
      command: "project decision create",
      actor: process.env.USERNAME || process.env.USER || "unknown",
      slug,
      diff: {
        id: document.decision.id,
        status: document.decision.status,
        decision_date: document.decision.decision_date,
        source_count: document.decision.sources.length,
      },
      applied: true,
    });
    refreshDecisionViews(slug);
    return NextResponse.json({ saved: true, document, mirror });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "The decision could not be saved.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
