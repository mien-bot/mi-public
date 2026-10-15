import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { load as loadYaml } from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPermitQaqcEngagement, deletePermitQaqcEngagement, updatePermitQaqcEngagement } from "./permitQaqcMutations";

const VALID_ENGAGEMENT = {
  name: "example-record-13",
  submitting_firm: "SampleConsultant",
  status: "received",
  dropbox_path: null,
  engagement_number: "03",
  rounds: [],
  notes: "",
};

describe("permit QAQC mutations", () => {
  let root: string;
  let permitQaqcDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-permit-qaqc-"));
    permitQaqcDir = path.join(root, "permit-qaqc");
    fs.mkdirSync(permitQaqcDir);
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("creates an explicitly named, schema-valid engagement folder without silently changing its slug", () => {
    const result = createPermitQaqcEngagement("914-example-ave", VALID_ENGAGEMENT, { permitQaqcDir });
    expect(result.slug).toBe("914-example-ave");
    expect(fs.existsSync(path.join(permitQaqcDir, "914-example-ave", "qaqc.yaml"))).toBe(true);
    expect(loadYaml(fs.readFileSync(result.filePath, "utf8"))).toMatchObject({
      name: "example-record-13",
      submitting_firm: "SampleConsultant",
    });
    // creation also scaffolds the reviews/ subdir
    expect(fs.existsSync(path.join(permitQaqcDir, "914-example-ave", "reviews"))).toBe(true);
  });

  it("rejects traversal, reserved slugs, and case-insensitive collisions", () => {
    expect(() => createPermitQaqcEngagement("../outside", VALID_ENGAGEMENT, { permitQaqcDir })).toThrow(/lowercase/);
    expect(() => createPermitQaqcEngagement("new", VALID_ENGAGEMENT, { permitQaqcDir })).toThrow(/reserved/);
    fs.mkdirSync(path.join(permitQaqcDir, "914-example-AVE"));
    expect(() => createPermitQaqcEngagement("914-example-ave", VALID_ENGAGEMENT, { permitQaqcDir })).toThrow(/already exists/);
  });

  it("rejects an engagement missing a required field", () => {
    expect(() =>
      createPermitQaqcEngagement("missing-firm", { ...VALID_ENGAGEMENT, submitting_firm: "" }, { permitQaqcDir }),
    ).toThrow();
  });

  it("updates recoverably while preserving unrelated YAML fields", () => {
    createPermitQaqcEngagement("914-example-ave", VALID_ENGAGEMENT, { permitQaqcDir });
    const filePath = path.join(permitQaqcDir, "914-example-ave", "qaqc.yaml");
    fs.writeFileSync(filePath, fs.readFileSync(filePath, "utf8") + "future_field: keep-me\n");

    const result = updatePermitQaqcEngagement("914-example-ave", {
      ...VALID_ENGAGEMENT,
      status: "response-sent",
    }, { permitQaqcDir });
    const written = loadYaml(fs.readFileSync(result.filePath, "utf8")) as Record<string, unknown>;
    expect(written.status).toBe("response-sent");
    expect(written.future_field).toBe("keep-me");
    expect(result.backupPath).not.toBeNull();
    expect(fs.existsSync(result.backupPath!)).toBe(true);
  });

  it("deletes only after exact confirmation and backs up the whole engagement folder recoverably", () => {
    createPermitQaqcEngagement("914-example-ave", VALID_ENGAGEMENT, { permitQaqcDir });

    expect(() => deletePermitQaqcEngagement("914-example-ave", {
      confirmed: false,
      expectedName: VALID_ENGAGEMENT.name,
    }, { permitQaqcDir })).toThrow(/confirmation/);
    expect(() => deletePermitQaqcEngagement("914-example-ave", {
      confirmed: true,
      expectedName: "Different Engagement",
    }, { permitQaqcDir })).toThrow(/changed/);
    expect(fs.existsSync(path.join(permitQaqcDir, "914-example-ave"))).toBe(true);

    const result = deletePermitQaqcEngagement("914-example-ave", {
      confirmed: true,
      expectedName: VALID_ENGAGEMENT.name,
    }, { permitQaqcDir });

    expect(fs.existsSync(result.filePath)).toBe(false);
    expect(fs.existsSync(result.backupPath)).toBe(true);
    expect(loadYaml(fs.readFileSync(path.join(result.backupPath, "qaqc.yaml"), "utf8"))).toMatchObject({
      name: VALID_ENGAGEMENT.name,
    });
  });
});
