import path from "node:path";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { ContentConflictError, readCurrentHash } from "@/lib/content/atomicContentWrite";
import { permitQaqcDir } from "@/lib/content/permitQaqc";
import { deletePermitQaqcEngagement, PermitQaqcWriteError, updatePermitQaqcEngagement } from "@/lib/content/permitQaqcMutations";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const body = await request.json().catch(() => null);
  const expectedHash: string | null | undefined = body?.expectedHash;
  try {
    const result = updatePermitQaqcEngagement(slug, body?.engagement, expectedHash === undefined ? {} : { expectedHash });
    revalidatePath("/permit-qaqc");
    revalidatePath(`/permit-qaqc/${result.slug}`);
    revalidatePath("/search");
    const hash = readCurrentHash(path.join(permitQaqcDir(result.slug), "qaqc.yaml"));
    return NextResponse.json({ saved: true, slug: result.slug, hash });
  } catch (cause) {
    if (cause instanceof ContentConflictError) {
      return NextResponse.json({ error: "conflict", currentHash: cause.currentHash }, { status: 409 });
    }
    const status = cause instanceof PermitQaqcWriteError ? cause.status : 500;
    const error = cause instanceof Error ? cause.message : "Permit QAQC engagement could not be updated.";
    return NextResponse.json({ error }, { status });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const body = await request.json().catch(() => null);
  try {
    const result = deletePermitQaqcEngagement(slug, {
      confirmed: body?.confirmed,
      expectedName: body?.expectedName,
    });
    revalidatePath("/permit-qaqc");
    revalidatePath(`/permit-qaqc/${result.slug}`);
    revalidatePath("/search");
    return NextResponse.json({ deleted: true, slug: result.slug, recoverableBackup: true });
  } catch (cause) {
    const status = cause instanceof PermitQaqcWriteError ? cause.status : 500;
    const error = cause instanceof Error ? cause.message : "Permit QAQC engagement could not be deleted.";
    return NextResponse.json({ error }, { status });
  }
}
