import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const source = path.join(repoRoot, "dist-installer", "win-unpacked");
const smokeRoot = path.join(os.tmpdir(), "Mi Partner Smoke Test");
const applicationRoot = path.join(smokeRoot, "Installed Application");
const userDataRoot = path.join(smokeRoot, "Partner Profile");
const executable = path.join(applicationRoot, "Mi.exe");
const smokePort = String(31_000 + (process.pid % 1_000));

if (!fs.existsSync(path.join(source, "Mi.exe"))) {
  throw new Error("Build dist-installer/win-unpacked before running the installed smoke test.");
}

fs.rmSync(smokeRoot, { recursive: true, force: true });
fs.mkdirSync(smokeRoot, { recursive: true });
fs.cpSync(source, applicationRoot, { recursive: true });

function launch(pass) {
  const report = path.join(smokeRoot, `smoke-${pass}.json`);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [`--user-data-dir=${userDataRoot}`], {
      cwd: applicationRoot,
      env: {
        SystemRoot: process.env.SystemRoot,
        windir: process.env.windir,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        APPDATA: process.env.APPDATA,
        LOCALAPPDATA: process.env.LOCALAPPDATA,
        USERPROFILE: process.env.USERPROFILE,
        ComSpec: process.env.ComSpec,
        PATH: path.join(process.env.SystemRoot || "C:\\Windows", "System32"),
        STUDIO_ELECTRON_PORT: smokePort,
        MI_USER_DATA_DIR: userDataRoot,
        MI_SMOKE_REPORT_PATH: report,
      },
      windowsHide: true,
      stdio: "ignore",
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Installed Mi smoke pass ${pass} timed out.`));
    }, 90_000);
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`Installed Mi exited with ${code}.`));
      const result = JSON.parse(fs.readFileSync(report, "utf8"));
      if (result.status !== "passed") return reject(new Error(result.error || "Smoke test failed."));
      resolve(result);
    });
  });
}

const first = await launch(1);
if (first.setupCompleted !== false) {
  throw new Error("Expected a truly fresh profile to report setupCompleted=false.");
}
if (first.launchPath !== "/onboarding") {
  throw new Error(`Expected a fresh profile to launch into the onboarding wizard, got "${first.launchPath}".`);
}
const settingsPath = path.join(userDataRoot, "config", "settings.json");
const settingsBefore = fs.readFileSync(settingsPath, "utf8");
const second = await launch(2);
const settingsAfter = fs.readFileSync(settingsPath, "utf8");
if (settingsBefore !== settingsAfter) throw new Error("Per-user settings changed unexpectedly across restart.");

console.log(JSON.stringify({
  pathWithSpaces: applicationRoot,
  cleanFirstRun: first,
  restart: second,
  configurationPersisted: true,
  developerToolsAvailableThroughPath: false,
}, null, 2));

fs.rmSync(smokeRoot, { recursive: true, force: true });
