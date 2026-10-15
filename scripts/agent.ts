import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load as loadYaml } from "js-yaml";
import { loadAgentContext, buildAgentPrompt, type AgentContext } from "../lib/agentContext";
import { captureAgentProposalReply } from "../lib/content/agentProposalInbox";

export { loadAgentContext, buildAgentPrompt };
export type { AgentContext };
export type AgentEngine = "codex" | "claude";

export interface AgentOptions {
  engine: AgentEngine;
  model?: string;
  project?: string;
  prompt: string;
  dryRun: boolean;
  help: boolean;
}

export interface EngineInvocation {
  command: string;
  args: string[];
  stdin: string;
}

interface ResolvedEngineCommand {
  command: string;
  prefixArgs: string[];
}

const require = createRequire(import.meta.url);
const { resolveInstalledProjectWorkspace } = require("../electron/projectRuntime.js") as {
  resolveInstalledProjectWorkspace(input: {
    dropboxRoot: string | undefined;
    dropboxPath: string;
    requireHarness?: boolean;
  }): string;
};

const PROJECT_SLUG_PATTERN = /^[a-z0-9-]+$/;

const AGENT_HELP = `Mi agent mode

Usage:
  mi agent [options] "<prompt>"
  npm run agent -- [options] "<prompt>"

Options:
  --engine <codex|claude>  AI engine (default: MI_AGENT_ENGINE or codex)
  --model <model>          One-call model override
  --project <slug>         Scope context to projects/<slug>
  --dry-run                Show the invocation plan without calling an AI engine
  -h, --help               Show this help

Environment:
  MI_AGENT_ENGINE          Default engine
  MI_AGENT_MODEL           Default model for either engine
  MI_CODEX_MODEL           Default Codex model
  MI_CLAUDE_MODEL          Default Claude model
  MI_CODEX_BIN             Codex executable name/path (default: codex)
  MI_CLAUDE_BIN            Claude executable name/path (default: claude)
  MI_AGENT_CONTEXT_MAX_BYTES
                           Maximum loaded memory/project context (default: 250000)

Valid mi-proposals from a successful project run are saved as pending drafts in
that confirmed Dropbox project's Mi/inbox. Mi still requires review and confirmation.

Examples:
  mi agent --engine codex "summarize open review comments"
  mi agent --project chicago "draft today's progress log"
  mi agent --engine claude --model sonnet "find unresolved code references"
`;

function requireFlagValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parseEngine(value: string): AgentEngine {
  if (value !== "codex" && value !== "claude") {
    throw new Error(`Unsupported engine "${value}". Use "codex" or "claude".`);
  }
  return value;
}

