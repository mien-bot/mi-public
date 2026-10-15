import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const roots: string[] = [];
function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-details-route-"));
  roots.push(root);
  return root;
}

let projectsDir: string;
vi.mock("@/lib/content/paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/content/paths")>();
  return {
    ...actual,
    get REPO_ROOT() { return path.dirname(projectsDir); },
    get PROJECTS_DIR() { return projectsDir; },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/src/audit/log", () => ({ recordAudit: vi.fn() }));

import { PUT } from "./route";

const context = { params: Promise.resolve({ slug: "demo" }) };

function request(body: unknown) {
  return new Request("http://localhost/api/projects/demo/details", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  const root = temporaryRoot();
  projectsDir = path.join(root, "projects");
  fs.mkdirSync(path.join(projectsDir, "demo"), { recursive: true });
  fs.writeFileSync(
    path.join(projectsDir, "demo", "project.yaml"),
    "name: Demo\naddress: \"\"\nclient: \"\"\nstatus: in-progress\n",
    "utf8",
  );
});

describe("project details route", () => {
  it("rejects a save without explicit confirmation", async () => {
    const response = await PUT(request({ details: {} }), context);
    expect(response.status).toBe(409);
  });

  it("saves details and returns the new content hash", async () => {
    const response = await PUT(request({ confirmed: true, details: { client_name: "Acme" }, expectedHash: null }), context);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.saved).toBe(true);
    expect(typeof data.hash).toBe("string");
  });

  it("returns a distinguishable conflict when expectedHash no longer matches", async () => {
    const first = await PUT(request({ confirmed: true, details: { client_name: "Acme" }, expectedHash: null }), context);
    const { hash: staleHash } = await first.json();

    // Someone else's write changes the file after this client's stale read.
    await PUT(request({ confirmed: true, details: { client_name: "Someone Else" }, expectedHash: staleHash }), context);

    const conflicting = await PUT(request({ confirmed: true, details: { client_name: "Stale Writer" }, expectedHash: staleHash }), context);
    expect(conflicting.status).toBe(409);
    const data = await conflicting.json();
    expect(data.error).toBe("conflict");

    const detailsPath = path.join(projectsDir, "demo", "details.yaml");
    expect(fs.readFileSync(detailsPath, "utf8")).toContain("Someone Else");
  });

  it("rejects a save when the reviewed content hash is omitted", async () => {
    const response = await PUT(request({ confirmed: true, details: { client_name: "Second" } }), context);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/reload/i);
  });
});
