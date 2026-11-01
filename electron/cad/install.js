const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { minimizedEnvironment } = require("../childEnvironment");
const ADDIN_ID = "a7e3505e-21c2-4e29-92b1-4c6db1fc44f2";
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
/**
 * The add-in generation this Mi build needs. Every build recompiles and re-signs the DLL, so a
 * hash difference says nothing about whether an installed add-in still works. Raise this only
 * for a change an older add-in cannot serve; that is what asks people to install again.
 */
const ADDIN_COMPATIBILITY = 1;
const COMPATIBILITY_MARKER = "mi-compatibility.json";
const writeCompatibility = directory => fs.writeFileSync(path.join(directory, COMPATIBILITY_MARKER), JSON.stringify({ compatibility: ADDIN_COMPATIBILITY }));
function installedCompatibility(directory) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(directory, COMPATIBILITY_MARKER), "utf8")).compatibility;
    return Number.isInteger(value) ? value : null;
  } catch { return null; } // Add-ins from before this marker existed have no file to read.
}
const xml = text => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function readPayload(directory) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, "payload.json"), "utf8"));
  if (manifest.year !== "2026" || manifest.apiVersion !== "26.5.0.0" || manifest.framework !== "net10.0-windows"
    || manifest.version !== "0.1.0" || !Array.isArray(manifest.files) || manifest.files.length < 1 || manifest.files.length > 4) throw new Error("Unsupported native payload.");
  if (!manifest.files.some(file => file.name === "Mi.Revit.dll") || new Set(manifest.files.map(file => file.name)).size !== manifest.files.length) throw new Error("Incomplete native payload.");
  for (const file of manifest.files) {
    if (!["Mi.Revit.dll", "Mi.Revit.deps.json", "Mi.Revit.runtimeconfig.json"].includes(file.name) || !/^[a-f0-9]{64}$/.test(file.sha256)
      || hash(fs.readFileSync(path.join(directory, file.name))) !== file.sha256) throw new Error("Native payload verification failed.");
  }
  return manifest;
}

function nativeVersion(revitRoot = path.join(process.env.ProgramFiles || "C:\\Program Files", "Autodesk", "Revit 2026")) {
  const api = path.join(revitRoot, "RevitAPI.dll");
  if (!fs.existsSync(api)) return null;
  // The path is passed as data, not interpolated into PowerShell source.
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "& { param($p) [Reflection.AssemblyName]::GetAssemblyName($p).Version.ToString() }", `'${api.replaceAll("'", "''")}'`],
    { encoding: "utf8", windowsHide: true, timeout: 10000, env: minimizedEnvironment() });
  if (result.status !== 0) throw new Error("Cannot inspect the installed Revit API version.");
  return result.stdout.trim();
}

const AUTOCAD_API = "26.0.0.0";
const AUTOCAD_PRODUCT = "{5C1D5E0B-7E7A-4B62-9C57-3E9B1C0A2D27}";
const AUTOCAD_FILES = ["Mi.AutoCAD.dll", "Mi.AutoCAD.deps.json", "PackageContents.xml"];

function readAutocadPayload(directory) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, "payload.json"), "utf8"));
  if (manifest.year !== "2027" || manifest.apiVersion !== AUTOCAD_API || manifest.framework !== "net10.0-windows"
    || manifest.version !== "0.1.0" || !Array.isArray(manifest.files)) throw new Error("Unsupported native payload.");
  if (manifest.files.length !== AUTOCAD_FILES.length || !AUTOCAD_FILES.every(name => manifest.files.some(file => file.name === name))) throw new Error("Incomplete native payload.");
  for (const file of manifest.files) {
    if (!/^[a-f0-9]{64}$/.test(file.sha256) || hash(fs.readFileSync(path.join(directory, file.name))) !== file.sha256) throw new Error("Native payload verification failed.");
  }
  return manifest;
}

function autocadApiVersion(autocadRoot = path.join(process.env.ProgramFiles || "C:\\Program Files", "Autodesk", "AutoCAD 2027")) {
  const api = path.join(autocadRoot, "accoremgd.dll");
  if (!fs.existsSync(api)) return null;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "& { param($p) [Reflection.AssemblyName]::GetAssemblyName($p).Version.ToString() }", `'${api.replaceAll("'", "''")}'`],
    { encoding: "utf8", windowsHide: true, timeout: 10000, env: minimizedEnvironment() });
  if (result.status !== 0) throw new Error("Cannot inspect the installed AutoCAD API version.");
  return result.stdout.trim();
}

