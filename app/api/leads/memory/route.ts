import { NextResponse } from "next/server";
import { leadCopilotProposalSchema } from "@/lib/leadCopilot";
import { appendFirmMemoryNote } from "@/lib/content/firmMemory";
import { recordAudit } from "@/src/audit/log";

function actor(): string {
  return process.env.USERNAME || process.env.USER || "unknown";
}

/**
 * Saves a firm-memory-note proposal to the shared, git-tracked leads playbook
 * (.agent/memory/shared/lead-precontract.md) -- separate from
 * app/api/leads/[slug]/copilot/route.ts, which writes to one specific lead's own record.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = leadCopilotProposalSchema.safeParse(body?.proposal);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid proposal." }, { status: 400 });
  }
  const proposal = parsed.data;
  if (proposal.kind !== "firm-memory-note") {
    return NextResponse.json(
      { error: "This route only saves a firm-wide memory note." },
      { status: 400 },
    );
  }
  if (!body || body.confirmed !== true) {
    return NextResponse.json({ error: "Explicit confirmation is required." }, { status: 409 });
  }

  try {
    const file = appendFirmMemoryNote("leads", { title: proposal.title, entry: proposal.data.entry });
    recordAudit({
      command: "leads agent confirmed firm memory note",
      actor: actor(),
      slug: "leads",
      diff: { proposal_id: proposal.id, title: proposal.title },
      applied: true,
    });
    return NextResponse.json({
      ok: true,
      file,
      message: "Saved to the shared leads playbook. Commit it in git to share with the rest of the firm.",
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "The note could not be saved.";
    recordAudit({
      command: "leads agent firm memory note failed",
      actor: actor(),
      slug: "leads",
      diff: { proposal_id: proposal.id, message },
      applied: false,
    });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
