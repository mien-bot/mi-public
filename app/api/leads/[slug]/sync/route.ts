import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { ContentConflictError } from "@/lib/content/atomicContentWrite";
import { getLeadSlugs } from "@/lib/content/leads";
import { LeadWriteError } from "@/lib/content/leadMutations";
import { pullLeadSources } from "@/src/services/leadSync";

function refreshLeadPages(slug: string): void {
  revalidatePath("/leads");
  revalidatePath("/leads/analysis");
  revalidatePath(`/leads/${slug}`);
  revalidatePath(`/leads/${slug}/analysis`);
  revalidatePath(`/leads/${slug}/contracts`);
  revalidatePath(`/leads/${slug}/owner-supplied`);
  revalidatePath(`/leads/${slug}/dropbox`);
  revalidatePath(`/leads/${slug}/chat`);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!getLeadSlugs().includes(slug)) {
    return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  const confirmed = body?.confirmed === true;

  try {
    const plan = await pullLeadSources(slug, { apply: confirmed });
    if (confirmed) refreshLeadPages(slug);
    return NextResponse.json({ confirmed, plan });
  } catch (cause) {
    if (cause instanceof ContentConflictError || (cause instanceof LeadWriteError && cause.status === 409)) {
      return NextResponse.json(
        { error: "Lead data changed while Dropbox or Notion was being read. Reload and preview the sync again." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Lead synchronization failed." },
      { status: 502 },
    );
  }
}
