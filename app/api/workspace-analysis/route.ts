import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { getLeadSlugs, getPermitQaqcSlugs, getProjectSlugs } from "@/lib/content";
import { runWorkspaceAnalysis } from "@/lib/content/workspaceAnalysisStore";
import { workspaceKindSchema } from "@/lib/content/workspaceOutbox";

const ROUTE_BY_KIND = {
  lead: (slug: string) => `/leads/${slug}`,
  project: (slug: string) => `/projects/${slug}`,
  "permit-qaqc": (slug: string) => `/permit-qaqc/${slug}`,
} as const;

function knownSlug(kind: "lead" | "project" | "permit-qaqc", slug: string): boolean {
  if (kind === "lead") return getLeadSlugs().includes(slug);
  if (kind === "project") return getProjectSlugs().includes(slug);
  return getPermitQaqcSlugs().includes(slug);
}

/**
 * Runs one Analyze pass and returns its findings.
 *
 * Analyze proposes and never applies, so this needs no confirmation gate of its own: the
 * only writes are Mi's analysis snapshot and folder seen-index. Every finding that implies
 * a record change still becomes a review card a person confirms separately.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const kind = workspaceKindSchema.safeParse(body?.kind);
  if (!kind.success) {
    return NextResponse.json({ error: "Name a workspace kind: lead, project, or permit-qaqc." }, { status: 400 });
  }
  const slug = typeof body?.slug === "string" ? body.slug : "";
  if (!slug || !knownSlug(kind.data, slug)) {
    return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
  }

  try {
    const { analysis, comparison, previousRanAt, knowledge } = runWorkspaceAnalysis(kind.data, slug);
    revalidatePath(ROUTE_BY_KIND[kind.data](slug));
    return NextResponse.json({ analysis, comparison, previousRanAt, knowledge });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Analyze failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
