import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

export type ChatEngine = "claude" | "codex";

export interface ChatOptions {
  project?: string;
  engine?: ChatEngine;
  help: boolean;
}

const HELP = `Launch Mi's desktop chat

Usage:
  mi chat [--project <slug>] [--engine <claude|codex>]

Options:
  --project <slug>             Preselect an existing local project
  --engine <claude|codex>      Preselect the agent engine
  -h, --help                   Show this help
`;

function readValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

export function parseChatArgs(args: string[]): ChatOptions {
  const options: ChatOptions = { help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (arg === "--project") {
      const project = readValue(args, index, arg);
      if (!/^[a-z0-9][a-z0-9-]*$/.test(project)) {
        throw new Error(`Invalid project slug: ${project}`);
      }
      options.project = project;
      index += 1;
    } else if (arg === "--engine") {
      const engine = readValue(args, index, arg);
      if (engine !== "claude" && engine !== "codex") {
        throw new Error(`Invalid engine: ${engine}. Expected claude or codex.`);
      }
      options.engine = engine;
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

export function chatUrl(port: string, options: ChatOptions): string {
  const url = new URL(`http://localhost:${port}`);
  if (options.project) url.searchParams.set("project", options.project);
  if (options.engine) url.searchParams.set("engine", options.engine);
  return url.toString();
}

export function isServerResponding(url: string, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(true);
    });
    request.setTimeout(timeoutMs, () => request.destroy());
    request.on("error", () => resolve(false));
  });
}

function parsePort(raw: string): string {
  if (!/^\d+$/.test(raw)) throw new Error(`Invalid STUDIO_ELECTRON_PORT: ${raw}`);
  const port = Number(raw);
  if (port < 1 || port > 65535) throw new Error(`Invalid STUDIO_ELECTRON_PORT: ${raw}`);
  return String(port);
}

function spawnMi(options: ChatOptions, repoRoot: string): ChildProcess {
  const isWindows = process.platform === "win32";
  const command = isWindows ? process.env.ComSpec || "cmd.exe" : "npm";
  const commandArgs = isWindows ? ["/d", "/s", "/c", "npm run electron:dev"] : ["run", "electron:dev"];
  const childEnv = { ...process.env };
  if (options.project) childEnv.MI_CHAT_PROJECT = options.project;
  else delete childEnv.MI_CHAT_PROJECT;
  if (options.engine) childEnv.MI_CHAT_ENGINE = options.engine;
  else delete childEnv.MI_CHAT_ENGINE;

  return spawn(command, commandArgs, {
    cwd: repoRoot,
    detached: true,
    env: childEnv,
    shell: false,
    stdio: "ignore",
    windowsHide: true,
  });
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const options = parseChatArgs(argv);
  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  if (options.project && !fs.existsSync(path.join(repoRoot, "projects", options.project, "project.yaml"))) {
    throw new Error(`No project at projects/${options.project}/.`);
  }

  const port = parsePort(process.env.STUDIO_ELECTRON_PORT ?? "3050");
  const url = chatUrl(port, options);
  if (await isServerResponding(url)) {
    process.stdout.write(
      `Mi is already running at http://localhost:${port}.` +
        (options.project || options.engine ? " Restart it to apply launch selections.\n" : "\n"),
    );
    return 0;
  }

  process.stdout.write(`Launching Mi chat at ${url}\n`);
  const child = spawnMi(options, repoRoot);
  child.unref();
  return 0;
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