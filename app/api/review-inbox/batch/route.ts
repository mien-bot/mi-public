import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getLeadSlugs, getProjectSlugs, getPermitQaqcSlugs } from "@/lib/content";
import { reviewBatchSchema, previewReviewBatch, confirmReviewBatch } from "@/lib/content/reviewInboxBatch";
import { ReviewActionError } from "@/lib/content/reviewInboxService";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = reviewBatchSchema.safeParse(body?.groups);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose items to review." }, { status: 400 });
  for (const group of parsed.data) {
    const slugs = group.kind === "project" ? getProjectSlugs() : group.kind === "lead" ? getLeadSlugs() : getPermitQaqcSlugs();
    if (!slugs.includes(group.slug)) return NextResponse.json({ error: "A selected workspace no longer exists. Refresh the inbox." }, { status: 404 });
  }
  try {
    if (body.action === "preview") return NextResponse.json({ plan: previewReviewBatch(parsed.data) });
    if (body.action !== "confirm" || body.confirmed !== true) {
      return NextResponse.json({ error: "Accepting this batch requires explicit confirmation." }, { status: 400 });
    }
    const results = confirmReviewBatch(parsed.data,
      typeof body.fingerprint === "string" ? body.fingerprint : "",
      typeof body.reviewedBy === "string" && body.reviewedBy.trim() ? body.reviewedBy.trim().slice(0, 200) : "Unnamed Mi user");
    revalidatePath("/review");
    for (const group of parsed.data) {
      const root = group.kind === "project" ? "/projects" : group.kind === "lead" ? "/leads" : "/permit-qaqc";
      revalidatePath(root);
      revalidatePath(`${root}/${group.slug}`, "layout");
    }
    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to process this batch." },
      { status: error instanceof ReviewActionError ? error.status : 500 });
  }
}
