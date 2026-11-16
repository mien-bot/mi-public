import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { load as loadYaml } from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createPermitQaqcEngagement,
  deletePermitQaqcEngagement,
  setPermitQaqcCompletion,
  updatePermitQaqcEngagement,
} from "./permitQaqcMutations";

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

  describe("completion", () => {
    const slug = "914-example-ave";
    const complete = { action: "complete", confirmed: true, expectedName: VALID_ENGAGEMENT.name };
    const reopen = { ...complete, action: "reopen" };
    const read = () => loadYaml(
      fs.readFileSync(path.join(permitQaqcDir, slug, "qaqc.yaml"), "utf8"),
    ) as Record<string, unknown>;

    beforeEach(() => {
      createPermitQaqcEngagement(slug, { ...VALID_ENGAGEMENT, status: "resubmitted" }, { permitQaqcDir });
    });

    it("completes, then reopens to the exact prior status with a recoverable backup", () => {
      const completed = setPermitQaqcCompletion(slug, complete, { permitQaqcDir });
      expect(completed.backupPath).not.toBeNull();
      expect(read()).toMatchObject({
        status: "closed",
        reopen_status: "resubmitted",
        completed_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      });

      setPermitQaqcCompletion(slug, reopen, { permitQaqcDir });
      const reopened = read();
      expect(reopened.status).toBe("resubmitted");
      expect(reopened).not.toHaveProperty("completed_at");
      expect(reopened).not.toHaveProperty("reopen_status");
    });

    it("requires confirmation and refuses a stale name or repeated action", () => {
      expect(() => setPermitQaqcCompletion(slug, { ...complete, confirmed: false }, { permitQaqcDir })).toThrow(/confirmation/);
      expect(() => setPermitQaqcCompletion(slug, { ...complete, expectedName: "Other" }, { permitQaqcDir })).toThrow(/changed/);
      expect(() => setPermitQaqcCompletion(slug, reopen, { permitQaqcDir })).toThrow(/already open/);
      expect(read().status).toBe("resubmitted");

      setPermitQaqcCompletion(slug, complete, { permitQaqcDir });
      expect(() => setPermitQaqcCompletion(slug, complete, { permitQaqcDir })).toThrow(/already completed/);
    });

    it("reopens a record closed before prior status was remembered", () => {
      updatePermitQaqcEngagement(slug, { ...VALID_ENGAGEMENT, status: "closed" }, { permitQaqcDir });
      const filePath = path.join(permitQaqcDir, slug, "qaqc.yaml");
      fs.writeFileSync(filePath, fs.readFileSync(filePath, "utf8").replace(/^reopen_status:.*\n/m, ""));

      setPermitQaqcCompletion(slug, reopen, { permitQaqcDir });
      expect(read().status).toBe("in-review");
    });

    it("keeps completion fields consistent when the edit form changes status or sends an old copy", () => {
      updatePermitQaqcEngagement(slug, { ...VALID_ENGAGEMENT, status: "closed" }, { permitQaqcDir });
      const closed = read();
      expect(closed.reopen_status).toBe("resubmitted");

      updatePermitQaqcEngagement(slug, { ...VALID_ENGAGEMENT, status: "closed", notes: "edited", reopen_status: "received" }, { permitQaqcDir });
      expect(read()).toMatchObject({ notes: "edited", reopen_status: "resubmitted", completed_at: closed.completed_at });

      updatePermitQaqcEngagement(slug, { ...VALID_ENGAGEMENT, status: "received", completed_at: "2026-01-01" }, { permitQaqcDir });
      expect(read()).not.toHaveProperty("completed_at");
      expect(read()).not.toHaveProperty("reopen_status");
    });
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
