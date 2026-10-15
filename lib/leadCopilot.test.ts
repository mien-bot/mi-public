import { describe, expect, it } from "vitest";
import { parseLeadCopilotReply } from "./leadCopilot";

describe("lead copilot replies", () => {
  it("parses a human-reviewable meeting proposal", () => {
    const reply = parseLeadCopilotReply(`I summarized the visit.
\`\`\`mi-lead-proposals
{"version":1,"proposals":[{"id":"site-visit-1","title":"Site visit","reason":"Record reviewed notes","kind":"lead-meeting","data":{"id":"site-visit","title":"Site visit","meeting_type":"Site Visit","date":"2026-07-28","start_time":"10:00","end_time":"11:00","timezone":"America/Chicago","attendees":["Alex"],"raw_notes":"Measured kitchen.","summary":"Existing kitchen measured.","decisions":[],"action_items":[],"open_questions":[]}}]}
\`\`\``);

    expect(reply.text).toBe("I summarized the visit.");
    expect(reply.proposals[0]?.kind).toBe("lead-meeting");
    expect(reply.proposalError).toBeNull();
  });

  it("parses a planned client agenda with preparation and reviewed timeboxes", () => {
    const reply = parseLeadCopilotReply(`Plan the client meeting.
\`\`\`mi-lead-proposals
{"version":1,"proposals":[{"id":"client-contract-agenda","title":"Client contract agenda","reason":"Structure the upcoming client meeting","kind":"lead-meeting","data":{"id":"client-contract-meeting","title":"Client contract meeting","meeting_type":"Client Meeting","meeting_status":"planned","date":"2026-08-12","start_time":"10:00","end_time":"11:00","timezone":"America/Chicago","attendees":[],"objective":"Review the contract and agree on next steps.","preparation":["Review the latest contract."],"agenda_items":[{"topic":"Contract review","duration_minutes":25,"desired_outcome":"Resolve scope questions."},{"topic":"Project priorities","duration_minutes":35,"desired_outcome":"Confirm next actions."}],"raw_notes":"","summary":"","decisions":[],"action_items":[],"open_questions":[]}}]}
\`\`\``);

    expect(reply.proposalError).toBeNull();
    expect(reply.proposals[0]).toMatchObject({
      kind: "lead-meeting",
      data: {
        meeting_status: "planned",
        preparation: ["Review the latest contract."],
      },
    });
  });

  it("keeps a meeting reviewable when its times are explicitly unconfirmed", () => {
    const reply = parseLeadCopilotReply(`\`\`\`mi-lead-proposals
{"version":1,"proposals":[{"id":"internal-discussion","title":"Internal discussion","reason":"Record reviewed notes without inventing times","kind":"lead-meeting","data":{"id":"internal-discussion","title":"Internal discussion","meeting_type":"Internal Discussion","date":"2026-07-29","start_time":"","end_time":"","timezone":"America/Chicago","attendees":[],"raw_notes":"Discussed the client site meeting.","summary":"Internal follow-up discussion.","decisions":[],"action_items":[],"open_questions":[]}}]}
\`\`\``);

    expect(reply.proposals).toHaveLength(1);
    expect(reply.proposals[0]).toMatchObject({
      kind: "lead-meeting",
      data: { start_time: "", end_time: "", attendees: [] },
    });
    expect(reply.proposalError).toBeNull();
  });

  it("keeps a meeting reviewable when the agent omits the review-card id", () => {
    const reply = parseLeadCopilotReply(`\`\`\`mi-lead-proposals
{"version":1,"proposals":[{"title":"Tentative measuring visit — 2026-08-15","reason":"Record the tentative visit","kind":"lead-meeting","data":{"id":"measuring-visit","title":"Measuring visit","meeting_type":"Site Visit","date":"2026-08-15","start_time":"","end_time":"","timezone":"America/Chicago","attendees":[],"raw_notes":"Tentative.","summary":"","decisions":[],"action_items":[],"open_questions":[]}}]}
\`\`\``);

    expect(reply.proposals).toHaveLength(1);
    expect(reply.proposals[0]?.id).toBe("tentative-measuring-visit-2026-08-15");
    expect(reply.proposals[0]?.data).toMatchObject({ id: "measuring-visit", date: "2026-08-15" });
    expect(reply.proposalError).toBeNull();
  });

  it("still rejects a proposal whose data is invalid even when its id is missing", () => {
    const reply = parseLeadCopilotReply(`\`\`\`mi-lead-proposals
{"version":1,"proposals":[{"title":"Measuring visit","reason":"Record the visit","kind":"lead-meeting","data":{"id":"measuring-visit","title":"Measuring visit","meeting_type":"Site Visit","date":"sometime next week","start_time":"","end_time":"","timezone":"America/Chicago","attendees":[],"raw_notes":"","summary":"","decisions":[],"action_items":[],"open_questions":[]}}]}
\`\`\``);

    expect(reply.proposals).toEqual([]);
    expect(reply.proposalError).toMatch(/could not validate/i);
  });

  it("keeps valid review cards when a sibling proposal is malformed", () => {
    const reply = parseLeadCopilotReply(`I prepared two review items.
\`\`\`mi-lead-proposals
{"version":1,"proposals":[{"id":"correct-identity","title":"Correct client and referrer","reason":"Use confirmed names","kind":"lead-update","data":{"contact_name":"Example Owner","referrer_name":"Example Referrer"}},{"id":"internal-discussion","title":"Internal discussion","reason":"Record the discussion","kind":"lead-meeting","data":{"id":"internal-discussion","title":"Internal discussion","meeting_type":"Internal Discussion","date":"2026-07-29","start_time":"after 5:30","end_time":"","timezone":"America/Chicago","attendees":[],"raw_notes":"","summary":"","decisions":[],"action_items":[],"open_questions":[]}}]}
\`\`\``);

    expect(reply.proposals).toHaveLength(1);
    expect(reply.proposals[0]).toMatchObject({
      kind: "lead-update",
      data: { contact_name: "Example Owner", referrer_name: "Example Referrer" },
    });
    expect(reply.proposalError).toContain("Proposal 2");
    expect(reply.proposalError).toContain("start time");
    expect(reply.proposalError).toContain("The other review card remains available");
  });

  it("parses a firm-wide memory-note proposal", () => {
    const reply = parseLeadCopilotReply(`\`\`\`mi-lead-proposals
{"version":1,"proposals":[{"id":"ask-permits-early","title":"Ask about permits early","reason":"Came up twice this month","kind":"firm-memory-note","data":{"entry":"Always confirm permit status before quoting a fee."}}]}
\`\`\``);

    expect(reply.proposals).toHaveLength(1);
    expect(reply.proposals[0]).toMatchObject({
      kind: "firm-memory-note",
      data: { entry: "Always confirm permit status before quoting a fee." },
    });
    expect(reply.proposalError).toBeNull();
  });

  it("rejects updates to human-confirmed identity fields", () => {
    const reply = parseLeadCopilotReply(`\`\`\`mi-lead-proposals
{"version":1,"proposals":[{"id":"bad-path","title":"Path","reason":"Guess","kind":"lead-update","data":{"dropbox_path":"guessed"}}]}
\`\`\``);

    expect(reply.proposals).toEqual([]);
    expect(reply.proposalError).toMatch(/could not validate/i);
  });
});
