import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getProject, getProjectSlugs, getSchedule, schedulePath, writeProjectSchedule } from "@/lib/content";
import { readCurrentHash } from "@/lib/content/atomicContentWrite";
import { applyMilestoneBatch, previewMilestoneBatch, type MilestoneBatchRepository } from "@/lib/content/milestoneBatch";
import { getRemovableScheduleEntry, trashScheduleEntry } from "@/src/adapters/notion/schedule";
import { isWriteAllowed } from "@/src/policies/approvals";
import { recordAudit } from "@/src/audit/log";

const inputSchema = z.object({
  action: z.enum(["archive", "restore", "delete"]),
  ids: z.array(z.string().min(1)).min(1).max(100),
  expectedHash: z.string().nullable(),
  confirmed: z.boolean().optional(),
  fingerprint: z.string().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Select milestones and reload the schedule before reviewing this action." }, { status: 400 });
  if (!getProjectSlugs().includes(slug)) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  const body = parsed.data;
  try {
    const repository: MilestoneBatchRepository = {
      load: () => ({ hash: readCurrentHash(schedulePath(slug)), milestones: getSchedule(slug, { includeArchived: true }).milestones, projectPageId: getProject(slug).meta.notion_page_id }),
      save: (items, expectedHash) => writeProjectSchedule(slug, items, { expectedHash }),
      canRemove: () => isWriteAllowed("schedule", "remove"),
      readNotion: getRemovableScheduleEntry,
      trashNotion: trashScheduleEntry,
    };
    if (!body.confirmed) return NextResponse.json(await previewMilestoneBatch(slug, body.action, body.ids, body.expectedHash, repository));
    if (!body.fingerprint) return NextResponse.json({ error: "Preview this batch before confirming." }, { status: 409 });
    const result = await applyMilestoneBatch(slug, body.action, body.ids, body.expectedHash, body.fingerprint, repository);
    let warning = "";
    try {
      recordAudit({ command: `project milestone batch ${body.action}`, actor: process.env.USERNAME || process.env.USER || "unknown", slug, diff: result.results, applied: result.results.some((item) => item.status !== "failed") });
    } catch { warning = "Mi could not save its audit record. Item outcomes below still apply."; }
    revalidatePath(`/projects/${slug}`);
    revalidatePath(`/projects/${slug}/schedule`);
    revalidatePath("/projects");
    return NextResponse.json({ ...result, warning });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Could not process these milestones." }, { status: 409 });
  }
}
