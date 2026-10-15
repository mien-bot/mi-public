import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { previewDayOneExport } from "./dayone";

function toArrayBuffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

const journalJson = JSON.stringify({
  metadata: { version: "1.0" },
  entries: [
    {
      uuid: "abc123",
      creationDate: "2024-01-15T14:30:00Z",
      text: "Went for a long walk.\n\n![](dayone-moment://PHOTOUUID)",
      tags: ["walking", "walking"],
    },
    {
      uuid: "def456",
      creationDate: "not-a-real-date",
      text: "Quick note with no clear date.",
      tags: [],
    },
    {
      uuid: "empty",
      creationDate: "2024-02-01T09:00:00Z",
      text: "   ",
      tags: [],
    },
  ],
});

describe("Day One journal import", () => {
  it("parses a bare Journal.json export into reviewable journal drafts", async () => {
    const previews = await previewDayOneExport({ name: "Journal.json", data: toArrayBuffer(journalJson) });

    expect(previews).toHaveLength(2);
    expect(previews[0].draft).toMatchObject({
      kind: "journal",
      title: "Monday, January 15, 2024",
      tags: ["walking"],
    });
    expect(previews[0].draft.body).not.toContain("dayone-moment://");
    expect(previews[0].warnings.join(" ")).toMatch(/Photos, videos, and audio/);
  });

  it("skips entries with no text at all", async () => {
    const previews = await previewDayOneExport({ name: "Journal.json", data: toArrayBuffer(journalJson) });
    expect(previews.some((preview) => preview.draft.body.includes("photos or media only"))).toBe(false);
  });

  it("warns instead of inventing a date when creationDate is unreadable", async () => {
    const previews = await previewDayOneExport({ name: "Journal.json", data: toArrayBuffer(journalJson) });
    const undated = previews.find((preview) => preview.draft.title === "Imported journal entry");
    expect(undated?.warnings.join(" ")).toMatch(/did not include a readable date/i);
  });

  it("extracts Journal.json from a Day One .zip export", async () => {
    const zip = new JSZip();
    zip.file("Journal.json", journalJson);
    zip.folder("photos")!.file("PHOTOUUID.jpeg", "not-a-real-image");
    const zipBuffer = await zip.generateAsync({ type: "arraybuffer" });

    const previews = await previewDayOneExport({ name: "Export.zip", data: zipBuffer });
    expect(previews).toHaveLength(2);
  });

  it("rejects a file that isn't Day One's JSON export shape", async () => {
    await expect(previewDayOneExport({ name: "notes.json", data: toArrayBuffer('{"foo":"bar"}') }))
      .rejects.toThrow(/does not look like a Day One JSON export/);
  });

  it("rejects an unsupported file type", async () => {
    await expect(previewDayOneExport({ name: "notes.txt", data: toArrayBuffer("hi") }))
      .rejects.toThrow(/Choose a Day One JSON export/);
  });

  it("caps how many entries can be imported at once", async () => {
    const many = JSON.stringify({
      entries: Array.from({ length: 101 }, (_, index) => ({
        creationDate: "2024-01-01T00:00:00Z",
        text: `Entry ${index}`,
        tags: [],
      })),
    });
    await expect(previewDayOneExport({ name: "Journal.json", data: toArrayBuffer(many) }))
      .rejects.toThrow(/no more than 100 at a time/);
  });
});
