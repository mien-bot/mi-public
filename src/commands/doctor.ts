import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { load as loadYaml } from "js-yaml";
import { DROPBOX_ROOT, PROJECTS_DIR, REPO_ROOT } from "@/lib/content/paths";
import { scanForConflicts } from "@/lib/content/dropboxConflicts";
import { projectMetaSchema } from "@/lib/schema";
import { loadMiConfig } from "@/src/config";

/**
 * `mi doctor` — read-only diagnosis of a Mi installation.
 *
 * Two rules govern everything below:
 *
 * 1. It never mutates. Doctor reports; a person fixes. That is the same boundary the rest
 *    of Mi enforces for Notion and Dropbox, and it matters more here than elsewhere: the
 *    command people run when something is already broken is the worst possible place to
 *    take an unconfirmed corrective action.
 * 2. It never throws. Every check is wrapped by `safe()`, so the one broken thing being
 *    diagnosed cannot abort the report that explains it. A diagnostic that dies on the
 *    fault it is meant to find is worse than no diagnostic.
 *
 * It also never prints a secret. Credential checks report configured/not configured and
 * the variable name only — never a value, prefix, or length.
 */

export type DoctorStatus = "ok" | "warn" | "fail";

export interface DoctorCheck {
  /** Section heading this check prints under. */
  group: string;
  label: string;
  status: DoctorStatus;
  /** Retained for the pre-existing `--json` contract: false only for a hard failure. */
  ok: boolean;
  /** True when Mi cannot function without this check passing. */
  required?: boolean;
  detail?: string;
  /** Concrete next step. Printed only when the check is not `ok`. */
  fix?: string;
}

const DOCTOR_HELP = `Usage: mi doctor [--json]

Diagnoses this Mi installation and prints what is wrong and how to fix it.

Checks the Node runtime, repository and dependencies, mi.config.yaml, the Codex/Claude
CLIs and their authentication, Notion configuration and snapshot freshness, the Dropbox
root and conflicted copies, local project records, and credential hygiene.

Read-only: it inspects the local filesystem and configuration, performs no Notion or
Dropbox writes, makes no network calls, and never prints a credential value.

Options:
  --json    Emit the full result as JSON (exit 1 if any required check fails).
  --help    Show this help.
`;

/** Next.js 16 is the floor for this repo; see node_modules/next/package.json engines. */
const MINIMUM_NODE = "20.9.0";

/** A cached Notion map older than this is stale enough to mislead someone. */
const NOTION_MAP_STALE_DAYS = 7;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs one check group, converting any thrown error into a reported failure rather than
 * letting it abort the whole report. See rule 2 in the module comment.
 */
function safe(group: string, label: string, fn: () => DoctorCheck | DoctorCheck[]): DoctorCheck[] {
  try {
    const result = fn();
    return Array.isArray(result) ? result : [result];
  } catch (error) {
    return [
      {
        group,
        label,
        status: "fail",
        ok: false,
        detail: `this check could not run: ${message(error)}`,
        fix: "Report this as a Mi bug — a doctor check should degrade to a warning, never throw.",
      },
    ];
  }
}

function check(
  group: string,
  label: string,
  status: DoctorStatus,
  detail?: string,
  fix?: string,
  required = false,
): DoctorCheck {
  return { group, label, status, ok: status !== "fail", required, detail, fix };
}

interface ResolvedCommand {
  found: boolean;
  /** Absolute path when resolvable — helps diagnose a shadowed or wrapper binary. */
  location?: string;
}

