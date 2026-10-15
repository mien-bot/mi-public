import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectDeliverable } from "@/lib/schema";

const roots: string[] = [];
let projectDir: string;

vi.mock("./projects", () => ({ contentDir: () => projectDir }));

import { ContentConflictError, readCurrentHash } from "./atomicContentWrite";
import {
  createProjectDeliverable,
  deleteProjectDeliverable,
  getProjectDeliverables,
  getProjectDeliverablesWithHash,
  projectDeliverablesPath,
  updateProjectDeliverable,
} from "./projectDeliverables";

function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-deliverables-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function deliverable(overrides: Partial<ProjectDeliverable> = {}): ProjectDeliverable {
  return {
    id: "2026-08-05-schematic-deck",
    kind: "presentation",
    title: "Schematic design review",
    issued_date: "2026-08-05",
    audience: "Client",
    package_path: "04_Presentation/2026-08-05 Client Review",
    spaces: ["Lobby", "Dining"],
    status: "issued",
    superseded_by: null,
    notes: "",
    ...overrides,
  };
}

describe("project deliverables register", () => {
  it("records an issued package and reads it back", () => {
    projectDir = temporaryRoot();

    const created = createProjectDeliverable("demo", deliverable(), null);

    expect(created.id).toBe("2026-08-05-schematic-deck");
    expect(getProjectDeliverables("demo")).toEqual([deliverable()]);
  });

  it("keeps an unconfirmed date and package folder blank rather than inventing them", () => {
    projectDir = temporaryRoot();

    const created = createProjectDeliverable("demo", deliverable({
      id: "unscheduled-plot",
      status: "draft",
      issued_date: null,
      package_path: null,
      audience: "",
    }), null);

    expect(created.issued_date).toBeNull();
    expect(created.package_path).toBeNull();
    expect(created.audience).toBe("");
  });

  it("requires a confirmed date before a package can be marked issued", () => {
    projectDir = temporaryRoot();

    expect(() => createProjectDeliverable("demo", deliverable({ issued_date: null }), null))
      .toThrow(/confirmed date it went out/);
  });

  it("refuses a supersession pointer that names no deliverable in the register", () => {
    projectDir = temporaryRoot();

    expect(() => createProjectDeliverable("demo", deliverable({
      status: "superseded",
      superseded_by: "never-recorded",
    }), null)).toThrow(/is not in this register/);
  });

  it("links a superseded package to its replacement once both exist", () => {
    projectDir = temporaryRoot();
    createProjectDeliverable("demo", deliverable({ id: "deck-v1" }), readCurrentHash(projectDeliverablesPath("demo")));
    createProjectDeliverable("demo", deliverable({
      id: "deck-v2",
      issued_date: "2026-08-19",
    }), readCurrentHash(projectDeliverablesPath("demo")));

    const updated = updateProjectDeliverable("demo", "deck-v1", deliverable({
      id: "deck-v1",
      status: "superseded",
      superseded_by: "deck-v2",
    }), readCurrentHash(projectDeliverablesPath("demo")));

    expect(updated.superseded_by).toBe("deck-v2");
    expect(getProjectDeliverables("demo").map((entry) => entry.id)).toEqual(["deck-v2", "deck-v1"]);
  });

  it("rejects a duplicate id", () => {
    projectDir = temporaryRoot();
    createProjectDeliverable("demo", deliverable(), null);

    expect(() => createProjectDeliverable("demo", deliverable(), readCurrentHash(projectDeliverablesPath("demo"))))
      .toThrow(/already exists/);
  });

  it("refuses a write when the register changed since it was read", () => {
    projectDir = temporaryRoot();
    const stale = getProjectDeliverablesWithHash("demo").hash;
    createProjectDeliverable("demo", deliverable({ id: "deck-v1" }), stale);

    expect(() => createProjectDeliverable("demo", deliverable({ id: "deck-v2" }), stale))
      .toThrow(ContentConflictError);
  });

  it("sorts undated drafts after dated packages instead of guessing where they belong", () => {
    projectDir = temporaryRoot();
    createProjectDeliverable("demo", deliverable({ id: "dated-deck" }), readCurrentHash(projectDeliverablesPath("demo")));
    createProjectDeliverable("demo", deliverable({
      id: "undated-deck",
      status: "draft",
      issued_date: null,
    }), readCurrentHash(projectDeliverablesPath("demo")));

    expect(getProjectDeliverables("demo").map((entry) => entry.id))
      .toEqual(["dated-deck", "undated-deck"]);
  });
});

describe("deliverable deletion", () => {
  it("removes only the named entry and leaves the rest of the register intact", () => {
    projectDir = temporaryRoot();
    const first = createProjectDeliverable("demo", deliverable(), null);
    const second = createProjectDeliverable(
      "demo",
      deliverable({ id: "2026-09-01-permit-set", title: "Permit set" }),
      readCurrentHash(projectDeliverablesPath("demo")),
    );

    const removed = deleteProjectDeliverable(
      "demo",
      first.id,
      readCurrentHash(projectDeliverablesPath("demo")),
    );

    expect(removed.id).toBe(first.id);
    expect(getProjectDeliverables("demo").map((entry) => entry.id)).toEqual([second.id]);
  });

  it("refuses a stale hash so a stale page cannot discard a newer entry", () => {
    projectDir = temporaryRoot();
    const created = createProjectDeliverable("demo", deliverable(), null);
    const hashBefore = readCurrentHash(projectDeliverablesPath("demo"));
    createProjectDeliverable(
      "demo",
      deliverable({ id: "2026-09-01-permit-set", title: "Permit set" }),
      hashBefore,
    );

    expect(() => deleteProjectDeliverable("demo", created.id, hashBefore))
      .toThrow(ContentConflictError);
    expect(getProjectDeliverables("demo")).toHaveLength(2);
  });

  it("reports an unknown id rather than silently rewriting the file", () => {
    projectDir = temporaryRoot();
    createProjectDeliverable("demo", deliverable(), null);
    expect(() => deleteProjectDeliverable(
      "demo",
      "2099-01-01-nope",
      readCurrentHash(projectDeliverablesPath("demo")),
    )).toThrow(/was not found/);
    expect(getProjectDeliverables("demo")).toHaveLength(1);
  });
});