export function parseAgentArgs(
  argv: string[],
  env: Readonly<Record<string, string | undefined>> = process.env,
): AgentOptions {
  let engine = parseEngine(env.MI_AGENT_ENGINE ?? "codex");
  let model: string | undefined;
  let project: string | undefined;
  let dryRun = false;
  let help = false;
  const promptParts: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      promptParts.push(...argv.slice(i + 1));
      break;
    }
    if (arg === "--engine") {
      engine = parseEngine(requireFlagValue(argv, i, arg));
      i++;
      continue;
    }
    if (arg === "--model") {
      model = requireFlagValue(argv, i, arg);
      i++;
      continue;
    }
    if (arg === "--project") {
      project = requireFlagValue(argv, i, arg);
      i++;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      help = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option "${arg}".`);
    }
    promptParts.push(arg);
  }

  if (project && !PROJECT_SLUG_PATTERN.test(project)) {
    throw new Error(
      `Invalid project slug "${project}". Use lowercase letters, numbers, and hyphens only.`,
    );
  }

  model ??=
    env.MI_AGENT_MODEL ??
    (engine === "codex" ? env.MI_CODEX_MODEL : env.MI_CLAUDE_MODEL);

  return {
    engine,
    model,
    project,
    prompt: promptParts.join(" ").trim(),
    dryRun,
    help,
  };
}

function findWindowsCommand(command: string): string | null {
  const result = spawnSync("where.exe", [command], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (result.status !== 0) return null;
  return (
    result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? null
  );
}

function resolveEngineCommand(
  engine: AgentEngine,
  env: Readonly<Record<string, string | undefined>>,
): ResolvedEngineCommand {
  const override = engine === "codex" ? env.MI_CODEX_BIN : env.MI_CLAUDE_BIN;
  if (override) return { command: override, prefixArgs: [] };

  if (process.platform !== "win32") {
    return { command: engine, prefixArgs: [] };
  }

  if (engine === "claude") {
    return { command: "claude.exe", prefixArgs: [] };
  }

  // Global npm installs expose codex.cmd, which Node cannot spawn safely with
  // shell:false. Resolve that shim to the package's JavaScript entry point and
  // run it with the current Node executable instead of enabling a command shell.
  const shimPath = findWindowsCommand("codex.cmd");
  if (shimPath) {
    const codexEntry = path.join(
      path.dirname(shimPath),
      "node_modules",
      "@openai",
      "codex",
      "bin",
      "codex.js",
    );
    if (fs.existsSync(codexEntry)) {
      return { command: process.execPath, prefixArgs: [codexEntry] };
    }
  }

  // Supports a future/native Windows installation; users with another layout
  // can always provide an exact executable path through MI_CODEX_BIN.
  return { command: "codex.exe", prefixArgs: [] };
}

export function buildEngineInvocation(
  options: AgentOptions,
  context: AgentContext,
  workingDirectory: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): EngineInvocation {
  const prompt = buildAgentPrompt(options, context);
  const executable = resolveEngineCommand(options.engine, env);

  if (options.engine === "codex") {
    const args = [...executable.prefixArgs, "exec", "--ephemeral", "--cd", workingDirectory];
    if (options.model) args.push("--model", options.model);
    args.push("-");
    return {
      command: executable.command,
      args,
      stdin: prompt,
    };
  }

  const args = [...executable.prefixArgs, "-p"];
  if (options.model) args.push("--model", options.model);
  return {
    command: executable.command,
    args,
    stdin: prompt,
  };
}

export function resolveAgentWorkingDirectory(
  repoRoot: string,
  project: string | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  if (!project) return repoRoot;

  const projectFile = path.join(repoRoot, "projects", project, "project.yaml");
  if (!fs.existsSync(projectFile)) {
    throw new Error(`Project "${project}" does not exist at projects/${project}/.`);
  }
  const metadata = loadYaml(fs.readFileSync(projectFile, "utf8")) as {
    dropbox_path?: unknown;
  } | null;
  const dropboxPath =
    typeof metadata?.dropbox_path === "string" ? metadata.dropbox_path.trim() : "";
  if (!dropboxPath) {
    throw new Error(
      `Project "${project}" needs a confirmed dropbox_path before running a project agent.`,
    );
  }

  return resolveInstalledProjectWorkspace({
    dropboxRoot: env.DROPBOX_ROOT,
    dropboxPath,
    requireHarness: true,
  });
}

interface InvocationResult {
  code: number;
  stdout: string;
}

async function runInvocation(
  invocation: EngineInvocation,
  workingDirectory: string,
  engine: AgentEngine,
): Promise<InvocationResult> {
  return await new Promise<InvocationResult>((resolve, reject) => {
    let stdout = "";
    const child = spawn(invocation.command, invocation.args, {
      cwd: workingDirectory,
      env: { ...process.env, MI_AGENT_MODE: "terminal-agent" },
      shell: false,
      stdio: ["pipe", "pipe", "inherit"],
      windowsHide: true,
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      process.stdout.write(chunk);
      stdout += chunk;
      if (stdout.length > 4_000_000) stdout = stdout.slice(-4_000_000);
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(
          new Error(
            `${engine} CLI was not found. Install and authenticate it, or set ` +
              `${engine === "codex" ? "MI_CODEX_BIN" : "MI_CLAUDE_BIN"}.`,
          ),
        );
        return;
      }
      reject(error);
    });
    child.on("close", (code) => resolve({ code: code ?? 1, stdout }));

    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE") reject(error);
    });
    child.stdin.end(invocation.stdin);
  });
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const currentFile = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(currentFile), "..");
  try {
    process.loadEnvFile(path.join(repoRoot, ".env.local"));
  } catch {
    // Environment variables may already be supplied by the parent process.
  }

  const options = parseAgentArgs(argv);
  if (options.help) {
    process.stdout.write(AGENT_HELP);
    return 0;
  }
  if (!options.prompt) {
    throw new Error("A prompt is required. Run `mi agent --help` for examples.");
  }

  const context = loadAgentContext(repoRoot, options.project);
  const workingDirectory = resolveAgentWorkingDirectory(repoRoot, options.project);
  const invocation = buildEngineInvocation(options, context, workingDirectory);

  if (options.dryRun) {
    process.stdout.write(
      `${JSON.stringify(
        {
          engine: options.engine,
          model: options.model ?? null,
          project: options.project ?? null,
          command: invocation.command,
          args: invocation.args,
          working_directory: workingDirectory,
          context_files: context.files,
          context_bytes: context.bytes,
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  const invocationResult = await runInvocation(invocation, workingDirectory, options.engine);
  if (invocationResult.code === 0 && options.project) {
    const capture = captureAgentProposalReply({
      workspace: workingDirectory,
      projectSlug: options.project,
      engine: options.engine,
      model: options.model,
      rawReply: invocationResult.stdout,
    });
    if (capture.status === "saved") {
      process.stderr.write(
        `\nMi saved ${capture.proposalCount} pending proposal(s) to Mi/inbox/${capture.fileName}. ` +
        "Review them in the project page before anything is applied.\n",
      );
    } else if (capture.status === "invalid") {
      process.stderr.write(`\nMi did not save the proposal block: ${capture.error}\n`);
    }
  }
  return invocationResult.code;
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