function resolveCommand(command: string): ResolvedCommand {
  if (path.isAbsolute(command)) {
    return fs.existsSync(command) ? { found: true, location: command } : { found: false };
  }
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(locator, [command], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (result.status !== 0) return { found: false };
  const location = String(result.stdout ?? "").split(/\r?\n/).find((line) => line.trim().length > 0);
  return { found: true, location: location?.trim() };
}

function compareVersions(a: string, b: string): number {
  const left = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function daysSince(mtime: Date): number {
  return Math.floor((Date.now() - mtime.getTime()) / 86_400_000);
}

function describeAge(days: number): string {
  if (days <= 0) return "updated today";
  if (days === 1) return "1 day old";
  return `${days} days old`;
}

/** Formats a bounded sample of offending items so a long list can't flood the report. */
function sample(items: string[], limit = 3): string {
  const shown = items.slice(0, limit).join(", ");
  return items.length > limit ? `${shown}, +${items.length - limit} more` : shown;
}

// --------------------------------------------------------------------------------------
// Check groups
// --------------------------------------------------------------------------------------

function environmentChecks(): DoctorCheck[] {
  const group = "Environment";
  const checks: DoctorCheck[] = [];

  checks.push(
    ...safe(group, "Node runtime", () => {
      const current = process.versions.node;
      const tooOld = compareVersions(current, MINIMUM_NODE) < 0;
      return check(
        group,
        "Node runtime",
        tooOld ? "fail" : "ok",
        `v${current} on ${process.platform} (${process.arch}); requires >= ${MINIMUM_NODE}`,
        tooOld ? `Install Node ${MINIMUM_NODE} or newer, then re-run \`npm install\`.` : undefined,
        true,
      );
    }),
  );

  checks.push(
    ...safe(group, "Content root", () => {
      const overridden = Boolean(process.env.MI_CONTENT_ROOT);
      const packaged = process.env.MI_DESKTOP_PACKAGED === "1";
      const mode = packaged
        ? "installed desktop app"
        : overridden
          ? "explicit MI_CONTENT_ROOT"
          : "repository checkout";
      const exists = fs.existsSync(REPO_ROOT);
      return check(
        group,
        "Content root",
        exists ? "ok" : "fail",
        `${mode}: ${REPO_ROOT}`,
        exists ? undefined : "The configured content root does not exist. Check MI_CONTENT_ROOT.",
        true,
      );
    }),
  );

  checks.push(
    ...safe(group, "Timezone", () => {
      const configured = process.env.MI_TIMEZONE;
      return check(
        group,
        "Timezone",
        configured ? "ok" : "warn",
        configured ?? "not set; Mi falls back to this machine's system timezone",
        configured
          ? undefined
          : "Set MI_TIMEZONE in .env.local (or finish /onboarding) so scheduled times match the firm's timezone on every machine.",
      );
    }),
  );

  return checks;
}

function installationChecks(repoRoot: string): DoctorCheck[] {
  const group = "Installation";
  const checks: DoctorCheck[] = [];

  checks.push(
    ...safe(group, "Repository", () => {
      const manifest = path.join(repoRoot, "package.json");
      if (!fs.existsSync(manifest)) {
        return check(
          group,
          "Repository",
          "fail",
          `no package.json at ${repoRoot}`,
          "Run `mi` from inside the Mi repository, or reinstall the desktop app.",
          true,
        );
      }
      const parsed = JSON.parse(fs.readFileSync(manifest, "utf-8")) as {
        version?: string;
        productName?: string;
      };
      return check(
        group,
        "Repository",
        "ok",
        `${parsed.productName ?? "Mi"} ${parsed.version ?? "unknown version"} at ${repoRoot}`,
        undefined,
        true,
      );
    }),
  );

  checks.push(
    ...safe(group, "Dependencies", () => {
      const installed = fs.existsSync(path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"));
      return check(
        group,
        "Dependencies",
        installed ? "ok" : "fail",
        installed ? "node_modules present (tsx resolved)" : "node_modules/tsx is missing",
        installed ? undefined : "Run `npm install` in the Mi repository.",
        true,
      );
    }),
  );

  return checks;
}

function configurationChecks(): DoctorCheck[] {
  const group = "Configuration";

  return safe(group, "mi.config.yaml", () => {
    const config = loadMiConfig();
    const source = process.env.MI_CONFIG_PATH
      ? `per-machine copy (${process.env.MI_CONFIG_PATH})`
      : "repository default";
    const gates = Object.entries(config.notion.allowed_write_fields)
      .map(([scope, fields]) => `${scope}:${fields.length}`)
      .join(" ");
    return [
      check(
        group,
        "mi.config.yaml",
        "ok",
        `${source}; autosync ${config.notion.autosync_enabled ? "on" : "off"}, every ${config.notion.autosync_interval_minutes}min`,
        undefined,
        true,
      ),
      check(
        group,
        "Notion write allowlist",
        "ok",
        gates ? `allowed write fields — ${gates}` : "no write fields allowed (read-only Notion)",
      ),
    ];
  });
}

function agentChecks(): DoctorCheck[] {
  const group = "AI engines";
  const checks: DoctorCheck[] = [];

  const codexCommand = process.env.MI_CODEX_BIN ?? "codex";
  const claudeCommand = process.env.MI_CLAUDE_BIN ?? "claude";

  const codex = safe(group, "Codex CLI", () => {
    const resolved = resolveCommand(codexCommand);
    return check(
      group,
      "Codex CLI",
      resolved.found ? "ok" : "warn",
      resolved.found ? (resolved.location ?? "found") : `\`${codexCommand}\` not found on PATH`,
      resolved.found ? undefined : "Install the Codex CLI, or set MI_CODEX_BIN to its absolute path.",
    );
  });

  const claude = safe(group, "Claude CLI", () => {
    const resolved = resolveCommand(claudeCommand);
    return check(
      group,
      "Claude CLI",
      resolved.found ? "ok" : "warn",
      resolved.found ? (resolved.location ?? "found") : `\`${claudeCommand}\` not found on PATH`,
      resolved.found ? undefined : "Install the Claude CLI, or set MI_CLAUDE_BIN to its absolute path.",
    );
  });

  checks.push(...codex, ...claude);

  const anyFound = [...codex, ...claude].some((entry) => entry.status === "ok");
  checks.push(
    check(
      group,
      "At least one agent CLI",
      anyFound ? "ok" : "fail",
      anyFound ? "an AI engine is available" : "neither Codex nor Claude is available",
      anyFound ? undefined : "Install the Codex or Claude CLI — chat and agent mode need one of them.",
      true,
    ),
  );

  checks.push(
    ...safe(group, "Claude authentication", () => {
      const subscription = Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN);
      const apiKey = Boolean(process.env.ANTHROPIC_API_KEY);

      if (subscription) {
        // Both set is worth flagging: ANTHROPIC_API_KEY is separately billed, and a stray
        // one in the environment is exactly how a subscription install silently starts
        // spending API credit.
        return check(
          group,
          "Claude authentication",
          apiKey ? "warn" : "ok",
          apiKey
            ? "CLAUDE_CODE_OAUTH_TOKEN configured, but ANTHROPIC_API_KEY is also set"
            : "CLAUDE_CODE_OAUTH_TOKEN configured",
          apiKey
            ? "Mi uses the subscription token. Remove ANTHROPIC_API_KEY unless it is deliberately reserved for the separately billed remote gateway."
            : undefined,
        );
      }
      if (apiKey) {
        return check(
          group,
          "Claude authentication",
          "warn",
          "only ANTHROPIC_API_KEY is set; Mi's Claude engine expects the subscription token",
          "Set CLAUDE_CODE_OAUTH_TOKEN. Mi drives the installed `claude` CLI, not the Anthropic Messages API — ANTHROPIC_API_KEY is not a substitute.",
        );
      }
      return check(
        group,
        "Claude authentication",
        "warn",
        "CLAUDE_CODE_OAUTH_TOKEN not configured",
        "Add the Claude subscription token in /settings (or .env.local) if you want the Claude engine.",
      );
    }),
  );

  return checks;
}

function notionChecks(repoRoot: string): DoctorCheck[] {
  const group = "Notion";
  const checks: DoctorCheck[] = [];

  checks.push(
    ...safe(group, "NOTION_API_KEY", () =>
      check(
        group,
        "NOTION_API_KEY",
        process.env.NOTION_API_KEY ? "ok" : "warn",
        process.env.NOTION_API_KEY ? "configured" : "not configured; Notion sync is unavailable",
        process.env.NOTION_API_KEY
          ? undefined
          : "Add the Notion integration token in /settings, then use its `test access` check.",
      ),
    ),
  );

  checks.push(
    ...safe(group, "Notion data sources", () => {
      const projects =
        process.env.NOTION_PROJECTS_DATA_SOURCE_ID ?? process.env.NOTION_PROJECTS_DATABASE_ID;
      const schedule =
        process.env.NOTION_SCHEDULE_DATA_SOURCE_ID ?? process.env.NOTION_SCHEDULE_DATABASE_ID;
      const missing = [!projects && "Projects", !schedule && "Schedule"].filter(Boolean) as string[];
      return check(
        group,
        "Notion data sources",
        missing.length === 0 ? "ok" : "warn",
        missing.length === 0
          ? "Projects and Schedule data sources configured"
          : `not configured: ${missing.join(", ")}`,
        missing.length === 0
          ? undefined
          : "Set the data source IDs in /settings, or run `mi notion probe` to list what the token can see.",
      );
    }),
  );

  checks.push(
    ...safe(group, "Cached project map", () => {
      const mapPath = path.join(repoRoot, "notion", "project-map.json");
      if (!fs.existsSync(mapPath)) {
        return check(
          group,
          "Cached project map",
          "warn",
          "notion/project-map.json has never been built",
          "Run `mi notion map --write` to build the read-only snapshot.",
        );
      }
      const age = daysSince(fs.statSync(mapPath).mtime);
      let entries = "";
      try {
        const parsed = JSON.parse(fs.readFileSync(mapPath, "utf-8")) as Record<string, unknown>;
        const projects = (parsed.projects ?? parsed) as unknown;
        if (Array.isArray(projects)) entries = `, ${projects.length} projects`;
      } catch {
        return check(
          group,
          "Cached project map",
          "fail",
          "notion/project-map.json is not valid JSON",
          "Rebuild it with `mi notion map --write`.",
        );
      }
      const stale = age > NOTION_MAP_STALE_DAYS;
      return check(
        group,
        "Cached project map",
        stale ? "warn" : "ok",
        `${describeAge(age)}${entries}`,
        stale ? "Refresh the snapshot with `mi notion map --write`." : undefined,
      );
    }),
  );

  checks.push(
    ...safe(group, "Write audit log", () => {
      const auditPath = path.join(repoRoot, ".mi", "audit", "notion-sync.log");
      const exists = fs.existsSync(auditPath);
      return check(
        group,
        "Write audit log",
        "ok",
        exists
          ? `.mi/audit/notion-sync.log (${describeAge(daysSince(fs.statSync(auditPath).mtime))})`
          : "no Notion writes recorded yet",
      );
    }),
  );

  return checks;
}

interface ProjectRecord {
  slug: string;
  notionPageId: string | null;
  dropboxPath: string | null;
  migrated: boolean;
}

type DropboxLinkedProject = ProjectRecord & { dropboxPath: string };

function isDropboxLinked(record: ProjectRecord): record is DropboxLinkedProject {
  return Boolean(record.dropboxPath);
}

/**
 * Reads every project.yaml defensively — one invalid file must not hide the state of the
 * rest, so failures are collected as slugs instead of thrown. This deliberately does not
 * use getAllProjects(), which throws on the first schema violation.
 */
function readProjectRecords(): { records: ProjectRecord[]; invalid: string[] } {
  const records: ProjectRecord[] = [];
  const invalid: string[] = [];
  if (!fs.existsSync(PROJECTS_DIR)) return { records, invalid };

  for (const entry of fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const metaPath = path.join(PROJECTS_DIR, entry.name, "project.yaml");
    if (!fs.existsSync(metaPath)) continue;
    try {
      const meta = projectMetaSchema.parse(loadYaml(fs.readFileSync(metaPath, "utf-8")));
      records.push({
        slug: entry.name,
        notionPageId: meta.notion_page_id,
        dropboxPath: meta.dropbox_path,
        migrated: meta.content_location === "dropbox",
      });
    } catch {
      invalid.push(entry.name);
    }
  }
  return { records, invalid };
}

function contentChecks(): DoctorCheck[] {
  const group = "Project content";

  return safe(group, "Project records", () => {
    const { records, invalid } = readProjectRecords();
    const checks: DoctorCheck[] = [];
    const total = records.length + invalid.length;

    checks.push(
      check(
        group,
        "Project records",
        invalid.length > 0 ? "fail" : "ok",
        invalid.length > 0
          ? `${total} project folder(s); ${invalid.length} invalid project.yaml — ${sample(invalid)}`
          : `${total} project folder(s), all project.yaml files valid`,
        invalid.length > 0
          ? "Run `npm run validate-content` for the exact schema errors."
          : undefined,
        true,
      ),
    );

    // Linkage is reported, never graded. An unlinked project is a legitimate state — the
    // human confirmation these IDs require is the whole point — so these stay `ok` and
    // carry their guidance in the detail line rather than as a fix for a non-problem.
    const notionLinked = records.filter((record) => record.notionPageId).length;
    checks.push(
      check(
        group,
        "Notion links",
        "ok",
        notionLinked < records.length
          ? `${notionLinked}/${records.length} project(s) linked to a Notion page; link one with \`mi notion link\` once you have confirmed the match`
          : `${notionLinked}/${records.length} project(s) linked to a Notion page`,
      ),
    );

    const dropboxLinked = records.filter(isDropboxLinked);
    const migrated = records.filter((record) => record.migrated).length;
    checks.push(
      check(
        group,
        "Dropbox links",
        "ok",
        `${dropboxLinked.length}/${records.length} project(s) linked to a Dropbox folder, ${migrated} migrated to shared storage` +
          (dropboxLinked.length < records.length
            ? "; `npm run suggest-dropbox-links` prints ranked candidates without writing anything"
            : ""),
      ),
    );

    // A linked path that no longer resolves is the difference between "not set up yet"
    // and "silently reading the wrong place", so it is reported separately from the count.
    const dropboxRoot = DROPBOX_ROOT;
    if (dropboxRoot && dropboxLinked.length > 0) {
      const broken = dropboxLinked
        .filter((record) => !fs.existsSync(path.join(dropboxRoot, record.dropboxPath)))
        .map((record) => record.slug);
      checks.push(
        check(
          group,
          "Linked Dropbox folders resolve",
          broken.length > 0 ? "warn" : "ok",
          broken.length > 0
            ? `${broken.length} linked folder(s) not found on disk — ${sample(broken)}`
            : `all ${dropboxLinked.length} linked folder(s) found under DROPBOX_ROOT`,
          broken.length > 0
            ? "Check that Dropbox is running and has finished syncing. If the folder was renamed or moved (e.g. into Complete/ or Archive/), confirm the new location yourself and re-link it with `mi dropbox link <slug> \"<new path>\"` — Mi will not re-point a confirmed link on its own."
            : undefined,
        ),
      );
    }

    return checks;
  });
}

function dropboxChecks(): DoctorCheck[] {
  const group = "Dropbox";
  const checks: DoctorCheck[] = [];

  const rootOk = Boolean(DROPBOX_ROOT && fs.existsSync(DROPBOX_ROOT));
  checks.push(
    ...safe(group, "DROPBOX_ROOT", () => {
      if (!DROPBOX_ROOT) {
        return check(
          group,
          "DROPBOX_ROOT",
          "warn",
          "not configured; Dropbox browsing and project harnesses are unavailable",
          "Set DROPBOX_ROOT in .env.local (or finish /onboarding) to this machine's local Dropbox path.",
        );
      }
      return check(
        group,
        "DROPBOX_ROOT",
        rootOk ? "ok" : "fail",
        rootOk ? DROPBOX_ROOT : `configured but not found: ${DROPBOX_ROOT}`,
        rootOk
          ? undefined
          : "The path is set but missing. Check that Dropbox is running and that the drive is mounted.",
      );
    }),
  );

  checks.push(
    ...safe(group, "Shared firm data", () => {
      const firmPath = process.env.DROPBOX_FIRM_DATA_PATH;
      if (!firmPath) {
        return check(
          group,
          "Shared firm data",
          "ok",
          "not migrated; clients and leads read from this machine's local folders",
        );
      }
      const absolute = DROPBOX_ROOT ? path.join(DROPBOX_ROOT, firmPath) : firmPath;
      const exists = fs.existsSync(absolute);
      return check(
        group,
        "Shared firm data",
        exists ? "ok" : "fail",
        exists ? `migrated: ${absolute}` : `migrated, but the shared folder is missing: ${absolute}`,
        exists
          ? undefined
          : "Clients and leads are configured to read from Dropbox but the folder is unreachable. Check Dropbox sync before editing anything.",
      );
    }),
  );

  checks.push(
    ...safe(group, "Conflicted copies", () => {
      const dropboxRoot = DROPBOX_ROOT;
      if (!rootOk || !dropboxRoot) {
        return check(group, "Conflicted copies", "ok", "skipped; no reachable Dropbox root");
      }
      // Only migrated projects keep Mi's own data in Dropbox, so only those can grow a
      // Dropbox conflicted copy of a file Mi reads. Scanning just those keeps this bounded.
      const { records } = readProjectRecords();
      const migrated = records.filter(
        (record): record is DropboxLinkedProject => record.migrated && isDropboxLinked(record),
      );
      if (migrated.length === 0) {
        return check(group, "Conflicted copies", "ok", "no projects migrated to shared storage");
      }

      const conflicted: string[] = [];
      for (const record of migrated) {
        const contentRoot = path.join(dropboxRoot, record.dropboxPath, "Mi");
        try {
          if (scanForConflicts(contentRoot).length > 0) conflicted.push(record.slug);
        } catch {
          // An unreachable project folder is already reported by the link check above.
        }
      }
      return check(
        group,
        "Conflicted copies",
        conflicted.length > 0 ? "warn" : "ok",
        conflicted.length > 0
          ? `Dropbox conflicted copies found in ${conflicted.length} project(s) — ${sample(conflicted)}`
          : `none across ${migrated.length} migrated project(s)`,
        conflicted.length > 0
          ? "Open those folders in Dropbox and merge each conflicted copy by hand. Mi deliberately never picks a winner."
          : undefined,
      );
    }),
  );

  return checks;
}

function securityChecks(repoRoot: string): DoctorCheck[] {
  const group = "Credentials";
  const checks: DoctorCheck[] = [];

  checks.push(
    ...safe(group, "Secrets untracked by Git", () => {
      const result = spawnSync("git", ["ls-files", "--", ".env", ".env.local", ".env.*.local"], {
        cwd: repoRoot,
        encoding: "utf8",
        shell: false,
        windowsHide: true,
      });
      if (result.status !== 0) {
        return check(group, "Secrets untracked by Git", "ok", "skipped; not a Git checkout");
      }
      const tracked = String(result.stdout ?? "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      return check(
        group,
        "Secrets untracked by Git",
        tracked.length > 0 ? "fail" : "ok",
        tracked.length > 0
          ? `credential file(s) tracked in Git: ${sample(tracked)}`
          : "no .env files are tracked",
        tracked.length > 0
          ? "Untrack them now (`git rm --cached <file>`), confirm .gitignore covers them, and rotate any credential that was committed."
          : undefined,
        true,
      );
    }),
  );

  checks.push(
    ...safe(group, "Shared agent memory", () => {
      const memoryDir = path.join(repoRoot, ".agent", "memory", "shared");
      const exists = fs.existsSync(memoryDir);
      return check(
        group,
        "Shared agent memory",
        exists ? "ok" : "warn",
        exists ? ".agent/memory/shared" : ".agent/memory/shared is missing",
        exists ? undefined : "Agent mode runs without reviewed shared memory until this folder exists.",
      );
    }),
  );

  return checks;
}

// --------------------------------------------------------------------------------------
// Command
// --------------------------------------------------------------------------------------

export function collectDoctorChecks(repoRoot = process.cwd()): DoctorCheck[] {
  return [
    ...environmentChecks(),
    ...installationChecks(repoRoot),
    ...configurationChecks(),
    ...agentChecks(),
    ...notionChecks(repoRoot),
    ...dropboxChecks(),
    ...contentChecks(),
    ...securityChecks(repoRoot),
  ];
}

const MARKER: Record<DoctorStatus, string> = { ok: "ok  ", warn: "warn", fail: "FAIL" };

export async function doctorCommand(args: string[] = []): Promise<void> {
  const unknown = args.filter((arg) => !["--json", "--help", "-h"].includes(arg));
  if (unknown.length > 0) throw new Error(`Unknown doctor option(s): ${unknown.join(", ")}`);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(DOCTOR_HELP);
    return;
  }

  const checks = collectDoctorChecks();
  const failed = checks.filter((entry) => entry.status === "fail").length;
  const warnings = checks.filter((entry) => entry.status === "warn").length;

  if (args.includes("--json")) {
    console.log(
      JSON.stringify({ ok: failed === 0, failedRequiredChecks: failed, warnings, checks }, null, 2),
    );
    if (failed > 0) process.exitCode = 1;
    return;
  }

  console.log("mi doctor\n");
  let currentGroup = "";
  for (const entry of checks) {
    if (entry.group !== currentGroup) {
      if (currentGroup) console.log("");
      console.log(entry.group);
      currentGroup = entry.group;
    }
    console.log(`  ${MARKER[entry.status]}  ${entry.label}${entry.detail ? ` — ${entry.detail}` : ""}`);
    if (entry.status !== "ok" && entry.fix) console.log(`        fix: ${entry.fix}`);
  }

  const summary = [
    `${checks.length} checks`,
    `${failed} failed`,
    `${warnings} warning${warnings === 1 ? "" : "s"}`,
  ].join(", ");

  if (failed > 0) {
    console.log(`\n${summary}. Mi will not work correctly until the failures above are fixed.`);
    process.exitCode = 1;
  } else if (warnings > 0) {
    console.log(`\n${summary}. Nothing is broken; the warnings are optional features not set up.`);
  } else {
    console.log(`\n${summary}. Everything checks out.`);
  }
}
