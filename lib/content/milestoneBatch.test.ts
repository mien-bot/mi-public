import { describe, expect, it, vi } from "vitest";
import { applyMilestoneBatch, previewMilestoneBatch, type MilestoneBatchRepository } from "./milestoneBatch";
import { milestoneSchema, type Milestone } from "@/lib/schema";
import { planMilestoneChanges } from "@/src/services/notionSync";

function fixture(linked = false) {
  let milestones: Milestone[] = [1, 2, 3].map((n) => ({ id: `m${n}`, name: `Deadline ${n}`, planned_date: "2026-01-01", actual_date: null, notion_event_id: linked ? `event-${n}` : null }));
  let hash = "initial";
  const repository: MilestoneBatchRepository = {
    load: () => ({ milestones, hash, projectPageId: "project-id" }),
    save: vi.fn((next, expected) => { if (expected !== hash) throw Error("conflict"); milestones = next; hash += "-saved"; }),
    canRemove: () => true,
    readNotion: vi.fn(async (id) => ({ name: id, lastEditedTime: "2026-01-01", projectPageIds: ["project-id"] })),
    trashNotion: vi.fn(async () => {}),
  };
  return repository;
}
describe("reviewed milestone batches", () => {
  it("previews without writes, archives without marking complete or touching Notion, and restores", async () => {
    const repo = fixture(true);
    const preview = await previewMilestoneBatch("demo", "archive", ["m1", "m2"], "initial", repo);
    expect(repo.save).not.toHaveBeenCalled(); expect(repo.readNotion).not.toHaveBeenCalled();
    const result = await applyMilestoneBatch("demo", "archive", ["m1", "m2"], "initial", preview.fingerprint, repo);
    expect(result.results.map((item) => item.status)).toEqual(["applied", "applied"]);
    const archived = repo.load().milestones[0];
    expect(milestoneSchema.parse(archived).archived_at).toBeTruthy(); expect(archived.actual_date).toBeNull();
    expect(repo.trashNotion).not.toHaveBeenCalled(); expect(repo.load().milestones[2].archived_at).toBeUndefined();
    const restore = await previewMilestoneBatch("demo", "restore", ["m1"], result.hash, repo);
    await applyMilestoneBatch("demo", "restore", ["m1"], result.hash, restore.fingerprint, repo);
    expect(repo.load().milestones[0].archived_at).toBeUndefined();
  });
  it("rejects stale local hashes, changed selections, and duplicate ids before writing", async () => {
    const repo = fixture();
    await expect(previewMilestoneBatch("demo", "delete", ["m1"], null, repo)).rejects.toThrow(/changed/);
    await expect(previewMilestoneBatch("demo", "delete", ["m1", "m1"], "initial", repo)).rejects.toThrow(/distinct/);
    const preview = await previewMilestoneBatch("demo", "delete", ["m1"], "initial", repo);
    await expect(applyMilestoneBatch("demo", "delete", ["m2"], "initial", preview.fingerprint, repo)).rejects.toThrow(/reviewed batch changed/);
    expect(repo.save).not.toHaveBeenCalled();
  });
  it("preflights every remote item and rejects disabled, unrelated, or changed Notion items", async () => {
    const repo = fixture(true);
    repo.canRemove = () => false;
    await expect(previewMilestoneBatch("demo", "delete", ["m1"], "initial", repo)).rejects.toThrow(/disabled/);
    repo.canRemove = () => true;
    const preview = await previewMilestoneBatch("demo", "delete", ["m1", "m2"], "initial", repo);
    repo.readNotion = async (id) => ({ name: id, lastEditedTime: "new-time", projectPageIds: ["project-id"] });
    await expect(applyMilestoneBatch("demo", "delete", ["m1", "m2"], "initial", preview.fingerprint, repo)).rejects.toThrow(/changed/);
    repo.readNotion = async (id) => ({ name: id, lastEditedTime: "2026-01-01", projectPageIds: id === "event-2" ? [] : ["project-id"] });
    await expect(applyMilestoneBatch("demo", "delete", ["m1", "m2"], "initial", preview.fingerprint, repo)).rejects.toThrow(/related/);
    expect(repo.trashNotion).not.toHaveBeenCalled(); expect(repo.save).not.toHaveBeenCalled();
  });
  it("preserves per-item results after a remote failure", async () => {
    const repo = fixture(true);
    repo.trashNotion = vi.fn(async (item) => { if (item.eventPageId === "event-2") throw Error("Notion unavailable"); });
    const preview = await previewMilestoneBatch("demo", "delete", ["m1", "m2", "m3"], "initial", repo);
    const result = await applyMilestoneBatch("demo", "delete", ["m1", "m2", "m3"], "initial", preview.fingerprint, repo);
    expect(result.results.map((item) => item.status)).toEqual(["applied", "failed", "applied"]);
    expect(repo.load().milestones.map((item) => item.id)).toEqual(["m2"]);
  });
  it("reports a remote success separately when local persistence fails", async () => {
    const repo = fixture(true);
    repo.save = () => { throw Error("disk locked"); };
    const preview = await previewMilestoneBatch("demo", "delete", ["m1"], "initial", repo);
    const result = await applyMilestoneBatch("demo", "delete", ["m1"], "initial", preview.fingerprint, repo);
    expect(result.results[0]).toMatchObject({ status: "partial", message: expect.stringContaining("Moved to Notion Trash") });
    expect(repo.load().milestones).toHaveLength(3);
  });
  it("keeps archive metadata and linked identity through a Notion status pull", () => {
    const milestone = { ...fixture(true).load().milestones[0], archived_at: "2026-09-29T00:00:00.000Z" };
    const result = planMilestoneChanges({ milestones: [milestone] }, [{
      id: "event-1", name: "Deadline 1", url: null, date: "2026-01-01", dateEnd: null, startTime: null, endTime: null,
      doDate: null, completedDate: "2026-09-28", lastEditedTime: "2026-09-29", status: "Done", type: ["Deadline"], hours: null, attendees: [], projectPageIds: ["project-id"],
    }]);
    expect(result.updatedMilestones).toHaveLength(1);
    expect(result.updatedMilestones[0].archived_at).toBe(milestone.archived_at);
  });
});
