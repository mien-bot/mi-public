import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { ensureEditableMiConfig } = require("./editableMiConfig.js");

describe("editable installed Mi configuration", () => {
  it("seeds the packaged template once and preserves partner edits", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mi-editable-config-"));
    try {
      const templatePath = path.join(root, "packaged.yaml");
      const configPath = path.join(root, "user", "config", "mi.config.yaml");
      fs.writeFileSync(templatePath, "schema_version: 1\nnotion:\n  allowed_write_fields: {}\n");

      expect(ensureEditableMiConfig({ templatePath, configPath })).toMatchObject({ created: true });
      fs.writeFileSync(configPath, "partner: tightened\n");
      expect(ensureEditableMiConfig({ templatePath, configPath })).toMatchObject({ created: false });
      expect(fs.readFileSync(configPath, "utf8")).toBe("partner: tightened\n");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
