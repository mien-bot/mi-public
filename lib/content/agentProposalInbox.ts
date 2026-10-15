import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  parseProjectProposalSource,
  projectCopilotProposalSchema,
  type ProjectCopilotProposal,
} from "@/lib/projectCopilot";
import { hashContent, readCurrentHash, writeFileAtomically } from "./atomicContentWrite";
import { resolveConfirmedProjectDir } from "./dropboxMirror";
import { getProject } from "./projects";
import { DROPBOX_ROOT, PROJECTS_DIR } from "./paths";

const MAX_INBOX_FILES = 100;
const MAX_INBOX_FILE_BYTES = 1_000_000;
const SAFE_ID = /^[a-z0-9][a-z0-9-]{2,79}$/;

const inboxEnvelopeSchema = z.object({
  version: z.literal(1),
  id: z.string().regex(SAFE_ID),
  project_slug: z.string().regex(/^[a-z0-9-]+$/),
  source: z.enum(["mi-agent-cli", "mi-project-terminal", "mi-project-terminal-file"]),
  engine: z.enum(["codex", "claude"]).nullable(),
  model: z.string().trim().min(1).max(200).nullable(),
  created_at: z.string().datetime(),
  proposals: z.array(projectCopilotProposalSchema).min(1).max(20),
  /**
   * Closed proposals, kept forever rather than deleted: this file is the record
   * of what an agent proposed, so a dismissal has to leave a trace. `reason` is
   * free text the person optionally typed when dismissing, "" otherwise.
   */
  resolved: z.array(z.object({
    proposal_id: z.string().regex(SAFE_ID),
    status: z.enum(["applied", "dismissed"]),
    resolved_at: z.string().datetime(),
    reason: z.string().trim().max(500).default(""),
  })).default([]),
}).superRefine((envelope, context) => {
  if (envelope.source === "mi-agent-cli" && envelope.engine === null) {
    context.addIssue({
      code: "custom",
      path: ["engine"],
      message: "CLI proposal drafts must identify their agent engine.",
    });
  }
});

export type AgentProposalInboxEnvelope = z.infer<typeof inboxEnvelopeSchema>;

/** A proposal that has been closed, paired with how and when it was closed. */
export interface AgentProposalInboxResolution {
  proposal: ProjectCopilotProposal;
  status: "applied" | "dismissed";
  resolvedAt: string;
  reason: string;
}

export interface AgentProposalInboxRecord {
  envelope: AgentProposalInboxEnvelope;
  pendingProposals: ProjectCopilotProposal[];
  /** Applied and dismissed proposals, so the UI can tell those two apart from "never existed". */
  resolvedProposals: AgentProposalInboxResolution[];
  hash: string;
}

export type CaptureAgentProposalResult =
  | { status: "none" }
  | { status: "invalid"; error: string }
  | { status: "duplicate"; fileName: string; proposalCount: number }
  | { status: "conflict"; error: string; proposalIds: string[] }
  | { status: "saved"; fileName: string; proposalCount: number };

function inboxId(
  projectSlug: string,
  createdAt: string,
  source: "mi-agent-cli" | "mi-project-terminal" | "mi-project-terminal-file",
  engine: "codex" | "claude" | null,
  proposals: ProjectCopilotProposal[],
): string {
  return `agent-${hashContent(JSON.stringify({ projectSlug, createdAt, source, engine, proposals })).slice(0, 20)}`;
}

function fileNameFor(envelope: AgentProposalInboxEnvelope): string {
  const timestamp = envelope.created_at.replace(/\D/g, "").slice(0, 17);
  return `${timestamp}-${envelope.id}.json`;
}

