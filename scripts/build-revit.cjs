/* eslint-disable @typescript-eslint/no-require-imports -- Native build tooling is CommonJS. */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { minimizedEnvironment } = require("../electron/childEnvironment");
const { nativeVersion } = require("../electron/cad/install");

if (process.platform !== "win32") throw new Error("Build the native Revit payload on Windows with the matching Revit API installed.");
if (nativeVersion() !== "26.5.0.0") throw new Error("This build targets the installed Revit API 26.5.0.0; choose a matching build configuration for another version.");
const root = path.resolve(__dirname, "..");
const project = path.join(root, "integrations/revit/Mi.Revit");
const result = spawnSync("dotnet", ["build", path.join(project, "Mi.Revit.csproj"), "-c", "Release", "--nologo", "-v:q"], { encoding: "utf8", windowsHide: true, env: minimizedEnvironment(), maxBuffer: 32 * 1024 * 1024 });
const logRoot = path.join(root, ".tmp"); fs.mkdirSync(logRoot, { recursive: true });
fs.writeFileSync(path.join(logRoot, "revit-build.log"), result.stdout + result.stderr);
if (result.status !== 0) throw new Error("Native build failed. See .tmp/revit-build.log.");
const output = path.join(root, "integrations/revit/artifacts/2026");
fs.mkdirSync(output, { recursive: true });
const names = ["Mi.Revit.dll", "Mi.Revit.deps.json"];
// Use the same local signing identity as Mi's Windows release. Never export its key.
const dll = path.join(project, "bin/Release/net10.0-windows/Mi.Revit.dll");
const quote = value => `'${value.replaceAll("'", "''")}'`;
const signature = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
  `$ErrorActionPreference='Stop'; $certificate=Get-Item 'Cert:\\CurrentUser\\My\\0000000000000000000000000000000000000000'; $signed=Set-AuthenticodeSignature -LiteralPath ${quote(dll)} -Certificate $certificate -HashAlgorithm SHA256; if($signed.Status -ne 'Valid'){throw 'Native DLL signing failed.'}`],
  { encoding: "utf8", windowsHide: true, env: minimizedEnvironment(), timeout: 30000 });
if (signature.status !== 0) throw new Error("Native signing failed; verify the existing STUDIO code-signing identity locally.");
const files = names.map(name => {
  const bytes = fs.readFileSync(path.join(project, "bin/Release/net10.0-windows", name));
  fs.writeFileSync(path.join(output, name), bytes);
  return { name, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
});
fs.writeFileSync(path.join(output, "payload.json"), JSON.stringify({ version: "0.1.0", year: "2026", apiVersion: "26.5.0.0", framework: "net10.0-windows", files }, null, 2) + "\n");
fs.copyFileSync(path.join(root, "integrations/revit/Install-MiRevit.ps1"), path.join(output, "Install-MiRevit.ps1"));
const JSZip = require("jszip");
const zip = new JSZip();
for (const name of [...names, "payload.json", "Install-MiRevit.ps1"]) zip.file(name, fs.readFileSync(path.join(output, name)));
fs.mkdirSync(path.join(root, "dist-installer"), { recursive: true });
zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }).then(bytes => {
  fs.writeFileSync(path.join(root, "dist-installer/Mi-Revit-0.1.0-api26.5.zip"), bytes);
  console.log("Standalone native add-in package: dist-installer/Mi-Revit-0.1.0-api26.5.zip");
}).catch(error => { console.error(error.message); process.exitCode = 1; });
console.log("Native Revit payload built and hashed: integrations/revit/artifacts/2026 (API 26.5.0.0).");
if (/warning /i.test(result.stdout)) console.log("Compiler dependency warnings are recorded in .tmp/revit-build.log; live loading remains a required check.");
