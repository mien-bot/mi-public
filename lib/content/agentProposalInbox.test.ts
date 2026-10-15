import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureAgentProposalReply } from "./agentProposalInbox";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function workspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-agent-inbox-"));
  roots.push(root);
  fs.writeFileSync(path.join(root, "AGENTS.md"), "rules");
  return root;
}

describe("captureAgentProposalReply", () => {
  it("stores validated proposals as pending drafts without applying them", () => {
    const root = workspace();
    const result = captureAgentProposalReply({
      workspace: root,
      projectSlug: "demo",
      engine: "codex",
      model: "test-model",
      rawReply: [
        "I found one durable decision.",
        "```mi-proposals",
        '{"version":1,"proposals":[{"id":"approved-option","title":"Approved option","reason":"Record the confirmed decision.","kind":"memory-note","data":{"entry":"The client approved option B."}}]}',
        "```",
      ].join("\n"),
      now: () => new Date("2026-07-28T12:00:00.000Z"),
    });
    expect(result).toMatchObject({ status: "saved", proposalCount: 1 });
    const files = fs.readdirSync(path.join(root, "inbox"));
    expect(files).toHaveLength(1);
    const envelope = JSON.parse(fs.readFileSync(path.join(root, "inbox", files[0]), "utf8"));
    expect(envelope).toMatchObject({
      project_slug: "demo",
      source: "mi-agent-cli",
      engine: "codex",
      resolved: [],
    });
  });

  it("does not create an inbox for ordinary discussion or invalid proposals", () => {
    const root = workspace();
    expect(captureAgentProposalReply({
      workspace: root,
      projectSlug: "demo",
      engine: "claude",
      rawReply: "No changes proposed.",
    })).toEqual({ status: "none" });
    expect(fs.existsSync(path.join(root, "inbox"))).toBe(false);

    const invalid = captureAgentProposalReply({
      workspace: root,
      projectSlug: "demo",
      engine: "claude",
      rawReply: "```mi-proposals\n{\"version\":1,\"proposals\":[{\"bad\":true}]}\n```",
    });
    expect(invalid.status).toBe("invalid");
    expect(fs.existsSync(path.join(root, "inbox"))).toBe(false);
  });

  it("labels interactive terminal captures without inventing an engine", () => {
    const root = workspace();
    const result = captureAgentProposalReply({
      workspace: root,
      projectSlug: "demo",
      source: "mi-project-terminal",
      rawReply: [
        "```mi-proposals",
        '{"version":1,"proposals":[{"id":"terminal-note","title":"Terminal note","reason":"Keep the researched conclusion.","kind":"memory-note","data":{"entry":"A researched conclusion."}}]}',
        "```",
      ].join("\n"),
      now: () => new Date("2026-08-06T12:00:00.000Z"),
    });

    expect(result.status).toBe("saved");
    const [file] = fs.readdirSync(path.join(root, "inbox"));
    const envelope = JSON.parse(fs.readFileSync(path.join(root, "inbox", file), "utf8"));
    expect(envelope).toMatchObject({
      source: "mi-project-terminal",
      engine: null,
    });
  });

  it("accepts bare proposal-file JSON and labels its source", () => {
    const root = workspace();
    const result = captureAgentProposalReply({
      workspace: root,
      projectSlug: "demo",
      source: "mi-project-terminal-file",
      rawReply: JSON.stringify({
        version: 1,
        proposals: [{
          id: "file-note",
          title: "File note",
          reason: "Read exact proposal bytes instead of rendered terminal text.",
          kind: "memory-note",
          data: { entry: "The exact file is authoritative input." },
        }],
      }),
      now: () => new Date("2026-08-06T13:00:00.000Z"),
    });

    expect(result.status).toBe("saved");
    const [file] = fs.readdirSync(path.join(root, "inbox"));
    const envelope = JSON.parse(fs.readFileSync(path.join(root, "inbox", file), "utf8"));
    expect(envelope.source).toBe("mi-project-terminal-file");
  });

  it("deduplicates identical pending cards and blocks changed reuse of a pending id", () => {
    const root = workspace();
    const base = {
      version: 1,
      proposals: [{
        id: "stable-note",
        title: "Stable note",
        reason: "Regression fixture.",
        kind: "memory-note",
        data: { entry: "First version." },
      }],
    };
    const first = captureAgentProposalReply({
      workspace: root,
      projectSlug: "demo",
      source: "mi-project-terminal-file",
      rawReply: JSON.stringify(base),
      now: () => new Date("2026-08-06T14:00:00.000Z"),
    });
    const duplicate = captureAgentProposalReply({
      workspace: root,
      projectSlug: "demo",
      source: "mi-project-terminal-file",
      rawReply: JSON.stringify(base),
      now: () => new Date("2026-08-06T14:01:00.000Z"),
    });
    const changed = structuredClone(base);
    changed.proposals[0].data.entry = "Changed version.";
    const conflict = captureAgentProposalReply({
      workspace: root,
      projectSlug: "demo",
      source: "mi-project-terminal-file",
      rawReply: JSON.stringify(changed),
      now: () => new Date("2026-08-06T14:02:00.000Z"),
    });

    expect(first.status).toBe("saved");
    expect(duplicate).toMatchObject({ status: "duplicate", proposalCount: 1 });
    expect(conflict).toMatchObject({ status: "conflict", proposalIds: ["stable-note"] });
    expect(fs.readdirSync(path.join(root, "inbox"))).toHaveLength(1);
  });

  /**
   * A dismissed proposal stays dismissed. Re-sending its id must not put a card
   * the person rejected back in front of them -- an agent re-running the same
   * script would otherwise resurrect it every time. The reply has to say so
   * plainly rather than reporting a "pending duplicate", because the card is
   * not pending.
   */
  it("does not reopen a proposal id that was already closed", () => {
    const root = workspace();
    const envelope = {
      version: 1,
      proposals: [{
        id: "rejected-note",
        title: "Rejected note",
        reason: "Regression fixture.",
        kind: "memory-note",
        data: { entry: "Not wanted." },
      }],
    };
    const saved = captureAgentProposalReply({
      workspace: root,
      projectSlug: "demo",
      source: "mi-project-terminal-file",
      rawReply: JSON.stringify(envelope),
      now: () => new Date("2026-08-06T14:00:00.000Z"),
    });
    expect(saved.status).toBe("saved");

    const inbox = path.join(root, "inbox");
    const [fileName] = fs.readdirSync(inbox);
    const stored = JSON.parse(fs.readFileSync(path.join(inbox, fileName), "utf8"));
    stored.resolved = [{
      proposal_id: "rejected-note",
      status: "dismissed",
      resolved_at: "2026-08-06T15:00:00.000Z",
      reason: "Already covered by the playbook.",
    }];
    fs.writeFileSync(path.join(inbox, fileName), JSON.stringify(stored, null, 2));

    const resubmitted = captureAgentProposalReply({
      workspace: root,
      projectSlug: "demo",
      source: "mi-project-terminal-file",
      rawReply: JSON.stringify(envelope),
      now: () => new Date("2026-08-06T16:00:00.000Z"),
    });

    expect(resubmitted).toMatchObject({ status: "conflict", proposalIds: ["rejected-note"] });
    expect((resubmitted as { error: string }).error).toContain("already dismissed");
    expect(fs.readdirSync(inbox)).toHaveLength(1);
  });
});
