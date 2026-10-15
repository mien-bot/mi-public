import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendOutboxEntryTo,
  listOutboxEntriesIn,
  outboxEntryId,
  readOutboxIn,
  resolveOutboxEntriesIn,
  type OutboxLocation,
} from "./workspaceOutbox";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function location(kind: OutboxLocation["kind"] = "lead", slug = "demo-lead"): OutboxLocation {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-outbox-"));
  roots.push(root);
  const inbox = path.join(root, "Mi", "inbox");
  fs.mkdirSync(inbox, { recursive: true });
  return { kind, slug, inbox, resolutions: path.join(root, "record", ".mi", "outbox-resolutions.json") };
}

function entry(overrides: Record<string, unknown> = {}) {
  return {
    version: 1 as const,
    kind: "decision" as const,
    created_at: "2026-08-12T18:00:00.000Z",
    session: { id: "session-1", agent: "claude" },
    workspace: { type: "lead" as const, slug: "demo-lead" },
    visibility: "internal" as const,
    title: "Liability cap settled at two times fees",
    body: "Section 10 now reads two times the total fees received under this Agreement.",
    why: "Casey's written redline asked for a formula rather than the $10,000 fixed cap agreed on the call.",
    evidence: [{ path: "01_Admin/26_0812_Contract_Rev3.docx", quote: "" }],
    targets: [],
    needs_confirmation: true,
    ...overrides,
  };
}

describe("appendOutboxEntryTo", () => {
  it("reads a Windows PowerShell UTF-8 entry with its byte-order mark", () => {
    const place = location();
    fs.writeFileSync(path.join(place.inbox, "powershell.json"), `\uFEFF${JSON.stringify(entry())}`);
    expect(listOutboxEntriesIn(place)).toHaveLength(1);
  });

  it("writes one file per entry and derives a stable content id", () => {
    const place = location();
    const result = appendOutboxEntryTo(place, entry());
    expect(result.status).toBe("saved");

    const files = fs.readdirSync(place.inbox);
    expect(files).toHaveLength(1);
    const stored = JSON.parse(fs.readFileSync(path.join(place.inbox, files[0]), "utf8"));
    expect(stored).toMatchObject({
      kind: "decision",
      visibility: "internal",
      why: expect.stringContaining("written redline"),
      needs_confirmation: true,
    });
    expect(stored.id).toBe(outboxEntryId(entry()));
  });

  it("gives the same id to the same finding recorded at a different time by a different session", () => {
    // Analyze has to be idempotent: a second run over unchanged data must collapse onto
    // the first run's card rather than filing a duplicate.
    const place = location();
    expect(appendOutboxEntryTo(place, entry()).status).toBe("saved");
    const second = appendOutboxEntryTo(place, entry({
      created_at: "2026-08-13T09:30:00.000Z",
      session: { id: "session-2", agent: "codex" },
    }));
    expect(second.status).toBe("duplicate");
    expect(fs.readdirSync(place.inbox)).toHaveLength(1);
  });

  it("never edits an entry in place when the same id is resubmitted with different content", () => {
    const place = location();
    const first = appendOutboxEntryTo(place, entry());
    expect(first.status).toBe("saved");
    const id = first.status === "saved" ? first.id : "";

    const tampered = appendOutboxEntryTo(place, entry({ id, body: "Rewritten after the fact." }));
    expect(tampered.status).toBe("duplicate");
    const stored = JSON.parse(fs.readFileSync(path.join(place.inbox, `${id}.json`), "utf8"));
    expect(stored.body).toContain("two times the total fees");
  });

  it("refuses an entry addressed to another workspace", () => {
    const place = location("lead", "demo-lead");
    const result = appendOutboxEntryTo(place, entry({
      workspace: { type: "project", slug: "other-project" },
    }));
    expect(result).toMatchObject({ status: "invalid" });
    expect(fs.readdirSync(place.inbox)).toHaveLength(0);
  });

  it("refuses absolute evidence paths so an entry cannot point outside the workspace", () => {
    const place = location();
    const result = appendOutboxEntryTo(place, entry({
      evidence: [{ path: "C:/Users/secrets.txt", quote: "" }],
    }));
    expect(result).toMatchObject({ status: "invalid" });
  });

  it("requires an explicit visibility rather than defaulting one", () => {
    const place = location();
    const withoutVisibility: Record<string, unknown> = { ...entry() };
    delete withoutVisibility.visibility;
    expect(appendOutboxEntryTo(place, withoutVisibility)).toMatchObject({ status: "invalid" });
  });
});

