import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { getLeadSlugs, getPermitQaqcSlugs, getProjectSlugs } from "@/lib/content";
import { reviewDestinationKindSchema } from "@/lib/content/reviewInbox";
import {
  confirmBulkReviewCards,
  confirmReviewCard,
  dismissReviewCard,
  editReviewCard,
  markReviewCardDuplicate,
  previewBulkApply,
  retryReviewCard,
  ReviewActionError,
  splitReviewCard,
} from "@/lib/content/reviewInboxService";
import {
  locateReviewInbox,
} from "@/lib/content/reviewInbox";
import { reviewAutomationModeSchema, writeReviewInboxSettings } from "@/lib/content/reviewInboxSettings";
import { workspaceKindSchema, type WorkspaceKind } from "@/lib/content/workspaceOutbox";

function knownSlug(kind: WorkspaceKind, slug: string): boolean {
  if (kind === "lead") return getLeadSlugs().includes(slug);
  if (kind === "project") return getProjectSlugs().includes(slug);
  return getPermitQaqcSlugs().includes(slug);
}

function reviewer(body: Record<string, unknown>): string {
  const value = typeof body.reviewedBy === "string" ? body.reviewedBy.trim().slice(0, 200) : "";
  // An unnamed reviewer is recorded as unnamed rather than as nobody: the audit line has to
  // say a person did this even when Mi does not know which person.
  return value || "Unnamed Mi user";
}

function revalidateWorkspace(kind: WorkspaceKind, slug: string): void {
  revalidatePath("/review");
  if (kind === "lead") {
    revalidatePath("/leads");
    revalidatePath(`/leads/${slug}`);
    return;
  }
  if (kind === "project") {
    revalidatePath("/projects");
    revalidatePath(`/projects/${slug}`);
    revalidatePath(`/projects/${slug}/knowledge`);
    return;
  }
  revalidatePath(`/permit-qaqc/${slug}`);
}

