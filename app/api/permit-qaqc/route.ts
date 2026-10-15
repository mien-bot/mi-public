import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { createPermitQaqcEngagement, PermitQaqcWriteError } from "@/lib/content/permitQaqcMutations";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  try {
    const result = createPermitQaqcEngagement(body?.slug, body?.engagement);
    revalidatePath("/permit-qaqc");
    revalidatePath(`/permit-qaqc/${result.slug}`);
    revalidatePath("/search");
    return NextResponse.json({ saved: true, slug: result.slug }, { status: 201 });
  } catch (cause) {
    const status = cause instanceof PermitQaqcWriteError ? cause.status : 500;
    const error = cause instanceof Error ? cause.message : "Permit QAQC engagement could not be created.";
    return NextResponse.json({ error }, { status });
  }
}
