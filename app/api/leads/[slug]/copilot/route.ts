import path from "node:path";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import {
  getLeadMeetingNotes,
  getLeadSlugs,
  getLeadWithHash,
  writeLeadMeetingNote,
} from "@/lib/content";
import { leadCopilotProposalSchema } from "@/lib/leadCopilot";
import { leadDir } from "@/lib/content/leads";
import { syncLeadToNotion } from "@/lib/content/leadNotionSync";
import { updateLead } from "@/lib/content/leadMutations";
import { appendNotionLeadBody } from "@/src/adapters/notion/leads";
import { dateInTimezone, DEFAULT_TIMEZONE } from "@/lib/content/timezone";

function portableRelativePath(root: string, filePath: string): string {
  const pathImplementation = path.win32.isAbsolute(root) || path.win32.isAbsolute(filePath)
    ? path.win32
    : path;
  return pathImplementation.relative(root, filePath).split(pathImplementation.sep).join("/");
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
  const parsed = leadCopilotProposalSchema.safeParse(body?.proposal);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid lead proposal." },
      { status: 400 },
    );
  }
  if (body?.confirmed !== true) {
    return NextResponse.json({ preview: parsed.data, saved: false });
  }
  const destination = body?.destination === "notion" ? "notion" : "mi";
  const current = getLeadWithHash(slug);
  if (destination === "notion" && !current.lead.notion_page_id) {
    return NextResponse.json(
      { error: "Confirm this lead's Notion page link before sending meeting notes or updates." },
      { status: 409 },
    );
  }

  try {
    let local: { saved: true; file?: string };
    const proposal = parsed.data;
    if (proposal.kind === "lead-update") {
      updateLead(slug, { ...current.lead, ...proposal.data }, { expectedHash: current.hash });
      local = { saved: true, file: "lead.yaml" };
    } else if (proposal.kind === "lead-meeting") {
      const duplicate = getLeadMeetingNotes(slug).some((meeting) => (
        meeting.id === proposal.data.id && meeting.date === proposal.data.date
      ));
      if (duplicate) {
        return NextResponse.json({ error: "That lead meeting is already saved." }, { status: 409 });
      }
      const filePath = writeLeadMeetingNote(slug, proposal.data);
      local = {
        saved: true,
        file: portableRelativePath(leadDir(slug), filePath),
      };
    } else {
      return NextResponse.json(
        { error: "A firm-wide memory note is saved through the shared leads playbook, not this lead's record." },
        { status: 400 },
      );
    }

    let notion: { status: "not-requested" | "synced" | "failed"; error: string | null } = {
      status: "not-requested",
      error: null,
    };
    if (destination === "notion") {
      const latest = getLeadWithHash(slug).lead;
      const result = await syncLeadToNotion(slug, latest);
      if (result.notionSynced && latest.notion_page_id) {
        const date = proposal.kind === "lead-meeting"
          ? proposal.data.date
          : dateInTimezone(new Date(), process.env.MI_TIMEZONE || DEFAULT_TIMEZONE);
        const sections = proposal.kind === "lead-meeting"
          ? [
              { heading: "Meeting state", content: proposal.data.meeting_status === "planned" ? "Planned agenda" : "Completed notes" },
              { heading: "Objective", content: proposal.data.objective },
              { heading: "Preparation", content: proposal.data.preparation.join("\n") },
              {
                heading: "Agenda",
                content: proposal.data.agenda_items.map((item, index) =>
                  `${index + 1}. ${item.topic} — ${item.duration_minutes} minutes${item.desired_outcome ? ` — outcome: ${item.desired_outcome}` : ""}`,
                ).join("\n"),
              },
              { heading: "Summary", content: proposal.data.summary },
              { heading: "Decisions", content: proposal.data.decisions.join("\n") },
              { heading: "Action items", content: proposal.data.action_items.map((item) => item.description).join("\n") },
              { heading: "Open questions", content: proposal.data.open_questions.join("\n") },
              { heading: "Raw notes", content: proposal.data.raw_notes },
            ]
          : [
              { heading: "Lead notes", content: proposal.data.notes ?? "" },
              { heading: "Contract notes", content: proposal.data.contract_notes ?? "" },
            ];
        try {
          await appendNotionLeadBody(latest.notion_page_id, `${date} · ${proposal.title}`, sections);
          notion = { status: "synced", error: null };
        } catch (error) {
          notion = { status: "failed", error: error instanceof Error ? error.message : "Notion page-body update failed." };
        }
      } else {
        notion = { status: "failed", error: result.notionError || "Notion did not confirm the update." };
      }
    }

    revalidatePath("/leads");
    revalidatePath(`/leads/${slug}`);
    revalidatePath(`/leads/${slug}/meetings`);
    return NextResponse.json({
      saved: true,
      result: { destination, local, notion },
    });
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Lead proposal could not be saved." },
      { status: 500 },
    );
  }
}
