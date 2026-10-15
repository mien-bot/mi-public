import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectDoctorChecks, doctorCommand, type DoctorCheck } from "./doctor";

function makeTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mi-doctor-"));
}

function byLabel(checks: DoctorCheck[], label: string): DoctorCheck {
  const found = checks.find((entry) => entry.label === label);
  if (!found) throw new Error(`no check labelled "${label}"`);
  return found;
}

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe("doctor CLI arguments", () => {
  it("rejects unknown flags instead of silently ignoring them", async () => {
    await expect(doctorCommand(["--mystery"])).rejects.toThrow("Unknown doctor option");
  });

  it("emits machine-readable JSON when requested", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await doctorCommand(["--json"]);
    const parsed = JSON.parse(String(log.mock.calls[0][0]));
    expect(parsed).toHaveProperty("ok");
    expect(parsed).toHaveProperty("checks");
    expect(Array.isArray(parsed.checks)).toBe(true);
  });

  it("prints help without running any checks", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await doctorCommand(["--help"]);
    expect(String(log.mock.calls[0][0])).toContain("Usage: mi doctor");
    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe("doctor resilience", () => {
  // The whole point of the command is to run when the install is broken, so a missing
  // repository must still produce a full report rather than an exception.
  it("still reports every group when the repository root does not exist", () => {
    const missing = path.join(makeTempRoot(), "does-not-exist");
    const checks = collectDoctorChecks(missing);

    expect(checks.length).toBeGreaterThan(0);
    expect(byLabel(checks, "Repository").status).toBe("fail");
    expect(byLabel(checks, "Dependencies").status).toBe("fail");
    // Groups after the failing ones must still be present.
    expect(checks.some((entry) => entry.group === "Credentials")).toBe(true);
  });

  it("reports a malformed package.json as a failed check rather than throwing", () => {
    const root = makeTempRoot();
    fs.writeFileSync(path.join(root, "package.json"), "{ not json", "utf-8");

    const checks = collectDoctorChecks(root);
    const repository = byLabel(checks, "Repository");
    expect(repository.status).toBe("fail");
    expect(repository.detail).toContain("could not run");
  });

  it("gives every failing and warning check an actionable fix", () => {
    const checks = collectDoctorChecks(path.join(makeTempRoot(), "does-not-exist"));
    const unhelpful = checks.filter((entry) => entry.status !== "ok" && !entry.fix);
    expect(unhelpful.map((entry) => entry.label)).toEqual([]);
  });
});

describe("doctor exit status", () => {
  it("exits non-zero when a required check fails", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process, "cwd").mockReturnValue(path.join(makeTempRoot(), "does-not-exist"));

    await doctorCommand([]);
    expect(process.exitCode).toBe(1);
  });

  it("treats an unconfigured optional integration as a warning, not a failure", () => {
    const checks = collectDoctorChecks();
    // Notion and Dropbox are optional: absent configuration must never fail the run.
    for (const label of ["NOTION_API_KEY", "DROPBOX_ROOT", "Claude authentication"]) {
      expect(byLabel(checks, label).status).not.toBe("fail");
    }
  });
});

describe("doctor credential handling", () => {
  it("never prints a credential value", () => {
    const secret = "notion-secret-value-must-not-appear";
    vi.stubEnv("NOTION_API_KEY", secret);
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", `oauth-${secret}`);

    const serialized = JSON.stringify(collectDoctorChecks());
    expect(serialized).not.toContain(secret);
    expect(serialized).toContain("configured");

    vi.unstubAllEnvs();
  });
});
