import { describe, expect, it } from "vitest";
import {
  buildProjectProperties,
  parseProjectWriteArgs,
  resolveProjectTarget,
  type WritableProjectSchema,
} from "./projectWrite";
import type { NotionPage } from "./projectMap";

const schema: WritableProjectSchema = {
  Name: { type: "title" },
  Status: {
    type: "status",
    options: ["Not Started", "In Progress", "Complete", "Abandoned"],
  },
  Client: { type: "rich_text" },
  Location: { type: "rich_text" },
  "Project Type": {
    type: "multi_select",
    options: ["Commercial", "Renovation"],
  },
  Scope: { type: "multi_select", options: ["SD", "DD", "CD"] },
};

describe("Notion project writes", () => {
  it("parses an update as preview by default", () => {
    expect(
      parseProjectWriteArgs([
        "update",
        "example-record-35",
        "--status",
        "in-progress",
        "--scope",
        "SD, DD",
      ]),
    ).toMatchObject({
      mode: "update",
      target: "example-record-35",
      status: "in-progress",
      scope: ["SD", "DD"],
      apply: false,
    });
  });

  it("builds schema-aware Notion property values", () => {
    const properties = buildProjectProperties(
      {
        mode: "create",
        name: "Test Project",
        status: "in-progress",
        client: "",
        projectTypes: ["commercial"],
        scope: ["SD", "DD"],
        apply: false,
        envFile: ".env.local",
      },
      schema,
    );
    expect(properties).toEqual({
      Name: { title: [{ text: { content: "Test Project" } }] },
      Status: { status: { name: "In Progress" } },
      Client: { rich_text: [] },
      "Project Type": { multi_select: [{ name: "Commercial" }] },
      Scope: { multi_select: [{ name: "SD" }, { name: "DD" }] },
    });
  });

  it("rejects values not configured in the Notion schema", () => {
    expect(() =>
      buildProjectProperties(
        {
          mode: "update",
          target: "x",
          projectTypes: ["Unconfigured"],
          apply: false,
          envFile: ".env.local",
        },
        schema,
      ),
    ).toThrow("not configured in Notion");
  });

  it("resolves targets by mapped slug", () => {
    const page: NotionPage = {
      id: "example-record-38",
      url: "https://notion.so/project",
      created_time: "2026-01-01T00:00:00.000Z",
      last_edited_time: "2026-07-25T00:00:00.000Z",
      properties: {
        Name: {
          type: "title",
          title: [{ plain_text: "example-record-35" }],
        },
      },
    };
    expect(resolveProjectTarget([page], "example-record-35").id).toBe(page.id);
  });
});
