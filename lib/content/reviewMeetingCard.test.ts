import { describe, expect, it } from "vitest";
import { reviewCardContentSchema, type ReviewCardContent } from "./reviewInbox";
import {
  describeMeetingContent,
  describeMeetingTiming,
  parseActionItem,
  planMeetingSplit,
} from "./reviewMeetingCard";

function content(overrides: Partial<ReviewCardContent> = {}): ReviewCardContent {
  return reviewCardContentSchema.parse({
    title: "Owner walkthrough",
    body: "",
    why: "",
    visibility: "internal",
    ...overrides,
  });
}

describe("describeMeetingContent", () => {
  it("recovers every section from a plain title/body entry, which is all the contract requires", () => {
    const details = describeMeetingContent(content({
      body: [
        "Date: 2026-08-14 14:00-15:30 America/Chicago",
        "Attendees: Example Client, Example User",
        "",
        "## Summary",
        "Walked the second floor and the rear stair.",
        "",
        "## Decisions",
        "- Keep the existing stair.",
        "- Move the electrical panel to the corridor.",
        "",
        "## Action items",
        "- Price the panel relocation — Alex (due 2026-09-01)",
        "- Send the revised plan to Casey",
        "",
        "## Open questions",
        "- Does the corridor width still clear with the panel?",
        "",
        "## Risks",
        "- The stair may not meet the current rise/run limit.",
      ].join("\n"),
    }), "2026-08-15T15:14:29.167-05:00");

    expect(details.when.date).toBe("2026-08-14");
    expect(details.when.startTime).toBe("14:00");
    expect(details.when.timezone).toBe("America/Chicago");
    expect(details.attendees).toEqual(["Example Client", "Example User"]);
    expect(details.summary).toBe("Walked the second floor and the rear stair.");
    expect(details.decisions).toEqual(["Keep the existing stair.", "Move the electrical panel to the corridor."]);
    expect(details.actionItems).toEqual([
      { description: "Price the panel relocation", owner: "Alex", dueDate: "2026-09-01" },
      { description: "Send the revised plan to Casey", owner: "", dueDate: "" },
    ]);
    expect(details.openQuestions).toEqual(["Does the corridor width still clear with the panel?"]);
    expect(details.risks).toEqual(["The stair may not meet the current rise/run limit."]);
  });

  it("prefers structured meeting fields when the agent supplied them", () => {
    const details = describeMeetingContent(content({
      body: "## Summary\nIgnored in favour of the structured summary.",
      meeting: {
        date: "2026-08-14",
        start_time: "09:00",
        end_time: "10:00",
        timezone: "America/Chicago",
        attendees: ["Example Client"],
        summary: "Structured summary.",
        decisions: ["Structured decision."],
        action_items: [{ description: "Structured action", owner: "Alex", due_date: "next week" }],
        open_questions: [],
        risks: [],
      },
    }), null);

    expect(details.summary).toBe("Structured summary.");
    expect(details.decisions).toEqual(["Structured decision."]);
    expect(details.actionItems[0]).toEqual({ description: "Structured action", owner: "Alex", dueDate: "next week" });
  });

  it("treats a one-paragraph body as the summary rather than rendering an empty card", () => {
    const details = describeMeetingContent(
      content({ body: "Casey confirmed the scope is unchanged and asked for a revised fee." }),
      null,
    );
    expect(details.summary).toContain("revised fee");
  });

  it("never invents a meeting date it was not given", () => {
    const withoutDate = describeMeetingContent(content({ body: "We met last Tuesday." }), "2026-08-15T15:14:29.167-05:00");
    expect(withoutDate.when.date).toBeNull();
    expect(describeMeetingTiming(withoutDate)).toContain("No meeting date stated");

    const vague = describeMeetingContent(content({ body: "Date: last Tuesday\n\n## Summary\nShort call." }), null);
    expect(vague.when.date).toBeNull();
    expect(describeMeetingTiming(vague)).toContain("no absolute date given");
  });

  it("reads a written-out date the entry stated in prose, when it names only one", () => {
    // The shape agents actually write when they never use a Date: heading.
    const prose = describeMeetingContent(content({
      body: "The August 16, 2026 meeting covered the cafe and front desk. Alex and Taylor attended.",
    }), "2026-08-16T18:00:00.000Z");
    expect(prose.when.date).toBe("2026-08-16");

    expect(describeMeetingContent(content({ body: "Met 16 August 2026 on site." }), null).when.date)
      .toBe("2026-08-16");
    expect(describeMeetingContent(content({ body: "Met Aug 3rd, 2026 on site." }), null).when.date)
      .toBe("2026-08-03");
  });

  it("declines when the entry names more than one date, or an impossible one", () => {
    const twoDates = describeMeetingContent(content({
      body: "The August 16, 2026 meeting set the permit deadline for September 1, 2026.",
    }), null);
    expect(twoDates.when.date).toBeNull();

    // Same day written twice, in two shapes, is still one date.
    const sameDay = describeMeetingContent(content({
      body: "The August 16, 2026 meeting (2026-08-16) ran long.",
    }), null);
    expect(sameDay.when.date).toBe("2026-08-16");

    expect(describeMeetingContent(content({ body: "Met February 30, 2026." }), null).when.date).toBeNull();
    // An all-numeric date is ambiguous by day/month order, so it is never read.
    expect(describeMeetingContent(content({ body: "Met 8/16/2026." }), null).when.date).toBeNull();
  });

  it("states the absolute date and window when the entry gave one", () => {
    const details = describeMeetingContent(content({
      body: "Date: 2026-08-14 14:00-15:30 America/Chicago\n\n## Summary\nWalked the floor.",
    }), null);
    expect(describeMeetingTiming(details)).toBe("2026-08-14 · 14:00–15:30 · America/Chicago");
  });

  it("keeps body text that no heading claimed", () => {
    const details = describeMeetingContent(content({
      body: "## Summary\nShort.\n\nA stray closing paragraph nobody labelled.",
    }), null);
    expect(`${details.summary} ${details.remainder}`).toContain("stray closing paragraph");
  });
});

