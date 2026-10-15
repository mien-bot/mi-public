import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { ContentConflictError } from "@/lib/content/atomicContentWrite";
import { getProjectSlugs } from "@/lib/content";
import { pullProjectFromNotion } from "@/src/services/notionSync";

function refreshProject(slug: string) {
  revalidatePath("/projects");
  revalidatePath(`/projects/${slug}`);
  revalidatePath(`/projects/${slug}/schedule`);
  revalidatePath(`/projects/${slug}/details`);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!getProjectSlugs().includes(slug)) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  const confirmed = body?.confirmed === true;

  try {
    const plan = await pullProjectFromNotion(slug, { apply: confirmed });
    if (confirmed) refreshProject(slug);
    return NextResponse.json({ confirmed, plan });
  } catch (cause) {
    if (cause instanceof ContentConflictError) {
      return NextResponse.json(
        { error: "Mi data changed while Notion was being read. Reload and review the sync again." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Notion synchronization failed." },
      { status: 502 },
    );
  }
}
