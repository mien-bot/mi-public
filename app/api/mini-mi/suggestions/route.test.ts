import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/content/projects", () => ({ getProject: vi.fn(), getSchedule: vi.fn() }));
import { getProject, getSchedule } from "@/lib/content/projects";
import { GET } from "./route";
beforeEach(() => { vi.resetAllMocks(); });
it("rejects traversal and invalid dates before reading records", async () => {
  for (const query of ["project=../secret&today=2026-09-29", "project=demo&today=2026-02-30", "project=demo&today=nope"]) {
    expect((await GET(new Request(`http://localhost/api/mini-mi/suggestions?${query}`))).status).toBe(400);
  }
  expect(getProject).not.toHaveBeenCalled();
});
it("reports unavailable data honestly instead of treating missing schedules as no work", async () => {
  vi.mocked(getProject).mockReturnValue({ slug: "demo", meta: { dropbox_path: null } } as ReturnType<typeof getProject>);
  vi.mocked(getSchedule).mockImplementation(() => { throw Error("offline"); });
  const result = await GET(new Request("http://localhost/api/mini-mi/suggestions?project=demo&today=2026-09-29"));
  const body = await result.json();
  expect(body.items[0].id).toBe("folder:demo");
  expect(body.warning).toContain("could not be read");
});