function assertInboxDirectory(workspace: string): string {
  const resolvedWorkspace = fs.realpathSync.native(workspace);
  if (!fs.existsSync(path.join(resolvedWorkspace, "AGENTS.md"))) {
    throw new Error("The project agent workspace is missing AGENTS.md.");
  }
  const inbox = path.join(resolvedWorkspace, "inbox");
  fs.mkdirSync(inbox, { recursive: true });
  const realInbox = fs.realpathSync.native(inbox);
  const relative = path.relative(resolvedWorkspace, realInbox);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("The proposal inbox escapes the confirmed project agent workspace.");
  }
  return realInbox;
}

export function captureAgentProposalReply(input: {
  workspace: string;
  projectSlug: string;
  source?: "mi-agent-cli" | "mi-project-terminal" | "mi-project-terminal-file";
  engine?: "codex" | "claude";
  model?: string;
  rawReply: string;
  now?: () => Date;
}): CaptureAgentProposalResult {
  const parsed = parseProjectProposalSource(input.rawReply);
  if (parsed.proposalError) return { status: "invalid", error: parsed.proposalError };
  if (parsed.proposals.length === 0) return { status: "none" };

  const createdAt = (input.now ?? (() => new Date()))().toISOString();
  const source = input.source ?? "mi-agent-cli";
  const engine = input.engine ?? null;
  const envelope = inboxEnvelopeSchema.parse({
    version: 1,
    id: inboxId(input.projectSlug, createdAt, source, engine, parsed.proposals),
    project_slug: input.projectSlug,
    source,
    engine,
    model: input.model?.trim() || null,
    created_at: createdAt,
    proposals: parsed.proposals,
    resolved: [],
  });
  const inbox = assertInboxDirectory(input.workspace);
  const existingById = new Map<string, {
    proposal: ProjectCopilotProposal;
    fileName: string;
    closedAs: "applied" | "dismissed" | null;
  }>();
  for (const entry of fs.readdirSync(inbox, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      const existing = inboxEnvelopeSchema.parse(JSON.parse(fs.readFileSync(path.join(inbox, entry.name), "utf8")));
      if (existing.project_slug !== input.projectSlug) continue;
      const closedById = new Map(existing.resolved.map((item) => [item.proposal_id, item.status]));
      for (const proposal of existing.proposals) {
        existingById.set(proposal.id, {
          proposal,
          fileName: entry.name,
          closedAs: closedById.get(proposal.id) ?? null,
        });
      }
    } catch {
      // Invalid or unrelated inbox files are ignored just as the read path ignores them.
    }
  }
  const overlaps = envelope.proposals.filter((proposal) => existingById.has(proposal.id));

  /*
   * A proposal id that has already been closed stays closed. Re-submitting it
   * does not reopen the card: the whole point of dismissing is that the person
   * decided against it, and an agent that re-runs the same script should not be
   * able to put a rejected card back in front of them. Genuinely new work needs
   * a new id -- and the closed one stays in the file as the record of what was
   * decided. This is reported separately from the pending-duplicate case so the
   * helper cannot say "already has these pending review cards" about a card that
   * is not pending.
   */
  const closed = overlaps.filter((proposal) => existingById.get(proposal.id)?.closedAs);
  if (closed.length > 0) {
    const described = closed
      .map((proposal) => `${proposal.id} (already ${existingById.get(proposal.id)?.closedAs})`)
      .join(", ");
    return {
      status: "conflict",
      proposalIds: closed.map((proposal) => proposal.id),
      error: `Mi has already closed these proposal id(s): ${described}. A closed proposal is not reopened by re-sending it — use a new stable id if this is genuinely new work.`,
    };
  }

  if (overlaps.length > 0) {
    const changed = overlaps.filter((proposal) =>
      JSON.stringify(existingById.get(proposal.id)?.proposal) !== JSON.stringify(proposal));
    if (changed.length > 0 || overlaps.length !== envelope.proposals.length) {
      const proposalIds = overlaps.map((proposal) => proposal.id);
      return {
        status: "conflict",
        proposalIds,
        error: `Mi's proposal inbox already uses proposal id(s): ${proposalIds.join(", ")}. Keep the existing card, or use a new stable id for a genuinely different proposal.`,
      };
    }
    return {
      status: "duplicate",
      fileName: existingById.get(overlaps[0].id)?.fileName ?? "existing inbox draft",
      proposalCount: overlaps.length,
    };
  }
  const fileName = fileNameFor(envelope);
  writeFileAtomically(path.join(inbox, fileName), `${JSON.stringify(envelope, null, 2)}\n`, {
    expectedHash: null,
  });
  return { status: "saved", fileName, proposalCount: envelope.proposals.length };
}

