import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("@/src/adapters/notion/client", () => ({ notionFetch: mocks.read, notionFetchOnce: mocks.write }));
import { previewKnowledgePublish, publishProjectKnowledge } from "./projectKnowledgeNotion";

const PAGE = "11111111111111111111111111111111";
const SECTION = "22222222222222222222222222222222";
type Block = { id: string; type: string; has_children?: boolean; [key: string]: unknown };
let top: Block[], notes: Block[], bodies: Map<string, Block[]>;
const source = [{ title: "Confirmed fact", body: "Two exits.\nOwner confirmed the scope." }];
let serial: number;
beforeEach(() => {
  vi.clearAllMocks(); top = []; notes = []; bodies = new Map(); serial = 3;
  mocks.read.mockImplementation(async (url: string) => {
    if (url === `/pages/${PAGE}`) return { id: PAGE };
    const id = /\/blocks\/([^/]+)/.exec(url)?.[1];
    return { results: id === PAGE ? top : id === SECTION ? notes : bodies.get(id ?? "") ?? [], has_more: false, next_cursor: null };
  });
  mocks.write.mockImplementation(async (url: string, init: RequestInit) => {
    const input = JSON.parse(init.body as string).children;
    if (url === `/blocks/${PAGE}/children`) {
      top = [{ ...input[0], id: SECTION, has_children: true }];
      return { results: top };
    }
    const added = input.map((block: { type: string; toggle: { children: Block[] } }) => {
      const id = String(serial++).padStart(32, "0");
      bodies.set(id, block.toggle.children);
      return { ...block, id, has_children: true };
    });
    notes.push(...added);
    return { results: added };
  });
});
describe("project knowledge Notion publishing", () => {
  it("previews without writing, appends only to the exact linked page, and skips a repeated publish", async () => {
    const plan = await previewKnowledgePublish(PAGE, source);
    expect(plan.entries).toEqual(source);
    expect(mocks.write).not.toHaveBeenCalled();
    expect(await publishProjectKnowledge(PAGE, source, plan)).toMatchObject({ published: 1 });
    expect(mocks.write.mock.calls.map(call => call[0])).toEqual([`/blocks/${PAGE}/children`, `/blocks/${SECTION}/children`]);
    const second = await previewKnowledgePublish(PAGE, source);
    expect(second).toMatchObject({ entries: [], alreadyPublished: 1 });
    await publishProjectKnowledge(PAGE, source, second);
    expect(mocks.write).toHaveBeenCalledTimes(2);
  });
  it("rejects stale source content before any write", async () => {
    const plan = await previewKnowledgePublish(PAGE, source);
    await expect(publishProjectKnowledge(PAGE, [{ ...source[0], body: "Changed" }], plan)).rejects.toThrow("changed");
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("recovers from a lost append response without appending the same knowledge twice", async () => {
    const first = await previewKnowledgePublish(PAGE, source);
    const normal = mocks.write.getMockImplementation()!;
    mocks.write.mockImplementation(async (url, init) => {
      const result = await normal(url, init);
      if (url === `/blocks/${SECTION}/children`) throw new Error("response lost");
      return result;
    });
    await expect(publishProjectKnowledge(PAGE, source, first)).rejects.toThrow("may already be published");
    const next = await previewKnowledgePublish(PAGE, source);
    expect(next.entries).toEqual([]);
    expect(notes).toHaveLength(1);
  });
  it("keeps unrelated Notion content and presents changed source notes as additions", async () => {
    await publishProjectKnowledge(PAGE, source, await previewKnowledgePublish(PAGE, source));
    const prior = structuredClone(notes);
    const revised = [{ ...source[0], body: "Three exits, corrected after site visit." }];
    const plan = await previewKnowledgePublish(PAGE, revised);
    expect(plan.entries).toEqual(revised);
    await publishProjectKnowledge(PAGE, revised, plan);
    expect(notes[0]).toEqual(prior[0]);
    expect(notes).toHaveLength(2);
  });
  it("previews bounded batches without dropping remaining notes", async () => {
    const plan = await previewKnowledgePublish(PAGE, Array.from({ length: 24 }, (_, i) => ({ title: `Note ${i}`, body: "Fact" })));
    expect(plan.entries).toHaveLength(20);
    expect(plan.remaining).toBe(4);
  });
  it("requires a fresh preview when the Knowledge section changes", async () => {
    await publishProjectKnowledge(PAGE, source, await previewKnowledgePublish(PAGE, source));
    const revised = [{ title: "New note", body: "Reviewed locally." }];
    const plan = await previewKnowledgePublish(PAGE, revised);
    notes.push({ id: "44444444444444444444444444444444", type: "paragraph", paragraph: { rich_text: [{ text: { content: "Human addition" } }] } });
    mocks.write.mockClear();
    await expect(publishProjectKnowledge(PAGE, revised, plan)).rejects.toThrow("changed");
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("refuses archived destinations", async () => {
    mocks.read.mockResolvedValueOnce({ id: PAGE, archived: true });
    await expect(previewKnowledgePublish(PAGE, source)).rejects.toThrow("unavailable");
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
