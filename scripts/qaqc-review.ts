import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDropboxReviewBrief,
  renderDropboxReviewBrief,
} from "../lib/qaqc/dropboxReview";

interface Options {
  project: string;
  format: "markdown" | "json";
  maxFiles: number;
}

function parseArgs(args: string[]): Options {
  let project = "";
  let format: Options["format"] = "markdown";
  let maxFiles = 500;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--project") {
      project = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--format") {
      const value = args[index + 1];
      if (value !== "markdown" && value !== "json") {
        throw new Error("--format must be markdown or json.");
      }
      format = value;
      index += 1;
    } else if (arg === "--max-files") {
      const value = Number(args[index + 1]);
      if (!Number.isInteger(value) || value < 1) {
        throw new Error("--max-files must be a positive integer.");
      }
      maxFiles = value;
      index += 1;
    } else {
      throw new Error(`Unknown QA/QC review option: ${arg}`);
    }
  }
  if (!project) {
    throw new Error(
      "Usage: mi qaqc review --project <slug> [--format markdown|json] [--max-files <count>]",
    );
  }
  return { project, format, maxFiles };
}

export function main(args = process.argv.slice(2)): number {
  const options = parseArgs(args);
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const brief = buildDropboxReviewBrief({
    repoRoot,
    dropboxRoot: process.env.DROPBOX_ROOT,
    projectSlug: options.project,
    maxFiles: options.maxFiles,
  });
  process.stdout.write(
    options.format === "json"
      ? `${JSON.stringify(brief, null, 2)}\n`
      : `${renderDropboxReviewBrief(brief)}\n`,
  );
  return 0;
}

const direct =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (direct) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