describe("parseActionItem", () => {
  it("reads only explicit owner and due markers, leaving everything else in the description", () => {
    expect(parseActionItem("- Send the fee proposal (owner: Alex) (due 2026-09-01)")).toEqual({
      description: "Send the fee proposal",
      owner: "Alex",
      dueDate: "2026-09-01",
    });
    expect(parseActionItem("- Call the structural engineer about the stair")).toEqual({
      description: "Call the structural engineer about the stair",
      owner: "",
      dueDate: "",
    });
  });

  it("does not guess an owner from a capitalized word in the task itself", () => {
    // Attributing someone else's task to a real person is worse than leaving it unassigned.
    const parsed = parseActionItem("- Ask Example Client whether the survey covers the alley");
    expect(parsed.owner).toBe("");
    expect(parsed.description).toContain("Example Client");
  });
});

describe("planMeetingSplit", () => {
  it("produces one card per lifetime, keeping the meeting record itself", () => {
    const details = describeMeetingContent(content({
      body: [
        "## Summary", "Walked the floor.",
        "## Decisions", "- Keep the stair.",
        "## Action items", "- Price the panel — Alex",
        "## Risks", "- Stair may fail rise/run.",
        "## Open questions", "- Corridor width?",
      ].join("\n"),
    }), null);

    expect(planMeetingSplit(details).map((part) => part.kind))
      .toEqual(["meeting", "decision", "action", "risk", "fact"]);
  });

  it("carries the owner and due date into the action card's body", () => {
    const details = describeMeetingContent(content({
      body: "## Action items\n- Price the panel relocation (owner: Alex) (due 2026-09-01)",
    }), null);
    const action = planMeetingSplit(details).find((part) => part.kind === "action");
    expect(action?.body).toContain("Owner: Alex");
    expect(action?.body).toContain("Due: 2026-09-01");
  });
});
