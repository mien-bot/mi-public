import fs from "node:fs";
import path from "node:path";
import { GENERATED_MARKER } from "@/electron/agentHarness";
import { meetingVisibility, type MeetingNote } from "@/lib/schema";
import { writeFileAtomically } from "./atomicContentWrite";
import { resolveWorkspace, type WorkspaceKind, type WorkspaceOutboxEntry } from "./workspaceOutbox";

/**
 * Where regenerable views live.
 *
 * Strictly separate from `inbox/` (append-only agent evidence) and `memory/notes.md`
 * (user-authored). Everything under this folder carries the generated marker and may be
 * replaced wholesale on the next run; nothing outside it is ever written from here.
 */
const KNOWLEDGE_DIR = "knowledge";

function generated(content: string): string {
  return `${GENERATED_MARKER}\n${content.trim()}\n`;
}

/**
 * Content with its generation stamp removed, for deciding whether a rewrite is warranted.
 *
 * Without this the `Last generated:` line alone makes every file differ on every run, so
 * pressing Analyze twice rewrites both views and drops a `.mi-backups` copy into the
 * client's Dropbox folder each time. That is the same churn `previousSynchronizedAt`
 * exists to prevent in the harness, and it accumulates in a folder the firm shares.
 */
function withoutStamp(content: string): string {
  return content
    .replace(/^Last generated: .*$/m, "Last generated: <stamp>")
    .replace(/"generatedAt": "[^"]*"/, '"generatedAt": "<stamp>"');
}

function visibilityTag(visibility: "internal" | "client-visible"): string {
  return visibility === "internal" ? " **[INTERNAL — do not send to the client]**" : "";
}

function section(title: string, lines: string[]): string {
  return `## ${title}\n\n${lines.length > 0 ? lines.join("\n") : "_None recorded._"}`;
}

export interface KnowledgeInput {
  kind: WorkspaceKind;
  slug: string;
  label: string;
  meetings: MeetingNote[];
  entries: WorkspaceOutboxEntry[];
  generatedAt: string;
}

/**
 * The files a workspace gets so the next session starts current.
 *
 * Written as one Markdown view per question a person or agent actually asks, plus a
 * machine-readable index. Internal items are included -- this is the team's own workspace --
 * but every one is tagged, so nothing can be lifted into a client document by accident.
 */
