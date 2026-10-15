import { describe, expect, it, vi } from "vitest";
import {
  applyNotionTaskUpdate,
  NotionTaskUpdateError,
  previewNotionTaskUpdate,
  type NotionTaskUpdateDependencies,
} from "./notionTaskUpdate";
import type { NotionTaskBlock, NotionTaskDocument } from "@/src/adapters/notion/taskContent";

const TASK_ID = "44444444444444444444444444444444";
const PROJECT_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_PROJECT_ID = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const BLOCK_ID = "cccccccccccccccccccccccccccccccc";

function block(text: string): NotionTaskBlock {
  return {
    id: BLOCK_ID,
    type: "paragraph",
    paragraph: { rich_text: [{ plain_text: text, type: "text", text: { content: text } }] },
  };
}

function document(projectId = PROJECT_ID): NotionTaskDocument {
  const body = block("Work on Example.");
  return {
    page: {
      id: TASK_ID,
      url: `https://www.notion.so/${TASK_ID}`,
      last_edited_time: "2026-08-11T12:00:00.000Z",
      properties: {
        Name: { type: "title", title: [{ plain_text: "Work on Example." }] },
        Date: { type: "date", date: { start: "2026-08-12" } },
        Status: { type: "status", status: { name: "Not started" } },
        Attendance: { type: "people", people: [] },
        Type: { type: "select", select: { name: "Meeting" } },
        Projects: { type: "relation", relation: [{ id: projectId }] },
      },
    },
    topLevelBlocks: [body],
    allBlocks: [body],
    projectPageIds: [projectId],
  };
}

function change(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    project_slug: "example-project-59",
    task_page_id: TASK_ID,
    expected_last_edited_time: "2026-08-11T12:00:00.000Z",
    operation: "update_content",
    content_updates: [{
      old_str: "Work on Example.",
      new_str: "7:00 PM–midnight agenda",
      replace_all_matches: false,
    }],
    property_patch: {},
    ...overrides,
  };
}

function dependencies(initial = document()): { deps: NotionTaskUpdateDependencies; current: () => NotionTaskDocument } {
  const current = structuredClone(initial);
  const deps: NotionTaskUpdateDependencies = {
    fetchDocument: vi.fn(async () => structuredClone(current)),
    replaceBlock: vi.fn(async (_target, text) => {
      current.allBlocks[0] = block(text);
      current.topLevelBlocks[0] = current.allBlocks[0];
      current.page.last_edited_time = "2026-08-11T12:01:00.000Z";
    }),
    appendContent: vi.fn(async () => undefined),
    archiveBlock: vi.fn(async () => undefined),
  };
  return { deps, current: () => current };
}

describe("confirmed Notion task content update", () => {
  it("updates only the linked task body and verifies every protected property", async () => {
    const fixture = dependencies();
    const beforeProperties = structuredClone(fixture.current().page.properties);
    const preview = await previewNotionTaskUpdate(change(), PROJECT_ID, fixture.deps);
    const result = await applyNotionTaskUpdate(preview, PROJECT_ID, fixture.deps);
    expect(result.changedFields).toEqual(["content"]);
    expect(result.verification).toMatchObject({
      requestedContentPresent: true,
      unspecifiedPropertiesUnchanged: true,
      projectRelationIntact: true,
    });
    expect(fixture.current().page.properties).toEqual(beforeProperties);
  });

  it("rejects an unlinked task", async () => {
    const fixture = dependencies(document(OTHER_PROJECT_ID));
    await expect(previewNotionTaskUpdate(change(), PROJECT_ID, fixture.deps))
      .rejects.toMatchObject({ status: 403 } satisfies Partial<NotionTaskUpdateError>);
  });

  it("rejects stale expected_last_edited_time", async () => {
    const fixture = dependencies();
    await expect(previewNotionTaskUpdate(change({ expected_last_edited_time: "2026-08-10T12:00:00.000Z" }), PROJECT_ID, fixture.deps))
      .rejects.toThrow(/Conflict.*last edited/);
  });

  it("detects a stale edit made after preview and before apply", async () => {
    const fixture = dependencies();
    const preview = await previewNotionTaskUpdate(change(), PROJECT_ID, fixture.deps);
    fixture.current().page.last_edited_time = "2026-08-11T12:00:30.000Z";
    await expect(applyNotionTaskUpdate(preview, PROJECT_ID, fixture.deps)).rejects.toThrow(/Conflict.*last edited/);
  });

  it("returns actionable connection instructions when Notion authentication is missing", async () => {
    const fixture = dependencies();
    fixture.deps.fetchDocument = vi.fn(async () => {
      throw new Error("NOTION_API_KEY not set — add it to .env.local first.");
    });
    await expect(previewNotionTaskUpdate(change(), PROJECT_ID, fixture.deps))
      .rejects.toThrow(/Mi Settings.*Connections.*Notion integration token/);
  });

  it("rejects property changes in a content-only payload", async () => {
    const fixture = dependencies();
    await expect(previewNotionTaskUpdate(change({ property_patch: { Status: "Complete" } }), PROJECT_ID, fixture.deps))
      .rejects.toThrow(/content-only/);
  });
});
