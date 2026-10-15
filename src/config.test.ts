import fs from "node:fs";
import path from "node:path";
import { load as loadYaml } from "js-yaml";
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_MI_CONFIG, loadMiConfig, type MiConfig } from "./config";

const originalConfigPath = process.env.MI_CONFIG_PATH;
afterEach(() => {
  if (originalConfigPath === undefined) delete process.env.MI_CONFIG_PATH;
  else process.env.MI_CONFIG_PATH = originalConfigPath;
});

/**
 * The in-code defaults protect startup before Electron materializes the shipped template. If
 * the committed file and constant drift apart, the documented write allowlist stops describing
 * the installed default -- so
 * this compares them directly rather than trusting review to catch it.
 */
describe("committed Mi configuration", () => {
  const committed = loadYaml(
    fs.readFileSync(path.join(process.cwd(), "mi.config.yaml"), "utf-8"),
  ) as MiConfig;

  it("matches the in-code defaults the installed app falls back to", () => {
    expect(DEFAULT_MI_CONFIG).toEqual(committed);
  });

  it("still gates every Notion write field the app relies on", () => {
    // Named explicitly so removing one from the allowlist fails here rather than silently
    // turning a working confirmation flow into a 409 at runtime.
    expect(DEFAULT_MI_CONFIG.notion.allowed_write_fields.schedule).toEqual(
      expect.arrayContaining(["create", "planned_date", "actual_date", "start_time", "end_time"]),
    );
    expect(DEFAULT_MI_CONFIG.notion.allowed_write_fields.project).toEqual(
      expect.arrayContaining(["status"]),
    );
    expect(DEFAULT_MI_CONFIG.notion.allowed_write_fields.lead).toEqual(
      expect.arrayContaining(["create", "status"]),
    );
    expect(DEFAULT_MI_CONFIG.notion.allowed_write_fields.task).toEqual(["content", "attachment"]);
  });

  it("loads a partner-specific config path and rejects malformed edits", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-config-test-"));
    try {
      const configPath = path.join(root, "mi.config.yaml");
      process.env.MI_CONFIG_PATH = configPath;
      fs.writeFileSync(configPath, `schema_version: 1
notion:
  autosync_enabled: true
  autosync_interval_minutes: 240
  allowed_write_fields:
    schedule: [planned_date]
verification:
  before_apply: []
`);
      expect(loadMiConfig().notion.allowed_write_fields.schedule).toEqual(["planned_date"]);
      fs.writeFileSync(configPath, "notion: invalid\n");
      expect(() => loadMiConfig()).toThrow(/mi\.config\.yaml is invalid/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
