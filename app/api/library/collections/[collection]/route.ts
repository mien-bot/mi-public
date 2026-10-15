import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { deleteLibraryCollection, LibraryWriteError } from "@/lib/content/libraryMutations";

/**
 * Removes a whole library collection — its folder, its index, and every document in it.
 *
 * This destroys far more than a single record, so it asks for the collection's exact name
 * back before it will run: a slug is easy to mis-click out of a list, a typed name is not.
 * That is the same discipline the lead-deletion route uses. The content layer copies the
 * whole directory into `.mi-backups/` first, so even a confirmed mistake is recoverable
 * from disk rather than final.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ collection: string }> },
) {
  const { collection } = await params;
  const body = await request.json().catch(() => null);
  if (body?.confirmed !== true) {
    return NextResponse.json({ error: "Explicit confirmation is required." }, { status: 409 });
  }
  if (typeof body?.expectedName !== "string" || body.expectedName.length === 0) {
    return NextResponse.json(
      { error: "Type the collection's exact name to confirm deletion." },
      { status: 400 },
    );
  }

  try {
    const result = deleteLibraryCollection(collection, {
      confirmed: true,
      expectedName: body.expectedName,
    });
    revalidatePath("/library");
    revalidatePath(`/library/${result.slug}`);
    revalidatePath("/search");
    return NextResponse.json({
      deleted: true,
      slug: result.slug,
      name: result.meta.name,
      backupPath: result.backupPath,
    });
  } catch (cause) {
    const status = cause instanceof LibraryWriteError ? cause.status : 500;
    const error = cause instanceof Error ? cause.message : "The collection could not be deleted.";
    return NextResponse.json({ error }, { status });
  }
}
