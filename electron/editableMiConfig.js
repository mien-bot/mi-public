const fs = require("node:fs");
const path = require("node:path");
const { renameDurably } = require("./durableRename");

/**
 * Materializes the packaged, non-secret firm defaults into a per-machine editable file.
 * Existing partner edits always win; upgrades never overwrite or broaden their allowlist.
 */
function ensureEditableMiConfig({ templatePath, configPath }) {
  if (fs.existsSync(configPath)) return { path: configPath, created: false };
  const template = fs.readFileSync(templatePath, "utf8");
  if (!template.trim()) throw new Error("The packaged Mi configuration template is empty.");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const temporary = `${configPath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, template, { encoding: "utf8", flag: "wx" });
    renameDurably(temporary, configPath);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
  return { path: configPath, created: true };
}

module.exports = { ensureEditableMiConfig };
