import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { addSiteVisit, deleteSiteVisit, LeadWriteError } from "@/lib/content/leadMutations";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = await request.json().catch(() => null);
  try {
    const entry = addSiteVisit(slug, { id: crypto.randomUUID(), ...body });
    revalidatePath(`/leads/${slug}`);
    revalidatePath(`/leads/${slug}/site-visits`);
    return NextResponse.json({ saved: true, entry }, { status: 201 });
  } catch (cause) {
    const status = cause instanceof LeadWriteError ? cause.status : 500;
    const error = cause instanceof Error ? cause.message : "Site visit could not be saved.";
    return NextResponse.json({ error }, { status });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = await request.json().catch(() => null);
  try {
    const result = deleteSiteVisit(slug, body?.id, {
      confirmed: body?.confirmed,
      expectedDate: body?.expectedDate,
    });
    revalidatePath(`/leads/${slug}`);
    revalidatePath(`/leads/${slug}/site-visits`);
    return NextResponse.json({
      deleted: true,
      visit: result.visit,
      recoverableBackup: Boolean(result.backupPath),
    });
  } catch (cause) {
    const status = cause instanceof LeadWriteError ? cause.status : 500;
    const error = cause instanceof Error ? cause.message : "Site visit could not be deleted.";
    return NextResponse.json({ error }, { status });
  }
}