/**
 * Where this project's agent workspace lives.
 *
 * Mirrors resolveHarnessRoot in electron/agentHarness.js: beside the real files
 * for a Dropbox-linked project, otherwise under the project's own record folder.
 * dropbox_path is human-confirmed and never inferred, so a project without one is
 * ordinary -- it just gets a local workspace rather than no agent at all.
 */
export function projectAgentWorkspaceDir(slug: string): string {
  const project = getProject(slug);
  if (project.meta.dropbox_path) {
    if (!DROPBOX_ROOT) {
      throw new Error("Select a local STUDIO Dropbox root before saving terminal proposals.");
    }
    return path.join(resolveConfirmedProjectDir(DROPBOX_ROOT, project.meta.dropbox_path), "Mi");
  }
  return path.join(PROJECTS_DIR, slug, "Mi");
}

/** Captures a project-terminal reply into the confirmed workspace as a draft, never an apply. */
export function captureProjectTerminalProposalReply(input: {
  projectSlug: string;
  rawReply: string;
  source?: "mi-project-terminal" | "mi-project-terminal-file";
  now?: () => Date;
}): CaptureAgentProposalResult {
  return captureAgentProposalReply({
    workspace: projectAgentWorkspaceDir(input.projectSlug),
    projectSlug: input.projectSlug,
    source: input.source ?? "mi-project-terminal",
    rawReply: input.rawReply,
    now: input.now,
  });
}

function confirmedInboxDirectory(slug: string): string | null {
  let workspace: string;
  try {
    workspace = projectAgentWorkspaceDir(slug);
  } catch {
    return null;
  }
  if (!fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) return null;
  const inbox = path.join(workspace, "inbox");
  if (!fs.existsSync(inbox) || !fs.statSync(inbox).isDirectory()) return null;
  const realWorkspace = fs.realpathSync.native(workspace);
  const realInbox = fs.realpathSync.native(inbox);
  const relative = path.relative(realWorkspace, realInbox);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("The proposal inbox escapes the confirmed project agent workspace.");
  }
  return realInbox;
}

function readEnvelope(filePath: string, slug: string): AgentProposalInboxRecord | null {
  if (fs.lstatSync(filePath).isSymbolicLink()) return null;
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size > MAX_INBOX_FILE_BYTES) return null;
  try {
    const raw = fs.readFileSync(filePath);
    const envelope = inboxEnvelopeSchema.parse(JSON.parse(raw.toString("utf8")));
    if (envelope.project_slug !== slug) return null;
    const byId = new Map(envelope.proposals.map((proposal) => [proposal.id, proposal]));
    const resolvedIds = new Set(envelope.resolved.map((item) => item.proposal_id));
    const pendingProposals = envelope.proposals.filter((proposal) => !resolvedIds.has(proposal.id));
    const resolvedProposals = envelope.resolved.flatMap((item) => {
      const proposal = byId.get(item.proposal_id);
      return proposal
        ? [{ proposal, status: item.status, resolvedAt: item.resolved_at, reason: item.reason }]
        : [];
    });
    return { envelope, pendingProposals, resolvedProposals, hash: hashContent(raw) };
  } catch {
    return null;
  }
}