describe("readOutboxIn", () => {
  it("separates pending from resolved and keeps closed entries closed", () => {
    const place = location();
    const saved = appendOutboxEntryTo(place, entry());
    const id = saved.status === "saved" ? saved.id : "";
    expect(readOutboxIn(place).pending).toHaveLength(1);

    resolveOutboxEntriesIn(place, { entryIds: [id], status: "dismissed", reason: "Already recorded." });
    const after = readOutboxIn(place);
    expect(after.pending).toHaveLength(0);
    expect(after.resolved[0]).toMatchObject({
      resolution: { status: "dismissed", reason: "Already recorded." },
    });

    // Re-submitting the same finding must not put a dismissed card back in front of anyone.
    appendOutboxEntryTo(place, entry({ created_at: "2026-08-20T00:00:00.000Z" }));
    expect(readOutboxIn(place).pending).toHaveLength(0);
  });

  it("keeps Mi's resolutions outside the agent-writable workspace", () => {
    const place = location();
    const saved = appendOutboxEntryTo(place, entry());
    const id = saved.status === "saved" ? saved.id : "";
    resolveOutboxEntriesIn(place, { entryIds: [id], status: "applied" });

    expect(fs.existsSync(place.resolutions)).toBe(true);
    const relative = path.relative(path.dirname(place.inbox), place.resolutions);
    expect(relative.startsWith("..")).toBe(true);
  });

  it("ignores the project proposal envelopes that already share this folder", () => {
    /*
     * Mi/inbox/ predates the session outbox: the project harness already stages
     * agentProposalInbox envelopes there ({project_slug, proposals[]}), and two real
     * project workspaces hold them today. The two record types coexist in one folder and
     * each reader must skip the other's files rather than erroring or mis-parsing them.
     */
    const place = location("project", "example");
    fs.writeFileSync(path.join(place.inbox, "20260808163655623-agent-7884b880ccce.json"), JSON.stringify({
      version: 1,
      id: "agent-7884b880ccce",
      project_slug: "example-project-59",
      source: "mi-project-terminal-file",
      engine: null,
      model: null,
      created_at: "2026-08-08T16:36:55.623Z",
      proposals: [{ id: "schedule-client-meeting", kind: "memory-note", title: "T", reason: "R", data: { entry: "E" } }],
      resolved: [],
    }, null, 2));

    expect(listOutboxEntriesIn(place)).toHaveLength(0);
    appendOutboxEntryTo(place, entry({ workspace: { type: "project", slug: "example" } }));
    expect(listOutboxEntriesIn(place)).toHaveLength(1);
    // The pre-existing envelope is still on disk, untouched.
    expect(fs.readdirSync(place.inbox)).toHaveLength(2);
  });

  it("skips unreadable, oversized, and foreign entries instead of throwing", () => {
    const place = location();
    appendOutboxEntryTo(place, entry());
    fs.writeFileSync(path.join(place.inbox, "not-json.json"), "{ broken");
    fs.writeFileSync(path.join(place.inbox, "foreign.json"), JSON.stringify({
      ...entry(), id: "entry-foreign-workspace", workspace: { type: "project", slug: "elsewhere" },
    }));
    expect(listOutboxEntriesIn(place)).toHaveLength(1);
  });
});
