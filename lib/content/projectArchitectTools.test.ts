import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArchitectToolOperation } from "@/lib/architectTools";

const roots: string[] = [];
let projectDir: string;

vi.mock("./projects", () => ({ contentDir: () => projectDir }));

import { ContentConflictError } from "./atomicContentWrite";
import {
  applyProjectArchitectToolOperation,
  getProjectArchitectToolkitWithHash,
} from "./projectArchitectTools";

function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-architect-tools-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function productOperation(): ArchitectToolOperation {
  return {
    kind: "add-product",
    value: {
      id: "product-12345678",
      category: "Seating",
      manufacturer: "example",
      product_name: "Task Chair",
      model: "A1",
      source: {
        title: "Manufacturer data sheet",
        url: "https://example.com/chair",
        accessed_on: "2026-07-28",
        authority: "example",
        section: "",
        notes: "",
      },
      notes: "",
      status: "candidate",
      selected_by: null,
    },
  };
}

describe("project architect tools storage", () => {
  it("writes a validated atomic YAML record and reloads it", () => {
    projectDir = temporaryRoot();
    const current = getProjectArchitectToolkitWithHash("demo");
    expect(current.hash).toBeNull();

    const result = applyProjectArchitectToolOperation({
      slug: "demo",
      operation: productOperation(),
      expectedHash: current.hash,
    });
    expect(result.toolkit.products).toHaveLength(1);
    expect(getProjectArchitectToolkitWithHash("demo").toolkit.products[0].product_name)
      .toBe("Task Chair");
  });

  it("refuses duplicate records and stale writes", () => {
    projectDir = temporaryRoot();
    const first = applyProjectArchitectToolOperation({
      slug: "demo",
      operation: productOperation(),
      expectedHash: null,
    });
    expect(() => applyProjectArchitectToolOperation({
      slug: "demo",
      operation: {
        ...productOperation(),
        value: { ...productOperation().value, id: "product-87654321" },
      } as ArchitectToolOperation,
      expectedHash: null,
    })).toThrow(ContentConflictError);
    expect(() => applyProjectArchitectToolOperation({
      slug: "demo",
      operation: productOperation(),
      expectedHash: first.hash,
    })).toThrow(/already exists/);
  });
});
