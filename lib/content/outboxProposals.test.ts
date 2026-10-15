import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Lead } from "@/lib/schema";
import { leadReviewCards } from "./outboxProposals";
import {
  appendOutboxEntryTo,
  readOutboxIn,
  resolveOutboxEntriesIn,
  type OutboxLocation,
  type WorkspaceOutboxEntry,
} from "./workspaceOutbox";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function location(): OutboxLocation {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-outbox-loop-"));
  roots.push(root);
  const inbox = path.join(root, "Mi", "inbox");
  fs.mkdirSync(inbox, { recursive: true });
  return { kind: "lead", slug: "example", inbox, resolutions: path.join(root, "record", ".mi", "res.json") };
}

const lead = {
  name: "example-record-70",
  source: "referral",
  status: "proposal-sent",
  contact_name: "example-record-71",
  contact_email: "user@example.com",
  contact_phone: "",
  referrer_name: "Example Referrer",
  date_received: "2026-08-11",
  estimated_value: 6000,
  notes: "",
  lost_reason: null,
  converted_project_slug: null,
  converted_date: null,
  dropbox_path: "1.01 LEADS/26_0715_example-record-70",
  contract_stage: "not-sent",
  contract_notes: "",
  notion_page_id: null,
} as unknown as Lead;

function entry(overrides: Partial<WorkspaceOutboxEntry> = {}): WorkspaceOutboxEntry {
  return {
    version: 1,
    id: "entry-fee",
    kind: "record-change",
    created_at: "2026-08-12T20:00:00.000Z",
    session: { id: "s1", agent: "claude" },
    workspace: { type: "lead", slug: "example" },
    visibility: "internal",
    title: "Example estimate update",
    body: "The example estimate needs an update.",
    why: "The example contains a previous estimate.",
    evidence: [{ path: "01_Admin/26_0812_Internal Team Notes.pdf", quote: "" }],
    targets: [{ record: "lead.yaml", field: "estimated_value", proposed: "4500", current: "6000" }],
    needs_confirmation: true,
    meeting: null,
    ...overrides,
  };
}

describe("leadReviewCards", () => {
  it("builds an applicable patch and shows the current value beside the proposed one", () => {
    const [card] = leadReviewCards([entry()], lead);
    expect(card.patch).toEqual({ estimated_value: 4500 });
    expect(card.changes).toEqual([{ field: "estimated_value", current: "6000", proposed: "4500" }]);
    expect(card.unappliableReason).toBeNull();
    expect(card.evidence).toContain("01_Admin/26_0812_Internal Team Notes.pdf");
  });

  it("parses a money-formatted figure but refuses one that is not a number", () => {
    const [formatted] = leadReviewCards([entry({
      targets: [{ record: "lead.yaml", field: "estimated_value", proposed: "$4,500", current: "6000" }],
    })], lead);
    expect(formatted.patch).toEqual({ estimated_value: 4500 });

    const [nonsense] = leadReviewCards([entry({
      targets: [{ record: "lead.yaml", field: "estimated_value", proposed: "about four thousand", current: "6000" }],
    })], lead);
    // Better to decline than to write NaN or silently zero a fee.
    expect(nonsense.patch).toBeNull();
    expect(nonsense.unappliableReason).toBeTruthy();
  });

  it("refuses a value the field's own schema rejects", () => {
    const [card] = leadReviewCards([entry({
      targets: [{ record: "lead.yaml", field: "status", proposed: "definitely-winning", current: "proposal-sent" }],
    })], lead);
    expect(card.patch).toBeNull();
    expect(card.unappliableReason).toBeTruthy();
  });

  it("will not write a field outside the lead update schema", () => {
    const [card] = leadReviewCards([entry({
      targets: [{ record: "lead.yaml", field: "converted_project_slug", proposed: "some-project", current: "" }],
    })], lead);
    expect(card.patch).toBeNull();
    expect(card.unappliableReason).toContain("does not write");
  });

  it("keeps a knowledge-only entry visible with no Apply action", () => {
    const [card] = leadReviewCards([entry({
      id: "entry-insurance",
      kind: "fact",
      title: "Example administrative note for STUDIO PLLC",
      targets: [],
    })], lead);
    expect(card.patch).toBeNull();
    expect(card.unappliableReason).toContain("records knowledge");
    expect(card.title).toContain("STUDIO PLLC");
  });

  it("does not apply an entry aimed at a record this page does not own", () => {
    const [card] = leadReviewCards([entry({
      targets: [{ record: "schedule/schedule.yaml", field: "milestone", proposed: "Permit submission", current: "" }],
    })], lead);
    expect(card.patch).toBeNull();
    expect(card.unappliableReason).toContain("schedule/schedule.yaml");
  });

  it("completes the loop: an agent writes a file, a card appears, confirming clears it", () => {
    // The whole point of the feature, exercised end to end without the HTTP layer:
    // a terminal session drops one JSON file and it reaches a reviewable card.
    const place = location();
    const written = appendOutboxEntryTo(place, {
      ...entry(),
      id: undefined,
      workspace: { type: "lead", slug: "example" },
    });
    expect(written.status).toBe("saved");
    const entryId = written.status === "saved" ? written.id : "";

    const pending = readOutboxIn(place).pending.map((record) => record.entry);
    const cards = leadReviewCards(pending, lead);
    expect(cards).toHaveLength(1);
    expect(cards[0].patch).toEqual({ estimated_value: 4500 });

    resolveOutboxEntriesIn(place, { entryIds: [entryId], status: "applied" });
    expect(readOutboxIn(place).pending).toHaveLength(0);
    expect(readOutboxIn(place).resolved[0].resolution.status).toBe("applied");

    // The entry file survives the review: it is the record of what the session claimed.
    expect(fs.existsSync(path.join(place.inbox, `${entryId}.json`))).toBe(true);
  });

  it("carries the visibility flag onto the card", () => {
    const [internal] = leadReviewCards([entry()], lead);
    const [client] = leadReviewCards([entry({ visibility: "client-visible" })], lead);
    expect(internal.visibility).toBe("internal");
    expect(client.visibility).toBe("client-visible");
  });
});
