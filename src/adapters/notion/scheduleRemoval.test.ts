import { beforeEach, describe, expect, it, vi } from "vitest";
import { trashScheduleEntry } from "./schedule";
import { notionFetch } from "./client";
vi.mock("./client", () => ({ notionFetch: vi.fn() }));
const fetch = vi.mocked(notionFetch);
const database = "11111111111111111111111111111111";
const id = "22222222222222222222222222222222";
const edited = "2026-09-05T12:00:00.000Z";
const input = { eventPageId: id, name: "Site meeting", expectedLastEditedTime: edited };
const page = { id, parent: { database_id: database }, last_edited_time: edited, in_trash: false,
  properties: { Name: { type: "title", title: [{ plain_text: input.name }] } } };
beforeEach(() => {
  fetch.mockReset();
  vi.stubEnv("NOTION_SCHEDULE_DATABASE_ID", database);
});

describe("confirmed schedule removal", () => {
  it("moves only the reviewed schedule page to recoverable Trash", async () => {
    fetch.mockResolvedValueOnce(page).mockResolvedValueOnce({ ...page, in_trash: true });
    await trashScheduleEntry(input);
    expect(fetch).toHaveBeenLastCalledWith(expect.stringMatching(/\/pages\//), {
      method: "PATCH", body: JSON.stringify({ in_trash: true }),
    });
  });
  it.each([
    { ...page, parent: { database_id: "33333333333333333333333333333333" } },
    { ...page, last_edited_time: "2026-09-05T13:00:00.000Z" },
    { ...page, properties: { Name: { type: "title", title: [{ plain_text: "Different meeting" }] } } },
    { ...page, in_trash: true },
  ])("blocks unrelated, changed, renamed or already removed pages", async (current) => {
    fetch.mockResolvedValueOnce(current);
    await expect(trashScheduleEntry(input)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
