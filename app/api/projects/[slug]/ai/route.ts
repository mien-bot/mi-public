import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getProject, getProjectDetails, getProjectSlugs, getSchedule, resolveProjectIdentity } from "@/lib/content";
import { PROJECTS_DIR } from "@/lib/content/paths";
import {
  aiMeetingResponseSchema,
  aiPlanResponseSchema,
  projectPlanningInputSchema,
} from "@/lib/schema";
import {
  PROJECT_DRAFT_READ_ONLY,
  projectDraftEnvironment,
  projectDraftPrompt,
} from "@/lib/ai/projectDraftSecurity";

function parseJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  const candidate = fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(candidate);
}

const SAFE_CHILD_ENV_KEYS = [
  "APPDATA", "ComSpec", "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA", "Path", "PATH",
  "PATHEXT", "SystemDrive", "SystemRoot", "TEMP", "TMP", "USERNAME", "USERPROFILE", "windir",
];
const UNSAFE_SHELL_CHARACTERS = /["%!\r\n&|<>^()]/;

function validToolCommand(command: string): boolean {
  return Boolean(command.trim()) && !UNSAFE_SHELL_CHARACTERS.test(command);
}

function safeAgentEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: process.env.NODE_ENV || "production",
    ...Object.fromEntries(
    SAFE_CHILD_ENV_KEYS
      .map((key) => [key, process.env[key]])
      .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    ),
  };
}

function projectAgentCwd(slug: string, dropboxPath: string | null): string {
  if (process.env.MI_DESKTOP_PACKAGED !== "1") return path.join(PROJECTS_DIR, slug);
  const root = process.env.DROPBOX_ROOT;
  if (!root || !dropboxPath || path.isAbsolute(dropboxPath)) {
    throw new Error("Confirm the project Dropbox folder and repair its agent workspace first.");
  }
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error("DROPBOX_ROOT must be an existing directory.");
  }
  const resolvedRoot = fs.realpathSync(root);
  const projectCandidate = path.resolve(resolvedRoot, dropboxPath);
  const relative = path.relative(resolvedRoot, projectCandidate);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Project agent workspace escapes DROPBOX_ROOT.");
  }
  if (!fs.existsSync(projectCandidate) || !fs.statSync(projectCandidate).isDirectory()) {
    throw new Error("Confirmed project folder must be an existing directory.");
  }
  const projectRoot = fs.realpathSync(projectCandidate);
  const realProjectRelative = path.relative(resolvedRoot, projectRoot);
  if (
    !realProjectRelative ||
    realProjectRelative === ".." ||
    realProjectRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(realProjectRelative)
  ) {
    throw new Error("Project agent workspace escapes DROPBOX_ROOT.");
  }
  const workspace = path.join(projectRoot, "Mi");
  if (!fs.existsSync(path.join(workspace, "AGENTS.md")) || !fs.existsSync(path.join(workspace, "CLAUDE.md"))) {
    throw new Error("Repair/Refresh Agent Workspace before generating an AI draft.");
  }
  const resolvedWorkspace = fs.realpathSync(workspace);
  const workspaceRelative = path.relative(projectRoot, resolvedWorkspace);
  if (
    !workspaceRelative ||
    workspaceRelative === ".." ||
    workspaceRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(workspaceRelative)
  ) {
    throw new Error("Project agent workspace escapes the confirmed project folder.");
  }
  return resolvedWorkspace;
}

function runDraftAgent(engine: "codex" | "claude", cwd: string, prompt: string): Promise<string> {
  const command = (engine === "codex" ? process.env.MI_CODEX_BIN : process.env.MI_CLAUDE_BIN)
    || (engine === "codex" ? "codex" : "claude");
  if (!validToolCommand(command)) return Promise.reject(new Error(`Invalid ${engine} command.`));
  const args = engine === "codex"
    ? ["--sandbox", "read-only", "--ask-for-approval", "never", "exec", "--ephemeral", "-", "--json"]
    : ["-p", "--output-format", "json", "--tools", process.platform === "win32" ? '\"\"' : "", "--permission-mode", "plan", "--no-session-persistence"];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      shell: process.platform === "win32",
      env: projectDraftEnvironment(
        engine,
        safeAgentEnvironment(),
        process.env.CLAUDE_CODE_OAUTH_TOKEN,
      ),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) return reject(new Error(stderr.trim() || `${engine} exited with code ${code}.`));
      if (engine === "claude") {
        try { return resolve(JSON.parse(stdout).result ?? ""); } catch { return reject(new Error("Claude returned invalid JSON output.")); }
      }
      const lines = stdout.split(/\r?\n/).filter(Boolean);
      for (let index = lines.length - 1; index >= 0; index--) {
        try {
          const event = JSON.parse(lines[index]);
          if (event.type === "item.completed" && event.item?.type === "agent_message") return resolve(event.item.text ?? "");
        } catch { /* ignore non-JSON diagnostic lines */ }
      }
      reject(new Error("Codex returned no draft."));
    });
    child.stdin.end(prompt, "utf8");
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getProjectSlugs().includes(slug)) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  const body = await request.json().catch(() => null);
  const engine = body?.engine === "claude" ? "claude" : "codex";
  const project = getProject(slug);
  try {
    let prompt: string;
    let parser: { parse(value: unknown): unknown };
    if (body?.purpose === "planning") {
      const input = projectPlanningInputSchema.parse(body.input);
      const details = getProjectDetails(slug);
      const identity = resolveProjectIdentity(project.meta, details);
      const schedule = getSchedule(slug);
      prompt = projectDraftPrompt("planning", project.meta.name, {
        user_request: input,
        // Resolved, not raw meta: an agent reading a stale registry address and
        // then proposing a "correction" back to it is a drift loop.
        existing_project: {
          status: project.meta.status,
          client: identity.client,
          address: identity.address,
          team: identity.team,
          building_type: project.meta.building_type,
          occupancy_group: project.meta.occupancy_group,
          start_date: project.meta.start_date,
        },
        existing_details: details,
        existing_milestones: schedule.milestones.map((milestone) => ({
          name: milestone.name,
          planned_date: milestone.planned_date,
          actual_date: milestone.actual_date,
        })),
      });
      parser = aiPlanResponseSchema;
    } else if (body?.purpose === "meeting") {
      const meeting = body?.meeting ?? {};
      prompt = projectDraftPrompt("meeting", project.meta.name, meeting);
      parser = aiMeetingResponseSchema;
    } else {
      return NextResponse.json({ error: "Unknown AI draft purpose." }, { status: 400 });
    }
    const output = await runDraftAgent(engine, projectAgentCwd(slug, project.meta.dropbox_path), prompt);
    return NextResponse.json({
      draft: parser.parse(parseJson(output)),
      engine,
      read_only: PROJECT_DRAFT_READ_ONLY,
    });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "AI draft failed." }, { status: 502 });
  }
}
