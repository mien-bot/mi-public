/* eslint-disable @typescript-eslint/no-require-imports -- Native build tooling is CommonJS. */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { minimizedEnvironment } = require("../electron/childEnvironment");
const { autocadApiVersion, AUTOCAD_API } = require("../electron/cad/install");

if (process.platform !== "win32") throw new Error("Build the native AutoCAD payload on Windows with the matching AutoCAD API installed.");
if (autocadApiVersion() !== AUTOCAD_API) throw new Error(`This build targets the installed AutoCAD API ${AUTOCAD_API}; choose a matching build configuration for another version.`);
const root = path.resolve(__dirname, "..");
const project = path.join(root, "integrations/autocad/Mi.AutoCAD");
const result = spawnSync("dotnet", ["build", path.join(project, "Mi.AutoCAD.csproj"), "-c", "Release", "--nologo", "-v:q"], { encoding: "utf8", windowsHide: true, env: minimizedEnvironment(), maxBuffer: 32 * 1024 * 1024 });
const logRoot = path.join(root, ".tmp"); fs.mkdirSync(logRoot, { recursive: true });
fs.writeFileSync(path.join(logRoot, "autocad-build.log"), result.stdout + result.stderr);
if (result.status !== 0) throw new Error("Native build failed. See .tmp/autocad-build.log.");
const build = path.join(project, "bin/Release/net10.0-windows");
const output = path.join(root, "integrations/autocad/artifacts/2027");
fs.mkdirSync(output, { recursive: true });
// Use the same local signing identity as Mi's Windows release. Never export its key.
const dll = path.join(build, "Mi.AutoCAD.dll");
const quote = value => `'${value.replaceAll("'", "''")}'`;
const signature = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
  `$ErrorActionPreference='Stop'; $certificate=Get-Item 'Cert:\\CurrentUser\\My\\0000000000000000000000000000000000000000'; $signed=Set-AuthenticodeSignature -LiteralPath ${quote(dll)} -Certificate $certificate -HashAlgorithm SHA256; if($signed.Status -ne 'Valid'){throw 'Native DLL signing failed.'}`],
  { encoding: "utf8", windowsHide: true, env: minimizedEnvironment(), timeout: 30000 });
if (signature.status !== 0) throw new Error("Native signing failed; verify the existing STUDIO code-signing identity locally.");
const sources = [[path.join(build, "Mi.AutoCAD.dll"), "Mi.AutoCAD.dll"], [path.join(build, "Mi.AutoCAD.deps.json"), "Mi.AutoCAD.deps.json"], [path.join(root, "integrations/autocad/PackageContents.xml"), "PackageContents.xml"]];
const files = sources.map(([source, name]) => {
  const bytes = fs.readFileSync(source);
  fs.writeFileSync(path.join(output, name), bytes);
  return { name, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
});
fs.writeFileSync(path.join(output, "payload.json"), JSON.stringify({ version: "0.1.0", year: "2027", apiVersion: AUTOCAD_API, framework: "net10.0-windows", files }, null, 2) + "\n");
console.log(`Native AutoCAD payload built and hashed: integrations/autocad/artifacts/2027 (API ${AUTOCAD_API}).`);