/**
 * Bounded, read-only load of valid CLI drafts from the confirmed project workspace.
 * Envelopes whose proposals are all closed are still returned so the UI can show
 * an audit trail -- "gone from the inbox" must not be ambiguous between applied,
 * dismissed, and never submitted.
 */
export function listAgentProposalInbox(slug: string): AgentProposalInboxRecord[] {
  let inbox: string | null;
  try {
    inbox = confirmedInboxDirectory(slug);
  } catch {
    return [];
  }
  if (!inbox) return [];
  return fs.readdirSync(inbox, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .sort((left, right) => right.name.localeCompare(left.name))
    .slice(0, MAX_INBOX_FILES)
    .map((entry) => readEnvelope(path.join(inbox, entry.name), slug))
    .filter((record): record is AgentProposalInboxRecord =>
      record !== null && (record.pendingProposals.length > 0 || record.resolvedProposals.length > 0),
    );
}

/**
 * Closes one or more proposals in a single envelope, in one atomic write.
 *
 * Batching is not an optimization: each write changes the file hash, so closing
 * N proposals as N calls would make every call after the first fail its
 * expected-hash check. "Dismiss the remaining 3 of 18" has to be one write.
 *
 * A dismissal only records a decision. It never touches details.yaml,
 * project.yaml, schedule.yaml or memory/notes.md -- the same guarantee as an
 * unreviewed proposal, which is the whole point of having a dismiss path.
 */
export function resolveAgentInboxProposals(input: {
  slug: string;
  envelopeId: string;
  proposalIds: string[];
  status: "applied" | "dismissed";
  /** Free text from the person dismissing. Ignored for an apply. */
  reason?: string;
  expectedHash: string;
  now?: () => Date;
}): string {
  if (input.proposalIds.length === 0) throw new Error("No proposals were named to close.");
  const inbox = confirmedInboxDirectory(input.slug);
  if (!inbox) throw new Error("This project has no confirmed CLI proposal inbox.");
  const files = fs.readdirSync(inbox, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(`-${input.envelopeId}.json`));
  if (files.length !== 1) throw new Error("The proposal envelope was not found.");
  const filePath = path.join(inbox, files[0].name);
  const currentHash = readCurrentHash(filePath);
  if (currentHash !== input.expectedHash) {
    throw new Error("The proposal envelope changed after it was displayed. Refresh and review it again.");
  }
  const record = readEnvelope(filePath, input.slug);
  if (!record || record.envelope.id !== input.envelopeId) {
    throw new Error("The proposal envelope is invalid.");
  }
  const known = new Set(record.envelope.proposals.map((proposal) => proposal.id));
  const unknown = input.proposalIds.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(`Not in that envelope: ${unknown.join(", ")}.`);
  }
  const alreadyClosed = new Set(record.envelope.resolved.map((item) => item.proposal_id));
  const toClose = input.proposalIds.filter((id) => !alreadyClosed.has(id));
  if (toClose.length === 0) return record.hash;

  const resolvedAt = (input.now ?? (() => new Date()))().toISOString();
  const updated = inboxEnvelopeSchema.parse({
    ...record.envelope,
    resolved: [
      ...record.envelope.resolved,
      ...toClose.map((proposalId) => ({
        proposal_id: proposalId,
        status: input.status,
        resolved_at: resolvedAt,
        reason: input.status === "dismissed" ? (input.reason ?? "") : "",
      })),
    ],
  });
  const serialized = `${JSON.stringify(updated, null, 2)}\n`;
  writeFileAtomically(filePath, serialized, {
    expectedHash: input.expectedHash,
  });
  return hashContent(serialized);
}

export function resolveAgentInboxProposal(input: {
  slug: string;
  envelopeId: string;
  proposalId: string;
  status: "applied" | "dismissed";
  reason?: string;
  expectedHash: string;
  now?: () => Date;
}): string {
  const { proposalId, ...rest } = input;
  return resolveAgentInboxProposals({ ...rest, proposalIds: [proposalId] });
}
