import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { inboxDeleteSchema, previewInboxDelete, confirmInboxDelete } from "@/lib/content/reviewInboxDelete";
import { ReviewActionError } from "@/lib/content/reviewInboxService";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = inboxDeleteSchema.safeParse(body?.items);
  if (!parsed.success) return NextResponse.json({ error: "Select 1–100 pending or failed items." }, { status: 400 });
  try {
    if (body.action === "preview") return NextResponse.json({ plan: previewInboxDelete(parsed.data) });
    if (body.action !== "delete" || body.confirmed !== true || body.confirmedAgain !== true) {
      return NextResponse.json({ error: "Deleting requires two confirmations." }, { status: 400 });
    }
    const results = confirmInboxDelete(parsed.data, typeof body.fingerprint === "string" ? body.fingerprint : "",
      typeof body.reviewedBy === "string" ? body.reviewedBy.trim().slice(0, 200) || "Unnamed Mi user" : "Unnamed Mi user");
    revalidatePath("/review");
    for (const item of parsed.data) {
      const root = item.kind === "project" ? "/projects" : item.kind === "lead" ? "/leads" : "/permit-qaqc";
      revalidatePath(`${root}/${item.slug}`, "layout");
    }
    return NextResponse.json({ results });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Unable to delete selected items." },
      { status: cause instanceof ReviewActionError ? cause.status : 500 });
  }
}