// The signature checks below prove a file is intact and signed by STUDIO's exact certificate. That
// certificate is self-signed, so a computer that does not trust it reports UnknownError rather
// than Valid. Altering a signed file gives neither status. No trust setting is read or changed.
// Autoloader bundle, one per Windows user. Ownership is proven by ProductCode, never by folder name.
function installAutocad({ payloadDirectory, appData, action = "install", checkRunning = true, apiVersion }) {
  if (!["install", "uninstall"].includes(action)) throw new Error("Invalid installation action.");
  if (checkRunning) {
    const running = spawnSync("tasklist.exe", ["/FI", "IMAGENAME eq acad.exe", "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true, timeout: 10000, env: minimizedEnvironment() });
    if (running.status !== 0 || /"acad\.exe"/i.test(running.stdout)) throw new Error("Close AutoCAD first, then try again. If it looks closed, check Task Manager for acad.exe. Older AutoCAD releases count too.");
  }
  const plugins = path.join(appData, "Autodesk", "ApplicationPlugins");
  const bundle = path.join(plugins, "Mi.AutoCAD.bundle");
  const contents = path.join(bundle, "PackageContents.xml");
  if (fs.existsSync(bundle) && !(fs.existsSync(contents) && fs.readFileSync(contents, "utf8").includes(AUTOCAD_PRODUCT))) throw new Error("An unrelated Mi.AutoCAD.bundle already exists; it was not replaced.");
  if (action === "uninstall") {
    fs.rmSync(bundle, { recursive: true, force: true });
    return { message: "Native add-in removed. Drawings and other AutoCAD plug-ins were preserved." };
  }
  const payload = readAutocadPayload(payloadDirectory);
  if (checkRunning) {
    const dll = path.join(payloadDirectory, "Mi.AutoCAD.dll");
    const verified = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      `& { param($p) $s=Get-AuthenticodeSignature -LiteralPath $p; if(@('Valid','UnknownError') -notcontains [string]$s.Status -or $s.SignerCertificate.Thumbprint -ne '0000000000000000000000000000000000000000'){exit 1} } '${dll.replaceAll("'", "''")}'`],
      { encoding: "utf8", windowsHide: true, timeout: 10000, env: minimizedEnvironment() });
    if (verified.status !== 0) throw new Error("The STUDIO add-in signature could not be verified. No trust settings were changed.");
  }
  if ((apiVersion ?? autocadApiVersion()) !== payload.apiVersion) throw new Error(`This native build requires AutoCAD API ${AUTOCAD_API} (AutoCAD 2027). Other releases need their own validated payload.`);
  // Staged beside the bundle under a name the autoloader ignores, then renamed into place.
  const staged = path.join(plugins, `.mi-autocad-${crypto.randomUUID()}.tmp`);
  fs.mkdirSync(path.join(staged, "Contents"), { recursive: true });
  try {
    for (const file of payload.files) {
      const target = file.name === "PackageContents.xml" ? path.join(staged, file.name) : path.join(staged, "Contents", file.name);
      fs.copyFileSync(path.join(payloadDirectory, file.name), target, fs.constants.COPYFILE_EXCL);
      if (hash(fs.readFileSync(target)) !== file.sha256) throw new Error("Installed add-in verification failed.");
    }
    writeCompatibility(path.join(staged, "Contents"));
    fs.rmSync(bundle, { recursive: true, force: true });
    fs.renameSync(staged, bundle); // Roaming AppData, never a project/Dropbox destination.
  } catch (error) { fs.rmSync(staged, { recursive: true, force: true }); throw error; }
  return { message: "Native add-in installed and verified. Start AutoCAD, then refresh connections in Mi.", destination: bundle };
}

