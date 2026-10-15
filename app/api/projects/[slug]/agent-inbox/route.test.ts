import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  capture: vi.fn(() => ({ status: "saved", fileName: "proposal.json", proposalCount: 2 })),
  list: vi.fn(() => [{ envelope: { id: "agent-envelope" }, pendingProposals: [], resolvedProposals: [], hash: "hash" }]),
  resolve: vi.fn(() => "next-hash"),
}));

vi.mock("@/lib/content", () => ({
  captureProjectTerminalProposalReply: mocks.capture,
  getProjectSlugs: vi.fn(() => ["demo"]),
  listAgentProposalInbox: mocks.list,
  resolveAgentInboxProposals: mocks.resolve,
}));

import { GET, PATCH, POST } from "./route";

const context = { params: Promise.resolve({ slug: "demo" }) };

describe("project agent proposal inbox API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists validated drafts without mutating them", async () => {
    const response = await GET(new Request("http://localhost"), context);
    expect(response.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith("demo");
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("captures terminal proposals as drafts without applying them", async () => {
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawReply: "```mi-proposals\n{}\n```", source: "terminal" }),
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      captured: true,
      status: "saved",
      fileName: "proposal.json",
      proposalCount: 2,
    });
    expect(mocks.capture).toHaveBeenCalledWith({
      projectSlug: "demo",
      rawReply: "```mi-proposals\n{}\n```",
      source: "mi-project-terminal",
    });
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("rejects missing, oversized, and invalid terminal proposal blocks", async () => {
    const missing = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
      context,
    );
    expect(missing.status).toBe(400);
    expect(mocks.capture).not.toHaveBeenCalled();

    const oversized = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawReply: "x".repeat(1_000_001), source: "file" }),
      }),
      context,
    );
    expect(oversized.status).toBe(400);
    expect(mocks.capture).not.toHaveBeenCalled();

    mocks.capture.mockReturnValueOnce({ status: "invalid", error: "Invalid proposal." });
    const invalid = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawReply: "```mi-proposals\n{}\n```", source: "terminal" }),
      }),
      context,
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "Invalid proposal." });
  });

  it("uses the file source and reports duplicate or conflicting pending ids", async () => {
    const fileResponse = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawReply: '{"version":1,"proposals":[]}', source: "file" }),
      }),
      context,
    );
    expect(fileResponse.status).toBe(200);
    expect(mocks.capture).toHaveBeenLastCalledWith({
      projectSlug: "demo",
      rawReply: '{"version":1,"proposals":[]}',
      source: "mi-project-terminal-file",
    });

    mocks.capture.mockReturnValueOnce({
      status: "duplicate",
      fileName: "existing.json",
      proposalCount: 2,
    });
    const duplicate = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawReply: '{"version":1,"proposals":[]}', source: "file" }),
      }),
      context,
    );
    expect(await duplicate.json()).toMatchObject({ captured: false, duplicate: true });

    mocks.capture.mockReturnValueOnce({
      status: "conflict",
      error: "Pending id conflict.",
      proposalIds: ["same-id"],
    });
    const conflict = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawReply: '{"version":1,"proposals":[]}', source: "file" }),
      }),
      context,
    );
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: "Pending id conflict.", proposalIds: ["same-id"] });
  });

  it("requires exact confirmation before marking a draft resolved", async () => {
    const missingConfirmation = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          envelopeId: "agent-envelope",
          proposalId: "proposal-one",
          status: "applied",
          expectedHash: "hash",
        }),
      }),
      context,
    );
    expect(missingConfirmation.status).toBe(400);
    expect(mocks.resolve).not.toHaveBeenCalled();

    const confirmed = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmed: true,
          envelopeId: "agent-envelope",
          proposalId: "proposal-one",
          status: "applied",
          expectedHash: "hash",
        }),
      }),
      context,
    );
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toEqual({ resolved: true, hash: "next-hash" });
    expect(mocks.resolve).toHaveBeenCalledWith({
      slug: "demo",
      envelopeId: "agent-envelope",
      proposalIds: ["proposal-one"],
      status: "applied",
      reason: undefined,
      expectedHash: "hash",
    });
  });

  it("dismisses a single proposal with its reason, without applying anything", async () => {
    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmed: true,
          envelopeId: "agent-envelope",
          proposalId: "proposal-one",
          status: "dismissed",
          reason: "Wrong address — superseded by the deed.",
          expectedHash: "hash",
        }),
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.resolve).toHaveBeenCalledWith({
      slug: "demo",
      envelopeId: "agent-envelope",
      proposalIds: ["proposal-one"],
      status: "dismissed",
      reason: "Wrong address — superseded by the deed.",
      expectedHash: "hash",
    });
  });

  /**
   * Closing N proposals has to reach the store as one call: each write changes
   * the envelope hash, so a client looping one PATCH per card would have every
   * request after the first rejected on its expected-hash check.
   */
  it("dismisses the remaining proposals of an envelope in a single call", async () => {
    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmed: true,
          envelopeId: "agent-envelope",
          proposalIds: ["proposal-one", "proposal-two", "proposal-three"],
          status: "dismissed",
          expectedHash: "hash",
        }),
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
    expect(mocks.resolve.mock.calls[0][0]).toMatchObject({
      proposalIds: ["proposal-one", "proposal-two", "proposal-three"],
      status: "dismissed",
    });
  });

  it("rejects a close with no proposal named", async () => {
    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmed: true,
          envelopeId: "agent-envelope",
          proposalIds: [],
          status: "dismissed",
          expectedHash: "hash",
        }),
      }),
      context,
    );

    expect(response.status).toBe(400);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
});
