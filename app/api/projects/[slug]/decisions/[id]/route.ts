import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import {
  DecisionSupersessionPartialError,
  deleteProjectDecision,
  getProjectSlugs,
  mirrorProjectKnowledge,
  supersedeProjectDecision,
  updateProjectDecision,
} from "@/lib/content";
import { ContentConflictError } from "@/lib/content/atomicContentWrite";
import { projectDecisionIdSchema, projectDecisionSchema } from "@/lib/schema";
import { recordAudit } from "@/src/audit/log";

function refreshDecisionViews(slug: string) {
  revalidatePath(`/projects/${slug}`);
  revalidatePath(`/projects/${slug}/decisions`);
  revalidatePath("/search");
}

function audit(slug: string, command: string, decision: {
  id: string;
  status: string;
  decision_date: string;
  sources: unknown[];
}, applied = true) {
  recordAudit({
    command,
    actor: process.env.USERNAME || process.env.USER || "unknown",
    slug,
    diff: {
      id: decision.id,
      status: decision.status,
      decision_date: decision.decision_date,
      source_count: decision.sources.length,
    },
    applied,
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id: rawId } = await params;
  if (!getProjectSlugs().includes(slug)) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  const idResult = projectDecisionIdSchema.safeParse(rawId);
  if (!idResult.success) {
    return NextResponse.json({ error: "Invalid decision id." }, { status: 400 });
  }
  const body = await request.json().catch(() => null);
  if (body?.confirmed !== true) {
    return NextResponse.json({ error: "Explicit confirmation is required." }, { status: 409 });
  }
  if (typeof body?.expectedHash !== "string" || body.expectedHash.length === 0) {
    return NextResponse.json({ error: "The current record hash is required." }, { status: 400 });
  }

  try {
    let response: unknown;
    if (body.operation === "supersede") {
      const replacement = projectDecisionSchema.safeParse({
        ...body.replacement,
        recorded_at: new Date().toISOString(),
      });
      if (!replacement.success) {
        return NextResponse.json(
          { error: replacement.error.issues[0]?.message ?? "Invalid replacement decision." },
          { status: 400 },
        );
      }
      const result = supersedeProjectDecision({
        slug,
        originalId: idResult.data,
        originalExpectedHash: body.expectedHash,
        replacement: replacement.data,
      });
      audit(slug, "project decision supersede original", result.original.decision);
      audit(slug, "project decision create replacement", result.replacement.decision);
      response = result;
    } else if (body.operation === "update") {
      const parsed = projectDecisionSchema.safeParse(body.decision);
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues[0]?.message ?? "Invalid decision record." },
          { status: 400 },
        );
      }
      const document = updateProjectDecision(
        slug,
        idResult.data,
        parsed.data,
        body.expectedHash,
      );
      audit(slug, "project decision update", document.decision);
      response = { document };
    } else {
      return NextResponse.json({ error: "Choose update or supersede." }, { status: 400 });
    }

    let mirror: ReturnType<typeof mirrorProjectKnowledge> | { mirrored: false; error: string };
    try {
      mirror = mirrorProjectKnowledge(slug);
    } catch (cause) {
      mirror = {
        mirrored: false,
        error: cause instanceof Error ? cause.message : "Dropbox Mi mirror failed.",
      };
    }
    refreshDecisionViews(slug);
    return NextResponse.json({ saved: true, result: response, mirror });
  } catch (cause) {
    if (cause instanceof ContentConflictError) {
      return NextResponse.json(
        { error: "conflict", currentHash: cause.currentHash },
        { status: 409 },
      );
    }
    if (cause instanceof DecisionSupersessionPartialError) {
      audit(
        slug,
        "project decision supersession partial",
        cause.replacement.decision,
        false,
      );
      refreshDecisionViews(slug);
      return NextResponse.json(
        {
          error: cause.message,
          partial: true,
          replacement: cause.replacement,
        },
        { status: 409 },
      );
    }
    const message = cause instanceof Error ? cause.message : "The decision could not be updated.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}

/**
 * Removes a decision record entirely.
 *
 * Superseding stays the right move for a decision that was really made and then changed;
 * this is for records that should never have existed — a mistaken promotion from meeting
 * notes, a duplicate, a line that turned out not to be a decision. Without it those could
 * only be papered over with a superseding record, which leaves permanent noise pretending
 * to be project history.
 *
 * Same guards as every other mutation here: explicit confirmation, and the record's hash so
 * a stale page cannot destroy someone else's edit. The content layer copies the file into
 * `.mi-backups/` before removing it, so this is recoverable from disk.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id: rawId } = await params;
  if (!getProjectSlugs().includes(slug)) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  const idResult = projectDecisionIdSchema.safeParse(rawId);
  if (!idResult.success) {
    return NextResponse.json({ error: "Invalid decision id." }, { status: 400 });
  }
  const body = await request.json().catch(() => null);
  if (body?.confirmed !== true) {
    return NextResponse.json({ error: "Explicit confirmation is required." }, { status: 409 });
  }
  if (typeof body?.expectedHash !== "string" || body.expectedHash.length === 0) {
    return NextResponse.json({ error: "The current record hash is required." }, { status: 400 });
  }

  try {
    const { decision, backupPath } = deleteProjectDecision(slug, idResult.data, body.expectedHash);
    audit(slug, "project decision delete", decision);

    let mirror: ReturnType<typeof mirrorProjectKnowledge> | { mirrored: false; error: string };
    try {
      mirror = mirrorProjectKnowledge(slug);
    } catch (cause) {
      mirror = {
        mirrored: false,
        error: cause instanceof Error ? cause.message : "Dropbox Mi mirror failed.",
      };
    }
    refreshDecisionViews(slug);
    return NextResponse.json({ deleted: true, id: decision.id, backupPath, mirror });
  } catch (cause) {
    if (cause instanceof ContentConflictError) {
      return NextResponse.json(
        { error: "conflict", currentHash: cause.currentHash },
        { status: 409 },
      );
    }
    const message = cause instanceof Error ? cause.message : "The decision could not be deleted.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
