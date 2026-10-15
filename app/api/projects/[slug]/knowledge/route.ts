import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getProjectSlugs } from "@/lib/content/projects";
import { appendProjectMemoryNote, memoryNotesPath } from "@/lib/content/projectWorkspace";
import { ContentConflictError, readCurrentHash } from "@/lib/content/atomicContentWrite";

const inputSchema = z.object({
  confirmed: z.literal(true), expectedHash: z.string().nullable(),
  title: z.string().trim().min(1).max(200).refine(value => !/[\r\n]/.test(value), "Use one line for the title."),
  entry: z.string().trim().min(1).max(20_000),
});
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getProjectSlugs().includes(slug)) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Review and confirm the note." }, { status: 400 });
  try {
    appendProjectMemoryNote(slug, { title: `fact note — ${new Date().toISOString().slice(0, 10)} — ${parsed.data.title}`, entry: parsed.data.entry }, { expectedHash: parsed.data.expectedHash });
    revalidatePath(`/projects/${slug}/knowledge`);
    revalidatePath(`/projects/${slug}`);
    return NextResponse.json({ saved: true, hash: readCurrentHash(memoryNotesPath(slug)) });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof ContentConflictError ? "Knowledge changed elsewhere. Reload and review your note before saving again." : "The note could not be saved." }, { status: 409 });
  }
}
