/* eslint-disable @typescript-eslint/no-require-imports -- Native build tooling is CommonJS. */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { minimizedEnvironment } = require("../electron/childEnvironment");
const { autocadApiVersion, AUTOCAD_TARGETS, AUTOCAD_ADDIN_VERSION } = require("../electron/cad/install");

// Each AutoCAD release hosts its own .NET runtime, so each target is a separate build against
// that release's installed API. All targets go into one bundle, artifacts/bundle, with one
// manifest component per release; Mi installs that bundle whole. Building needs every supported
// AutoCAD installed, because no Autodesk assembly is redistributed or committed.
if (process.platform !== "win32") throw new Error("Build the native AutoCAD payload on Windows with the matching AutoCAD APIs installed.");
const root = path.resolve(__dirname, "..");
const project = path.join(root, "integrations/autocad/Mi.AutoCAD");
const programFiles = process.env.ProgramFiles || "C:\\Program Files";
const logRoot = path.join(root, ".tmp"); fs.mkdirSync(logRoot, { recursive: true });
const output = path.join(root, "integrations/autocad/artifacts/bundle");
const quote = value => `'${value.replaceAll("'", "''")}'`;
const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");

for (const target of AUTOCAD_TARGETS) {
  const autocadRoot = path.join(programFiles, "Autodesk", `AutoCAD ${target.year}`);
  if (autocadApiVersion(autocadRoot) !== target.apiVersion) throw new Error(`Building the bundle needs AutoCAD ${target.year} (API ${target.apiVersion}) installed at ${autocadRoot}.`);
}
fs.rmSync(output, { recursive: true, force: true });
const targets = AUTOCAD_TARGETS.map(target => {
  const autocadRoot = path.join(programFiles, "Autodesk", `AutoCAD ${target.year}`);
  const result = spawnSync("dotnet", ["build", path.join(project, "Mi.AutoCAD.csproj"), "-c", "Release", "-f", target.framework, `-p:AutoCADPath=${autocadRoot}`, "--nologo", "-v:q"],
    { encoding: "utf8", windowsHide: true, env: minimizedEnvironment(), maxBuffer: 32 * 1024 * 1024 });
  const log = path.join(logRoot, `autocad-build-${target.year}.log`);
  fs.writeFileSync(log, result.stdout + result.stderr);
  if (result.status !== 0) throw new Error(`Native ${target.year} build failed. See .tmp/${path.basename(log)}.`);
  const build = path.join(project, "bin/Release", target.framework);
  // Use the same local signing identity as Mi's Windows release. Never export its key.
  const signature = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    `$ErrorActionPreference='Stop'; $certificate=Get-Item 'Cert:\\CurrentUser\\My\\0000000000000000000000000000000000000000'; $signed=Set-AuthenticodeSignature -LiteralPath ${quote(path.join(build, "Mi.AutoCAD.dll"))} -Certificate $certificate -HashAlgorithm SHA256; if($signed.Status -ne 'Valid'){throw 'Native DLL signing failed.'}`],
    { encoding: "utf8", windowsHide: true, env: minimizedEnvironment(), timeout: 30000 });
  if (signature.status !== 0) throw new Error("Native signing failed; verify the existing STUDIO code-signing identity locally.");
  fs.mkdirSync(path.join(output, target.series), { recursive: true });
  const files = target.files.map(name => {
    const bytes = fs.readFileSync(path.join(build, name));
    fs.writeFileSync(path.join(output, target.series, name), bytes);
    return { name, sha256: sha256(bytes) };
  });
  console.log(`Built AutoCAD ${target.year} (${target.framework}, API ${target.apiVersion}).`);
  return { year: target.year, series: target.series, apiVersion: target.apiVersion, framework: target.framework, files };
});
const manifest = fs.readFileSync(path.join(root, "integrations/autocad/PackageContents.xml"));
fs.writeFileSync(path.join(output, "PackageContents.xml"), manifest);
fs.writeFileSync(path.join(output, "payload.json"), JSON.stringify({ schema: 2, version: AUTOCAD_ADDIN_VERSION, manifest: { name: "PackageContents.xml", sha256: sha256(manifest) }, targets }, null, 2) + "\n");
console.log(`Native AutoCAD bundle built and hashed: integrations/autocad/artifacts/bundle (${targets.map(target => target.year).join(", ")}).`);
