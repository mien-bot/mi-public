#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsxCli = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
try {
  process.loadEnvFile(path.join(repoRoot, ".env.local"));
} catch {
  // Environment variables may already be supplied by the parent process.
}

const HELP = `Mi CLI

Usage:
  mi <command> [options]

Commands:
  agent                 Run an agent and capture project proposals for Mi review
  proposals submit      Validate a proposal JSON file into pending Mi review cards
  review list           Show the Mi review cards waiting for confirmation
  review confirm        Preview and confirm several review cards in one action
  fetch                 Read a public web page or PDF from this computer
  chat                  Launch the desktop chat UI
  doctor                Diagnose this install and print how to fix what is wrong
  validate              Validate project, code, and reference content
  project new           Scaffold a project
  checklist suggest     Suggest checklist items by occupancy
  notion probe          List pages/databases visible to the Notion token
  notion link           Link a local project to a Notion project
  notion pull           Preview or apply Notion fields to local project data
  notion map            Build a read-only project/schedule map from Notion
  notion project        Preview or apply project creates/updates in Notion
  dropbox link          Link a local project to a real Dropbox folder
  dropbox sync          Preview or refresh the generated Dropbox project snapshot
  qaqc review           Inventory a confirmed Dropbox project for drawing review
  help                  Show this help

Examples:
  mi agent --project chicago "summarize open review comments"
  mi proposals submit --project chicago mi-proposals.json
  mi review confirm --project chicago --all --yes
  mi fetch https://www.chicago.gov/city/en/depts/dcd.html
  mi chat --project chicago --engine codex
  mi validate
  mi project new lakeside "Lakeside Residence"
  mi checklist suggest chicago
  mi notion map --write
  mi notion project update example-record-35 --status in-progress
  mi qaqc review --project example-record-35 --max-files 50

Run \`mi agent --help\` or \`mi review --help\` for their own flags.
`;

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exitCode = code;
}

function runNode(script, args) {
  if (!fs.existsSync(script)) {
    fail(`Mi command script is missing: ${path.relative(repoRoot, script)}`);
    return;
  }
  if (!fs.existsSync(tsxCli)) {
    fail("Dependencies are not installed. Run `npm install` in the Mi repository.");
    return;
  }

  const child = spawn(process.execPath, [tsxCli, script, ...args], {
    cwd: repoRoot,
    env: { ...process.env, MI_CLI_CALLER_CWD: process.cwd() },
    shell: false,
    stdio: "inherit",
    windowsHide: true,
  });
  child.on("error", (error) => fail(error.message));
  child.on("close", (code) => {
    process.exitCode = code ?? 1;
  });
}

const [command = "help", ...args] = process.argv.slice(2);
const groupHelp =
  ["notion", "dropbox", "project", "checklist", "qaqc", "proposals"].includes(command) &&
  ["help", "--help", "-h"].includes(args[0]);

if (command === "help" || command === "--help" || command === "-h" || groupHelp) {
  process.stdout.write(HELP);
} else if (command === "doctor") {
  runNode(path.join(repoRoot, "scripts", "mi.ts"), ["doctor", ...args]);
} else if (command === "agent") {
  runNode(path.join(repoRoot, "scripts", "agent.ts"), args);
} else if (command === "proposals" && args[0] === "submit") {
  runNode(path.join(repoRoot, "scripts", "proposals.ts"), args);
} else if (command === "review") {
  runNode(path.join(repoRoot, "scripts", "review.ts"), args);
} else if (command === "fetch") {
  runNode(path.join(repoRoot, "scripts", "fetchUrl.ts"), args);
} else if (command === "chat") {
  runNode(path.join(repoRoot, "scripts", "chat.ts"), args);
} else if (command === "validate") {
  runNode(path.join(repoRoot, "scripts", "validate-content.ts"), args);
} else if (command === "project" && args[0] === "new") {
  runNode(path.join(repoRoot, "scripts", "new-project.ts"), args.slice(1));
} else if (command === "checklist" && args[0] === "suggest") {
  runNode(path.join(repoRoot, "scripts", "suggest-checklist-items.ts"), args.slice(1));
} else if (command === "notion" && args[0] === "probe") {
  runNode(path.join(repoRoot, "scripts", "notion-probe.ts"), args.slice(1));
} else if (command === "notion" && args[0] === "link") {
  runNode(path.join(repoRoot, "scripts", "mi.ts"), ["notion", "link", ...args.slice(1)]);
} else if (command === "notion" && args[0] === "pull") {
  runNode(path.join(repoRoot, "scripts", "mi.ts"), ["notion", "pull", ...args.slice(1)]);
} else if (command === "notion" && args[0] === "map") {
  runNode(path.join(repoRoot, "scripts", "notion-project-map.ts"), args.slice(1));
} else if (command === "notion" && args[0] === "project") {
  runNode(path.join(repoRoot, "scripts", "notion-project-write.ts"), args.slice(1));
} else if (command === "dropbox" && args[0] === "link") {
  runNode(path.join(repoRoot, "scripts", "mi.ts"), ["dropbox", "link", ...args.slice(1)]);
} else if (command === "dropbox" && args[0] === "sync") {
  runNode(path.join(repoRoot, "scripts", "mi.ts"), ["dropbox", "sync", ...args.slice(1)]);
} else if (command === "qaqc" && args[0] === "review") {
  runNode(path.join(repoRoot, "scripts", "qaqc-review.ts"), args.slice(1));
} else {
  fail(`Unknown Mi command: ${[command, ...args].join(" ")}\n\n${HELP}`, 2);
}
