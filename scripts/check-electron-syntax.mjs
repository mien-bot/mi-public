#!/usr/bin/env node
// Guards against duplicate top-level declarations (or other syntax errors) silently
// breaking the Electron main process, since these files have no dedicated unit test
// harness and a bad merge can otherwise ship a build that fails only at app launch.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";

const electronDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "electron");

const jsFiles = readdirSync(electronDir)
  .filter((name) => name.endsWith(".js") && !name.endsWith(".test.js"))
  .sort();

let failed = false;
for (const name of jsFiles) {
  const filePath = path.join(electronDir, name);
  try {
    new Script(readFileSync(filePath, "utf8"), { filename: filePath });
  } catch (error) {
    failed = true;
    console.error(`Syntax error in electron/${name}:`);
    console.error(error.message);
  }
}

if (failed) {
  process.exit(1);
}

console.log(`Checked ${jsFiles.length} electron/*.js files: syntax OK`);