function installNative({ payloadDirectory, localAppData, appData, action = "install", checkRunning = true, apiVersion }) {
  if (!["install", "uninstall"].includes(action)) throw new Error("Invalid installation action.");
  if (checkRunning) {
    const running = spawnSync("tasklist.exe", ["/FI", "IMAGENAME eq Revit.exe", "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true, timeout: 10000, env: minimizedEnvironment() });
    if (running.status !== 0 || /"Revit\.exe"/i.test(running.stdout)) throw new Error("Close Revit first, then try again. If it looks closed, check Task Manager for Revit.exe.");
  }
  const manifestFile = path.join(appData, "Autodesk", "Revit", "Addins", "2026", "Mi.Native.addin");
  if (fs.existsSync(manifestFile) && !fs.readFileSync(manifestFile, "utf8").includes(`<AddInId>${ADDIN_ID}</AddInId>`)) throw new Error("An unrelated Mi.Native.addin already exists; it was not replaced.");
  if (action === "uninstall") {
    if (fs.existsSync(manifestFile)) fs.unlinkSync(manifestFile);
    return { message: "Native add-in registration removed. Existing versioned files and your pyRevit extension were preserved." };
  }
  const payload = readPayload(payloadDirectory);
  if (checkRunning) {
    const dll = path.join(payloadDirectory, "Mi.Revit.dll");
    const verified = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      `& { param($p) $s=Get-AuthenticodeSignature -LiteralPath $p; if(@('Valid','UnknownError') -notcontains [string]$s.Status -or $s.SignerCertificate.Thumbprint -ne '0000000000000000000000000000000000000000'){exit 1} } '${dll.replaceAll("'", "''")}'`],
      { encoding: "utf8", windowsHide: true, timeout: 10000, env: minimizedEnvironment() });
    if (verified.status !== 0) throw new Error("The STUDIO add-in signature could not be verified. No trust settings were changed.");
  }
  if ((apiVersion ?? nativeVersion()) !== payload.apiVersion) throw new Error("This native build requires Revit API 26.5.0.0. Other Revit builds need their own validated payload.");
  const identity = hash(Buffer.from(JSON.stringify(payload))).slice(0, 16);
  const destination = path.join(localAppData, "Mi", "Revit", "2026", `${payload.version}-${identity}`);
  fs.mkdirSync(destination, { recursive: true });
  for (const file of payload.files) {
    const target = path.join(destination, file.name);
    if (fs.existsSync(target)) {
      if (hash(fs.readFileSync(target)) !== file.sha256) throw new Error("An existing native payload differs. It was not overwritten.");
    } else fs.copyFileSync(path.join(payloadDirectory, file.name), target, fs.constants.COPYFILE_EXCL);
    if (hash(fs.readFileSync(target)) !== file.sha256) throw new Error("Installed add-in verification failed.");
  }
  writeCompatibility(destination);
  const contents = `<?xml version="1.0" encoding="utf-8"?>\n<RevitAddIns><AddIn Type="Application"><Name>Mi CAD Native</Name><Assembly>${xml(path.join(destination, "Mi.Revit.dll"))}</Assembly><AddInId>${ADDIN_ID}</AddInId><FullClassName>Mi.Revit.App</FullClassName><VendorId>STUDIO</VendorId><VendorDescription>Mi native project CAD connection</VendorDescription></AddIn></RevitAddIns>\n`;
  fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
  const temporary = `${manifestFile}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, contents, { flag: "wx", encoding: "utf8" });
  fs.renameSync(temporary, manifestFile); // Local AppData, never a project/Dropbox destination.
  return { message: "Native add-in installed and verified. Start Revit, then refresh connections in Mi.", destination };
}
// Install is one-time: a different build is an optional update, and only a compatibility number
// below what this Mi requires blocks setup. Add-ins without a marker can't be proven either way,
// so they stay usable and the pairing handshake reports a real failure.
function addinState({ application, payloadDirectory, appData, requiredCompatibility = ADDIN_COMPATIBILITY }) {
  const dll = application === "autocad" ? "Mi.AutoCAD.dll" : "Mi.Revit.dll";
  let installed = path.join(appData, "Autodesk", "ApplicationPlugins", "Mi.AutoCAD.bundle", "Contents", dll);
  if (application === "revit") {
    const manifest = path.join(appData, "Autodesk", "Revit", "Addins", "2026", "Mi.Native.addin");
    const assembly = fs.existsSync(manifest) && /<Assembly>([^<]+)<\/Assembly>/.exec(fs.readFileSync(manifest, "utf8"));
    if (!assembly) return "missing";
    installed = assembly[1].replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
  }
  if (!fs.existsSync(installed)) return "missing";
  const carried = path.join(payloadDirectory, dll);
  if (!fs.existsSync(carried)) return "installed";
  if (hash(fs.readFileSync(installed)) === hash(fs.readFileSync(carried))) return "installed";
  const compatibility = installedCompatibility(path.dirname(installed));
  return compatibility !== null && compatibility < requiredCompatibility ? "outdated" : "optional-update";
}
module.exports = { addinState, ADDIN_COMPATIBILITY, installNative, readPayload, nativeVersion, ADDIN_ID, installAutocad, readAutocadPayload, autocadApiVersion, AUTOCAD_API, AUTOCAD_PRODUCT };
