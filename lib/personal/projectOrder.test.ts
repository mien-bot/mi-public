import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { projectOrderPath, projectOrderRank, readProjectOrder, writeProjectOrder } from "./projectOrder";

const roots: string[] = [];

function root(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mi-project-order-"));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("personal project ordering", () => {
  it("round-trips an arrangement", () => {
    const dir = root();
    writeProjectOrder(["gamma", "alpha", "beta"], { root: dir });

    expect(readProjectOrder({ root: dir }).slugs).toEqual(["gamma", "alpha", "beta"]);
  });

  it("treats a missing file as no arrangement rather than an error", () => {
    expect(readProjectOrder({ root: root() }).slugs).toEqual([]);
  });

  it("recovers from a corrupt file instead of throwing", () => {
    const dir = root();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(projectOrderPath({ root: dir }), "{ not json");

    expect(readProjectOrder({ root: dir }).slugs).toEqual([]);
  });

  it("keeps each slug once, at its first position", () => {
    const dir = root();
    writeProjectOrder(["alpha", "beta", "alpha"], { root: dir });

    expect(readProjectOrder({ root: dir }).slugs).toEqual(["alpha", "beta"]);
  });

  it("ranks unplaced projects after every placed one", () => {
    const rank = projectOrderRank({ slugs: ["gamma", "alpha"] });

    expect(rank("gamma")).toBe(0);
    expect(rank("alpha")).toBe(1);
    expect(rank("never-dragged")).toBeGreaterThan(rank("alpha"));
  });

  it("writes nothing outside the personal folder it was given", () => {
    const dir = root();
    writeProjectOrder(["alpha"], { root: dir });

    expect(fs.existsSync(path.join(dir, "project-order.json"))).toBe(true);
    expect(fs.readdirSync(dir).sort()).toEqual([".mi-backups", "project-order.json"].filter(
      (name) => fs.existsSync(path.join(dir, name)),
    ).sort());
  });
});
