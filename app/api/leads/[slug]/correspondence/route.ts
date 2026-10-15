import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { addCommunication, deleteCommunication, LeadWriteError } from "@/lib/content/leadMutations";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = await request.json().catch(() => null);
  try {
    const entry = addCommunication(slug, { id: crypto.randomUUID(), ...body });
    revalidatePath(`/leads/${slug}`);
    revalidatePath(`/leads/${slug}/correspondence`);
    return NextResponse.json({ saved: true, entry }, { status: 201 });
  } catch (cause) {
    const status = cause instanceof LeadWriteError ? cause.status : 500;
    const error = cause instanceof Error ? cause.message : "Correspondence could not be saved.";
    return NextResponse.json({ error }, { status });
  }
}

/** Removes one entry from a lead's correspondence log. A mis-logged call had no way out. */
export async function DELETE(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = await request.json().catch(() => null);
  if (body?.confirmed !== true) {
    return NextResponse.json({ error: "Explicit confirmation is required." }, { status: 409 });
  }
  try {
    const entry = deleteCommunication(slug, body?.id);
    revalidatePath(`/leads/${slug}`);
    revalidatePath(`/leads/${slug}/correspondence`);
    return NextResponse.json({ deleted: true, entry });
  } catch (cause) {
    const status = cause instanceof LeadWriteError ? cause.status : 500;
    const error = cause instanceof Error ? cause.message : "Correspondence could not be deleted.";
    return NextResponse.json({ error }, { status });
  }
}
