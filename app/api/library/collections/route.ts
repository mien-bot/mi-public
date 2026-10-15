import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import {
  createLibraryCollection,
  LibraryWriteError,
} from "@/lib/content/libraryMutations";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  try {
    const result = createLibraryCollection(body);
    revalidatePath("/library");
    revalidatePath(`/library/${result.slug}`);
    revalidatePath("/search");
    return NextResponse.json({ saved: true, slug: result.slug }, { status: 201 });
  } catch (cause) {
    const status = cause instanceof LibraryWriteError ? cause.status : 500;
    const error = cause instanceof Error ? cause.message : "Collection could not be created.";
    return NextResponse.json({ error }, { status });
  }
}