export function buildKnowledgeFiles(input: KnowledgeInput): Map<string, string> {
  const completed = input.meetings.filter((meeting) => meeting.meeting_status === "completed");

  /*
   * Nothing captured yet means nothing to write. These files land in the firm's shared
   * Dropbox folders, and a "what earlier sessions learned" document that says "None
   * recorded" five times in every project folder is clutter that teaches a reader to
   * ignore the file -- which is precisely the wrong habit for the one place this feature
   * asks them to look.
   */
  if (completed.length === 0 && input.entries.length === 0) return new Map();

  const decisions = completed.flatMap((meeting) => {
    const tag = visibilityTag(meetingVisibility(meeting));
    const reasoningByStatement = new Map(
      meeting.decision_records.map((record) => [record.statement, record.reasoning]),
    );
    return meeting.decisions.map((statement) => {
      const reasoning = reasoningByStatement.get(statement);
      return `- **${statement}**${tag}\n  - Source: ${meeting.title} (${meeting.date})` +
        (reasoning ? `\n  - Why: ${reasoning}` : "");
    });
  });

  const blockers = [
    ...completed.flatMap((meeting) => meeting.blocking_questions.map(
      (question) => `- ${question}${visibilityTag(meetingVisibility(meeting))}\n  - Raised in ${meeting.title} (${meeting.date})`,
    )),
    ...input.entries.filter((entry) => entry.kind === "open-question" || entry.kind === "risk").map(
      (entry) => `- ${entry.title}${visibilityTag(entry.visibility)}\n  - ${entry.why || entry.body}`,
    ),
  ];

  const actions = completed.flatMap((meeting) => meeting.action_items.map(
    (item) => `- [ ] ${item.description} — ${item.owner || "no owner"}${item.due_date ? ` (due ${item.due_date})` : ""}` +
      `\n  - From ${meeting.title} (${meeting.date})`,
  ));

  const facts = input.entries
    .filter((entry) => entry.kind === "fact" || entry.kind === "lesson" || entry.kind === "reference")
    .map((entry) => `- **${entry.title}**${visibilityTag(entry.visibility)}\n  - ${entry.body}` +
      (entry.why ? `\n  - Why: ${entry.why}` : "") +
      (entry.evidence.length > 0
        ? `\n  - Evidence: ${entry.evidence.map((item) => item.path ?? item.quote).filter(Boolean).join(", ")}`
        : ""));

  const meetingLines = completed.map((meeting) =>
    `- ${meeting.date} — **${meeting.title}** (${meeting.meeting_type})${visibilityTag(meetingVisibility(meeting))}` +
    (meeting.sources.length > 0
      ? `\n  - Sources: ${meeting.sources.map((source) => source.relative_path ?? source.label).join(", ")}`
      : "\n  - No source attached"));

  const document = generated(`# ${input.label} — what earlier sessions learned

Generated by Mi from confirmed meeting records and reviewed session entries.
Do not hand-edit: this file is replaced on the next Analyze run. Record new findings in
\`inbox/\` instead.

Last generated: ${input.generatedAt}

${section("Decisions and the reasoning behind them", decisions)}

${section("Blocking questions and risks", blockers)}

${section("Open action items", actions)}

${section("Facts, references, and lessons", facts)}

${section("Meetings on record", meetingLines)}`);

  const index = {
    generatedBy: "Mi",
    generatedAt: input.generatedAt,
    workspace: { type: input.kind, slug: input.slug },
    counts: {
      meetings: completed.length,
      decisions: decisions.length,
      blockers: blockers.length,
      actions: actions.length,
      facts: facts.length,
    },
    meetings: completed.map((meeting) => ({
      id: meeting.id,
      title: meeting.title,
      date: meeting.date,
      type: meeting.meeting_type,
      visibility: meetingVisibility(meeting),
      sources: meeting.sources.map((source) => source.relative_path ?? source.label),
    })),
  };

  return new Map([
    [path.join(KNOWLEDGE_DIR, "KNOWLEDGE.md"), document],
    [path.join(KNOWLEDGE_DIR, "knowledge.json"), `${JSON.stringify(index, null, 2)}\n`],
  ]);
}

export interface KnowledgeWriteResult {
  relativePath: string;
  status: "written" | "unchanged" | "conflict" | "no-workspace" | "nothing-to-write";
}

/**
 * Writes the views into the workspace.
 *
 * Refuses to touch a file that does not already carry the generated marker, on the same
 * reasoning as `classifyFile`: a hand-written file at one of these paths is somebody's
 * work, and replacing it is not a refresh. `knowledge.json` is matched on its
 * `generatedBy` field instead, since JSON cannot hold the comment marker.
 */
export function writeKnowledgeFiles(
  kind: WorkspaceKind,
  slug: string,
  files: Map<string, string>,
): KnowledgeWriteResult[] {
  if (files.size === 0) {
    return [{ relativePath: KNOWLEDGE_DIR, status: "nothing-to-write" }];
  }
  const { harnessRoot } = resolveWorkspace(kind, slug);
  /*
   * A record whose agent workspace was never generated has nowhere to put these views.
   * Reported rather than skipped silently: the person needs to know one action fixes it,
   * and an empty result would otherwise be indistinguishable from "already current".
   */
  if (!fs.existsSync(harnessRoot)) {
    return [{ relativePath: KNOWLEDGE_DIR, status: "no-workspace" }];
  }

  return [...files].map(([relativePath, content]) => {
    const target = path.join(harnessRoot, relativePath);
    if (fs.existsSync(target)) {
      if (fs.lstatSync(target).isSymbolicLink()) {
        return { relativePath, status: "conflict" as const };
      }
      const existing = fs.readFileSync(target, "utf8");
      if (withoutStamp(existing) === withoutStamp(content)) {
        return { relativePath, status: "unchanged" as const };
      }
      const mine = relativePath.endsWith(".json")
        ? (() => {
          try {
            return JSON.parse(existing).generatedBy === "Mi";
          } catch {
            return false;
          }
        })()
        : existing.startsWith(GENERATED_MARKER);
      if (!mine) return { relativePath, status: "conflict" as const };
    }
    writeFileAtomically(target, content);
    return { relativePath, status: "written" as const };
  });
}
