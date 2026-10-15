import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getAllPermitQaqcEngagements, getPermitQaqcEngagement, getPermitQaqcReviews, getPermitQaqcSlugs } from "./permitQaqc";

const VALID_ENGAGEMENT_YAML = [
  "name: example-record-13",
  "submitting_firm: SampleConsultant",
  "status: in-review",
  "dropbox_path: null",
  "engagement_number: '03'",
  "rounds: []",
  "notes: ''",
  "",
].join("\n");

describe("permit QAQC readers", () => {
  let root: string;
  let permitQaqcDirRoot: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-permit-qaqc-read-"));
    permitQaqcDirRoot = path.join(root, "permit-qaqc");
    fs.mkdirSync(path.join(permitQaqcDirRoot, "914-example-ave"), { recursive: true });
    fs.writeFileSync(path.join(permitQaqcDirRoot, "914-example-ave", "qaqc.yaml"), VALID_ENGAGEMENT_YAML);
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("lists engagement slugs as directories, not files", () => {
    fs.mkdirSync(path.join(permitQaqcDirRoot, "another-engagement"));
    expect(getPermitQaqcSlugs(permitQaqcDirRoot).sort()).toEqual(["914-example-ave", "another-engagement"]);
  });

  it("reads a single engagement, validated against the schema", () => {
    const { slug, engagement } = getPermitQaqcEngagement("914-example-ave", permitQaqcDirRoot);
    expect(slug).toBe("914-example-ave");
    expect(engagement).toMatchObject({
      name: "example-record-13",
      submitting_firm: "SampleConsultant",
      status: "in-review",
      engagement_number: "03",
    });
  });

  it("reads every engagement", () => {
    fs.mkdirSync(path.join(permitQaqcDirRoot, "second-engagement"));
    fs.writeFileSync(
      path.join(permitQaqcDirRoot, "second-engagement", "qaqc.yaml"),
      VALID_ENGAGEMENT_YAML.replace("example-record-13", "Second Engagement"),
    );
    const all = getAllPermitQaqcEngagements(permitQaqcDirRoot);
    expect(all.map((r) => r.slug).sort()).toEqual(["914-example-ave", "second-engagement"]);
  });

  it("returns no reviews when the reviews/ folder is empty or missing", () => {
    expect(getPermitQaqcReviews("914-example-ave", permitQaqcDirRoot)).toEqual([]);
  });

  it("reads draft review markdown files, newest first", () => {
    const reviewsDir = path.join(permitQaqcDirRoot, "914-example-ave", "reviews");
    fs.mkdirSync(reviewsDir, { recursive: true });
    fs.writeFileSync(
      path.join(reviewsDir, "round-1.md"),
      [
        "---",
        "date: '2026-07-20'",
        "type: review",
        "discipline: architectural",
        "status: open",
        "related_markups: []",
        "related_code_sections: []",
        "---",
        "DRAFT — AI-generated, requires architect review.",
        "",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(reviewsDir, "round-2.md"),
      [
        "---",
        "date: '2026-07-26'",
        "type: review",
        "discipline: architectural",
        "status: open",
        "related_markups: []",
        "related_code_sections: []",
        "---",
        "Second round draft.",
        "",
      ].join("\n"),
    );
    const reviews = getPermitQaqcReviews("914-example-ave", permitQaqcDirRoot);
    expect(reviews.map((r) => r.frontmatter.date)).toEqual(["2026-07-26", "2026-07-20"]);
  });
});
