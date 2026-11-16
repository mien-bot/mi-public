import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { ContentConflictError } from "@/lib/content/atomicContentWrite";
import { PermitQaqcWriteError, setPermitQaqcCompletion } from "@/lib/content/permitQaqcMutations";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const body = await request.json().catch(() => null);
  try {
    const result = setPermitQaqcCompletion(slug, {
      action: body?.action,
      confirmed: body?.confirmed,
      expectedName: body?.expectedName,
    });
    revalidatePath("/permit-qaqc");
    revalidatePath(`/permit-qaqc/${result.slug}`);
    revalidatePath("/search");
    return NextResponse.json({ saved: true, slug: result.slug, status: result.engagement.status });
  } catch (cause) {
    if (cause instanceof ContentConflictError) {
      return NextResponse.json(
        { error: "This engagement was changed elsewhere. Refresh and try again." },
        { status: 409 },
      );
    }
    const status = cause instanceof PermitQaqcWriteError ? cause.status : 500;
    const error = cause instanceof Error ? cause.message : "Engagement could not be updated.";
    return NextResponse.json({ error }, { status });
  }
}
