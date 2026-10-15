import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { captureAgentProposalReply } from "../lib/content/agentProposalInbox";
import { resolveAgentWorkingDirectory } from "./agent";

const MAX_PROPOSAL_FILE_BYTES = 1_000_000;
const PROJECT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const HELP = `Mi proposal submission

Usage:
  mi proposals submit --project <slug> <proposal.json>

Validates an exact JSON proposal file and creates pending Mi review cards.
It never confirms or applies project, Dropbox, or Notion changes.
`;

export interface ProposalSubmitOptions {
  help: boolean;
  project: string;
  filePath: string;
}

export function parseProposalSubmitArgs(argv: string[]): ProposalSubmitOptions {
  if (argv.includes("--help") || argv.includes("-h")) {
    return { help: true, project: "", filePath: "" };
  }
  if (argv[0] !== "submit") throw new Error("Use `mi proposals submit --project <slug> <proposal.json>`. ");
  let project = "";
  let filePath = "";
  for (let index = 1; index < argv.length; index++) {
    const value = argv[index];
    if (value === "--project") {
      project = argv[index + 1] ?? "";
      index++;
    } else if (!filePath) {
      filePath = value;
    } else {
      throw new Error("Submit exactly one proposal JSON file.");
    }
  }
  if (!PROJECT_SLUG.test(project)) throw new Error("A valid --project slug is required.");
  if (!filePath) throw new Error("A proposal JSON file path is required.");
  return { help: false, project, filePath };
}

export function readProposalSourceFile(filePath: string, callerCwd: string): string {
  const resolved = path.resolve(callerCwd, filePath);
  if (path.extname(resolved).toLowerCase() !== ".json") throw new Error("Choose a .json proposal file.");
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Choose a regular JSON file.");
  if (stat.size > MAX_PROPOSAL_FILE_BYTES) throw new Error("The proposal file exceeds Mi's 1 MB limit.");
  return fs.readFileSync(resolved, "utf8").replace(/^\uFEFF/, "");
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const options = parseProposalSubmitArgs(argv);
  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  try {
    process.loadEnvFile(path.join(repoRoot, ".env.local"));
  } catch {
    // Installed or parent-provided environment already supplies Mi settings.
  }
  const callerCwd = process.env.MI_CLI_CALLER_CWD || process.cwd();
  const rawReply = readProposalSourceFile(options.filePath, callerCwd);
  const workspace = resolveAgentWorkingDirectory(repoRoot, options.project);
  const result = captureAgentProposalReply({
    workspace,
    projectSlug: options.project,
    source: "mi-project-terminal-file",
    rawReply,
  });
  if (result.status === "saved") {
    process.stdout.write(
      `Mi created ${result.proposalCount} pending review card(s) in Mi/inbox/${result.fileName}. Nothing was applied.\n`,
    );
    return 0;
  }
  if (result.status === "duplicate") {
    process.stdout.write(
      `Those ${result.proposalCount} proposal(s) already exist in Mi's inbox. No duplicates were created.\n`,
    );
    return 0;
  }
  if (result.status === "conflict" || result.status === "invalid") {
    throw new Error(result.error);
  }
  throw new Error("The selected file contains no Mi proposal envelope.");
}

const isDirectExecution =
  process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

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
