import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import {
  deleteLibraryDocument,
  LibraryWriteError,
  updateLibraryDocumentMetadata,
} from "@/lib/content/libraryMutations";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ collection: string }> },
) {
  const { collection } = await params;
  const body = await request.json().catch(() => null);
  try {
    const result = updateLibraryDocumentMetadata(collection, body?.file, body?.metadata);
    revalidatePath("/library");
    revalidatePath(`/library/${result.collection}`);
    revalidatePath("/search");
    return NextResponse.json({ saved: true, document: result.document });
  } catch (cause) {
    const status = cause instanceof LibraryWriteError ? cause.status : 500;
    const error = cause instanceof Error ? cause.message : "Document metadata could not be updated.";
    return NextResponse.json({ error }, { status });
  }
}

/**
 * Removes a document from a collection: the file and its index row together.
 *
 * Dropping only the index row leaves an orphan the next scan re-adds; deleting only the
 * file leaves an index entry pointing at nothing. The content layer does both, and backs
 * the file up first.
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
  try {
    const result = deleteLibraryDocument(collection, body?.file);
    revalidatePath("/library");
    revalidatePath(`/library/${result.collection}`);
    revalidatePath("/search");
    return NextResponse.json({ deleted: true, file: result.file, backupPath: result.backupPath });
  } catch (cause) {
    const status = cause instanceof LibraryWriteError ? cause.status : 500;
    const error = cause instanceof Error ? cause.message : "The document could not be deleted.";
    return NextResponse.json({ error }, { status });
  }
}
