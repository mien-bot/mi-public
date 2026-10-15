import fs from "node:fs";
import path from "node:path";
import { load as loadYaml, dump as dumpYaml } from "js-yaml";
import { z } from "zod";
import { REPO_ROOT } from "@/lib/content/paths";

export interface MiConfig {
  schema_version: number;
  notion: {
    autosync_enabled: boolean;
    autosync_interval_minutes: number;
    allowed_write_fields: Record<string, string[]>;
  };
  verification: {
    before_apply: string[];
  };
}

const miConfigSchema = z.object({
  schema_version: z.literal(1),
  notion: z.object({
    autosync_enabled: z.boolean(),
    autosync_interval_minutes: z.number().int().positive(),
    allowed_write_fields: z.record(z.string(), z.array(z.string())),
  }),
  verification: z.object({ before_apply: z.array(z.string()) }),
});

function configPath(): string {
  return path.resolve(process.env.MI_CONFIG_PATH || path.join(REPO_ROOT, "mi.config.yaml"));
}

/**
 * The committed firm defaults, mirrored in code so startup remains safe if a local config has
 * not been materialized yet. Packaged Mi ships the reviewed template and Electron copies it
 * once to a per-machine editable path supplied through MI_CONFIG_PATH. Without a fallback,
 * older packaged installs threw ENOENT, and because
 * isWriteAllowed is the first thing every Notion write path calls, each of those routes died
 * before it could return JSON -- surfacing in the UI as "Unexpected end of JSON input".
 *
 * src/config.test.ts asserts this stays equivalent to the shipped mi.config.yaml, so the
 * default write allowlist cannot quietly drift from the file that documents it.
 */
export const DEFAULT_MI_CONFIG: MiConfig = {
  schema_version: 1,
  notion: {
    autosync_enabled: false,
    autosync_interval_minutes: 240,
    allowed_write_fields: {
      project: ["status", "client", "address", "knowledge"],
      schedule: ["create", "remove", "planned_date", "actual_date", "start_time", "end_time"],
      lead: [
        "create",
        "name",
        "source",
        "status",
        "date_received",
        "contact_name",
        "contact_email",
        "contact_phone",
        "estimated_value",
        "notes",
        "lost_reason",
        "dropbox_path",
        "contract_stage",
        "contract_notes",
        "referrer_name",
      ],
      task: ["content", "attachment"],
    },
  },
  verification: {
    before_apply: ["npm run validate-content"],
  },
};

/**
 * Reads the explicitly configured per-machine path (or the development content root), falling
 * back to defaults only when the file is absent. A present file always wins, so a deliberately
 * tightened partner allowlist takes effect and is never broadened during an upgrade.
 */
export function loadMiConfig(): MiConfig {
  const CONFIG_PATH = configPath();
  if (!fs.existsSync(CONFIG_PATH)) return structuredClone(DEFAULT_MI_CONFIG);
  const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
  const parsed = miConfigSchema.safeParse(loadYaml(raw));
  if (!parsed.success) {
    throw new Error(`mi.config.yaml is invalid: ${parsed.error.issues[0]?.message ?? "review its structure"}`);
  }
  return parsed.data;
}

/** Persists a shallow patch (e.g. from the Settings UI changing autosync) back to mi.config.yaml. */
export function patchMiConfig(patch: Partial<MiConfig["notion"]>): MiConfig {
  const CONFIG_PATH = configPath();
  const config = loadMiConfig();
  config.notion = { ...config.notion, ...patch };
  // On an installed Mi this is the first write, so the file may not exist yet -- materializing
  // the defaults plus the patch is exactly the intended result.
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, dumpYaml(config, { lineWidth: 100 }), "utf-8");
  return config;
}