/**
 * Every state change a review card can go through.
 *
 * Confirmation is checked here rather than inside the service so that no caller -- a future
 * route, a script, a retry path -- can reach an apply without having passed `confirmed`
 * through the same gate the UI does.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Send a JSON body." }, { status: 400 });

  const kind = workspaceKindSchema.safeParse(body.kind);
  if (!kind.success) {
    return NextResponse.json({ error: "Name a workspace kind: lead, project, or permit-qaqc." }, { status: 400 });
  }
  const slug = typeof body.slug === "string" ? body.slug : "";
  if (!slug || !knownSlug(kind.data, slug)) {
    return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
  }

  const action = typeof body.action === "string" ? body.action : "";
  const cardId = typeof body.cardId === "string" ? body.cardId : "";

  try {
    switch (action) {
      case "confirm": {
        if (body.confirmed !== true) {
          return NextResponse.json({ error: "Applying a card requires explicit confirmation." }, { status: 400 });
        }
        const destination = reviewDestinationKindSchema.safeParse(body.destination);
        if (!destination.success) {
          return NextResponse.json({ error: "Choose where this card should be written." }, { status: 400 });
        }
        const result = confirmReviewCard({
          kind: kind.data,
          slug,
          cardId,
          destinationKind: destination.data,
          reviewedBy: reviewer(body),
        });
        revalidateWorkspace(kind.data, slug);
        // `applied: null` means the write did not land; the client must not say it did, so
        // the same outcome is reported as an error rather than as a quieter success.
        return NextResponse.json({
          status: result.card.status,
          message: result.message,
          ...(result.applied ? {} : { error: result.message }),
          applied: result.applied,
          card: result.card,
        }, { status: result.applied ? 200 : 409 });
      }

      case "dismiss": {
        const result = dismissReviewCard({
          kind: kind.data,
          slug,
          cardId,
          reviewedBy: reviewer(body),
          reason: typeof body.reason === "string" ? body.reason.slice(0, 500) : "",
        });
        revalidateWorkspace(kind.data, slug);
        return NextResponse.json({ status: result.card.status, message: result.message, card: result.card });
      }

      case "duplicate": {
        const result = markReviewCardDuplicate({
          kind: kind.data,
          slug,
          cardId,
          duplicateOf: typeof body.duplicateOf === "string" ? body.duplicateOf : undefined,
          reviewedBy: reviewer(body),
        });
        revalidateWorkspace(kind.data, slug);
        return NextResponse.json({ status: result.card.status, message: result.message, card: result.card });
      }

      case "edit": {
        const result = editReviewCard({ kind: kind.data, slug, cardId, content: body.content });
        revalidateWorkspace(kind.data, slug);
        return NextResponse.json({ status: result.card.status, message: result.message, card: result.card });
      }

      case "split": {
        const result = splitReviewCard({ kind: kind.data, slug, cardId, reviewedBy: reviewer(body) });
        revalidateWorkspace(kind.data, slug);
        return NextResponse.json({
          status: result.card.status,
          message: result.message,
          children: result.children.map((child) => child.id),
        });
      }

      case "retry": {
        const result = retryReviewCard({ kind: kind.data, slug, cardId });
        revalidateWorkspace(kind.data, slug);
        return NextResponse.json({ status: result.card.status, message: result.message });
      }

      case "bulk-preview": {
        const destination = reviewDestinationKindSchema.safeParse(body.destination);
        if (!destination.success) {
          return NextResponse.json({ error: "Choose where these cards should be written." }, { status: 400 });
        }
        const plan = previewBulkApply({
          kind: kind.data,
          slug,
          cardIds: Array.isArray(body.cardIds) ? body.cardIds.filter((id): id is string => typeof id === "string") : [],
          destinationKind: destination.data,
        });
        return NextResponse.json({ plan });
      }

      case "bulk-confirm": {
        if (body.confirmed !== true) {
          return NextResponse.json({ error: "Applying cards requires explicit confirmation." }, { status: 400 });
        }
        const destination = reviewDestinationKindSchema.safeParse(body.destination);
        if (!destination.success) {
          return NextResponse.json({ error: "Choose where these cards should be written." }, { status: 400 });
        }
        const outcome = confirmBulkReviewCards({
          previewFingerprint: typeof body.previewFingerprint === "string" ? body.previewFingerprint : "",
          kind: kind.data,
          slug,
          cardIds: Array.isArray(body.cardIds) ? body.cardIds.filter((id): id is string => typeof id === "string") : [],
          destinationKind: destination.data,
          reviewedBy: reviewer(body),
        });
        revalidateWorkspace(kind.data, slug);
        const failures = outcome.applied.filter((item) => !item.applied);
        return NextResponse.json({
          applied: outcome.applied.length - failures.length,
          failed: failures.length,
          message: failures.length === 0
            ? `Applied ${outcome.applied.length} card(s).`
            : `Applied ${outcome.applied.length - failures.length}; ${failures.length} failed: ${failures[0]?.message}`,
        });
      }

      case "set-automation": {
        const mode = reviewAutomationModeSchema.safeParse(body.automation);
        if (!mode.success) return NextResponse.json({ error: "Unknown automation setting." }, { status: 400 });
        const location = locateReviewInbox(kind.data, slug, { create: true });
        if (!location) return NextResponse.json({ error: "This workspace has no agent inbox yet." }, { status: 404 });
        writeReviewInboxSettings(location, mode.data);
        revalidateWorkspace(kind.data, slug);
        return NextResponse.json({ automation: mode.data, message: "Automation setting saved." });
      }

      default:
        return NextResponse.json({ error: "Unknown review action." }, { status: 400 });
    }
  } catch (cause) {
    if (cause instanceof ReviewActionError) {
      return NextResponse.json({ error: cause.message }, { status: cause.status });
    }
    // Never surface a stack trace: a reviewer needs to know what to do, not where it broke.
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "The review action could not be completed." },
      { status: 500 },
    );
  }
}
