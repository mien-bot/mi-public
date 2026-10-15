import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SUPPORTED_ARCHITECTURES = new Set(["arm64", "x86_64"]);
const REQUIRED_MINIMUM_SYSTEM_VERSION = "12.0";

function fail(message) {
  throw new Error(message);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) fail(`${command} could not run: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    fail(`${command} failed${detail ? `: ${detail}` : "."}`);
  }
  return (result.stdout || result.stderr || "").trim();
}

export function inspectMacApplication(appPath, expectedArchitecture) {
  if (process.platform !== "darwin") {
    fail("Mac release verification must run on macOS.");
  }
  const resolvedAppPath = path.resolve(appPath);
  if (!resolvedAppPath.endsWith(".app") || !fs.statSync(resolvedAppPath, { throwIfNoEntry: false })?.isDirectory()) {
    fail("Pass the path to an unpacked Mi.app bundle.");
  }
  if (expectedArchitecture && !SUPPORTED_ARCHITECTURES.has(expectedArchitecture)) {
    fail("Expected architecture must be arm64 or x86_64.");
  }

  const infoPlist = path.join(resolvedAppPath, "Contents", "Info.plist");
  const executable = path.join(resolvedAppPath, "Contents", "MacOS", "Mi");
  if (!fs.statSync(infoPlist, { throwIfNoEntry: false })?.isFile()) fail("Mi.app is missing Info.plist.");
  if (!fs.statSync(executable, { throwIfNoEntry: false })?.isFile()) fail("Mi.app is missing its main executable.");

  const minimumSystemVersion = run("plutil", [
    "-extract",
    "LSMinimumSystemVersion",
    "raw",
    "-o",
    "-",
    infoPlist,
  ]);
  if (minimumSystemVersion !== REQUIRED_MINIMUM_SYSTEM_VERSION) {
    fail(
      `Mi.app declares macOS ${minimumSystemVersion || "unknown"}; expected ${REQUIRED_MINIMUM_SYSTEM_VERSION}.`,
    );
  }

  const architectures = run("lipo", ["-archs", executable]).split(/\s+/).filter(Boolean);
  if (expectedArchitecture && !architectures.includes(expectedArchitecture)) {
    fail(`Mi.app architectures are ${architectures.join(", ") || "unknown"}; expected ${expectedArchitecture}.`);
  }

  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", resolvedAppPath]);
  run("spctl", ["--assess", "--type", "execute", "--verbose=2", resolvedAppPath]);
  run("xcrun", ["stapler", "validate", resolvedAppPath]);

  return {
    appPath: resolvedAppPath,
    minimumSystemVersion,
    architectures,
    signed: true,
    gatekeeperAccepted: true,
    notarizationTicketStapled: true,
  };
}

function main() {
  const [, , appPath, expectedArchitecture] = process.argv;
  if (!appPath) {
    fail("Usage: npm run verify:mac -- /absolute/path/to/Mi.app [arm64|x86_64]");
  }
  const result = inspectMacApplication(appPath, expectedArchitecture);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
