const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync, execFile } = require("node:child_process");
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

const AUTOCAD_ADDIN_VERSION = "0.1.0";
const AUTOCAD_PRODUCT = "{5C1D5E0B-7E7A-4B62-9C57-3E9B1C0A2D27}";
/**
 * Supported full-AutoCAD releases. Each runs its own .NET runtime and gets its own build, in its
 * own series folder of one bundle. Anything not listed here (LT, 2022, 2025-2026, verticals) is
 * named as unsupported rather than loaded.
 */
const AUTOCAD_TARGETS = Object.freeze([
  Object.freeze({ year: "2027", series: "R26.0", apiVersion: "26.0.0.0", framework: "net10.0-windows", files: Object.freeze(["Mi.AutoCAD.dll", "Mi.AutoCAD.deps.json"]) }),
  Object.freeze({ year: "2024", series: "R24.3", apiVersion: "24.3.0.0", framework: "net48", files: Object.freeze(["Mi.AutoCAD.dll"]) }),
]);
/** Kept for callers that name the original 2027 API. */
const AUTOCAD_API = AUTOCAD_TARGETS[0].apiVersion;

function readAutocadPayload(directory) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, "payload.json"), "utf8"));
  if (manifest.schema !== 2 || manifest.version !== AUTOCAD_ADDIN_VERSION || !Array.isArray(manifest.targets) || manifest.targets.length !== AUTOCAD_TARGETS.length
    || manifest.manifest?.name !== "PackageContents.xml") throw new Error("Unsupported native payload.");
  const check = (file, sha256) => {
    if (!/^[a-f0-9]{64}$/.test(sha256) || hash(fs.readFileSync(file)) !== sha256) throw new Error("Native payload verification failed.");
  };
  for (const expected of AUTOCAD_TARGETS) {
    const target = manifest.targets.find(item => item?.year === expected.year);
    if (!target || target.series !== expected.series || target.apiVersion !== expected.apiVersion || target.framework !== expected.framework || !Array.isArray(target.files)
      || target.files.length !== expected.files.length || !expected.files.every(name => target.files.some(file => file.name === name))) throw new Error("Incomplete native payload.");
    for (const file of target.files) check(path.join(directory, expected.series, file.name), file.sha256);
  }
  check(path.join(directory, "PackageContents.xml"), manifest.manifest.sha256);
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

/**
 * One non-recursive `reg query`: the key's own product values, then its direct subkeys. Recursive
 * queries of the Autodesk tree return megabytes and took over ten seconds on a real workstation,
 * so the registry is walked only as deep as product keys (...\AutoCAD\R24.3\ACAD-7101:409).
 */
// reg.exe omits the queried key's own header when it has no values, so the header is recognized by
// name rather than by position.
function parseRegistryKey(stdout, key) {
  const own = String(key).replace(/^HKLM\\/i, "HKEY_LOCAL_MACHINE\\").toLowerCase();
  const values = {}, children = [];
  let inOwn = false;
  for (const line of String(stdout).split(/\r?\n/)) {
    if (/^HKEY_/.test(line)) {
      inOwn = line.trim().toLowerCase() === own;
      if (!inOwn) children.push(line.trim());
      continue;
    }
    const value = /^\s+(ProductName|AcadLocation)\s+REG_SZ\s+(.+)$/.exec(line);
    if (value && inOwn) values[value[1]] = value[2].trim();
  }
  return { values, children };
}
const REGISTRY_FAMILIES = ["AutoCAD", "AutoCAD LT"];
const registryRoot = family => `HKLM\\SOFTWARE\\Autodesk\\${family}`;
const seriesOf = key => /\\(R\d+(?:\.\d+)?)$/.exec(key)?.[1] ?? null;
const REGISTRY_OPTIONS = () => ({ encoding: "utf8", windowsHide: true, timeout: 10000, env: minimizedEnvironment(), maxBuffer: 1024 * 1024 });
const product = (family, series, key) => key?.values.ProductName ? { family, series, productName: key.values.ProductName, location: key.values.AcadLocation ?? null } : null;

function queryRegistry(key) {
  const result = spawnSync("reg.exe", ["query", key], REGISTRY_OPTIONS());
  return result.status === 0 ? parseRegistryKey(result.stdout, key) : null;
}
function queryRegistryAsync(key) {
  return new Promise(resolve => execFile("reg.exe", ["query", key], REGISTRY_OPTIONS(), (error, stdout) => resolve(error ? null : parseRegistryKey(stdout, key))));
}

/** AutoCAD-family products from the read-only registry: family, series, product name, and location. */
function readAutocadRegistry(query = queryRegistry) {
  const products = [];
  for (const family of REGISTRY_FAMILIES) {
    for (const seriesKey of query(registryRoot(family))?.children ?? []) {
      const series = seriesOf(seriesKey);
      if (!series) continue;
      for (const key of (query(seriesKey)?.children ?? []).slice(0, 50)) {
        const entry = product(family, series, query(key));
        if (entry) products.push(entry);
      }
    }
  }
  return products;
}
/** The same walk without blocking the caller. Mi's main process runs every terminal. */
async function readAutocadRegistryAsync(query = queryRegistryAsync) {
  const families = await Promise.all(REGISTRY_FAMILIES.map(async family => {
    const root = await query(registryRoot(family));
    const series = (root?.children ?? []).map(key => [key, seriesOf(key)]).filter(([, value]) => value);
    return Promise.all(series.map(async ([seriesKey, value]) => {
      const keys = (await query(seriesKey))?.children ?? [];
      return (await Promise.all(keys.slice(0, 50).map(query))).map(key => product(family, value, key));
    }));
  }));
  return families.flat(2).filter(Boolean);
}

/**
 * Which supported releases are installed, and which AutoCAD-family products are present but not
 * supported. A supported release needs the plain product name "AutoCAD <year>", its series, and its
 * API assembly on disk. Verticals, LT, and other series are listed by name as unsupported.
 */
function autocadReleases({ registry = readAutocadRegistry, exists = fs.existsSync } = {}) {
  let products = [];
  try { products = registry(); } catch { products = []; }
  return classifyReleases(products, exists);
}
async function autocadReleasesAsync({ registry = readAutocadRegistryAsync, exists = fs.existsSync } = {}) {
  let products = [];
  try { products = await registry(); } catch { products = []; }
  return classifyReleases(products, exists);
}
function classifyReleases(products, exists) {
  const supported = new Set(), unsupported = new Set();
  for (const product of products) {
    const name = product.productName.replace(/\s+-\s+[^-]+$/, "");
    const target = AUTOCAD_TARGETS.find(item => item.series === product.series);
    const plain = Boolean(target) && product.family === "AutoCAD" && name === `AutoCAD ${target.year}`;
    if (plain && product.location && exists(path.join(product.location, "accoremgd.dll"))) supported.add(target.year);
    else unsupported.add(name);
  }
  // Without registry access, fall back to the standard install folders.
  if (!products.length) for (const target of AUTOCAD_TARGETS) if (exists(path.join(process.env.ProgramFiles || "C:\\Program Files", "Autodesk", `AutoCAD ${target.year}`, "accoremgd.dll"))) supported.add(target.year);
  return { supported: AUTOCAD_TARGETS.map(target => target.year).filter(year => supported.has(year)), unsupported: [...unsupported].sort() };
}

function installedAutocadApis() {
  const apis = {};
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  for (const year of autocadReleases().supported) apis[year] = autocadApiVersion(path.join(programFiles, "Autodesk", `AutoCAD ${year}`));
  return apis;
}

// The signature checks below prove a file is intact and signed by STUDIO's exact certificate. That
// certificate is self-signed, so a computer that does not trust it reports UnknownError rather
// than Valid. Altering a signed file gives neither status. No trust setting is read or changed.
// Autoloader bundle, one per Windows user. Ownership is proven by ProductCode, never by folder name.
// The bundle always carries every supported release, so installing another AutoCAD later needs no Mi step.
function installAutocad({ payloadDirectory, appData, action = "install", checkRunning = true, installedApis }) {
  if (!["install", "uninstall"].includes(action)) throw new Error("Invalid installation action.");
  if (checkRunning) {
    const running = spawnSync("tasklist.exe", ["/FI", "IMAGENAME eq acad.exe", "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true, timeout: 10000, env: minimizedEnvironment() });
    if (running.status !== 0 || /"acad\.exe"/i.test(running.stdout)) throw new Error("Close every AutoCAD window first, then try again. If it looks closed, check Task Manager for acad.exe. Other AutoCAD releases count too.");
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
    for (const target of payload.targets) {
      const dll = path.join(payloadDirectory, target.series, "Mi.AutoCAD.dll");
      const verified = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        `& { param($p) $s=Get-AuthenticodeSignature -LiteralPath $p; if(@('Valid','UnknownError') -notcontains [string]$s.Status -or $s.SignerCertificate.Thumbprint -ne '0000000000000000000000000000000000000000'){exit 1} } '${dll.replaceAll("'", "''")}'`],
        { encoding: "utf8", windowsHide: true, timeout: 10000, env: minimizedEnvironment() });
      if (verified.status !== 0) throw new Error("The STUDIO add-in signature could not be verified. No trust settings were changed.");
    }
  }
  const apis = installedApis ?? installedAutocadApis();
  const usable = AUTOCAD_TARGETS.filter(target => apis[target.year] === target.apiVersion).map(target => target.year);
  if (!usable.length) throw new Error("Mi supports full AutoCAD 2024 (API 24.3.0.0) and AutoCAD 2027 (API 26.0.0.0). Neither was found. AutoCAD LT and other releases have no supported add-in.");
  // Staged beside the bundle under a name the autoloader ignores, then renamed into place.
  const staged = path.join(plugins, `.mi-autocad-${crypto.randomUUID()}.tmp`);
  try {
    fs.mkdirSync(staged, { recursive: true });
    const copy = (source, target, sha256) => {
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      if (hash(fs.readFileSync(target)) !== sha256) throw new Error("Installed add-in verification failed.");
    };
    copy(path.join(payloadDirectory, "PackageContents.xml"), path.join(staged, "PackageContents.xml"), payload.manifest.sha256);
    for (const target of payload.targets) {
      const folder = path.join(staged, "Contents", target.series);
      fs.mkdirSync(folder, { recursive: true });
      for (const file of target.files) copy(path.join(payloadDirectory, target.series, file.name), path.join(folder, file.name), file.sha256);
      writeCompatibility(folder);
    }
    fs.rmSync(bundle, { recursive: true, force: true });
    fs.renameSync(staged, bundle); // Roaming AppData, never a project/Dropbox destination.
  } catch (error) { fs.rmSync(staged, { recursive: true, force: true }); throw error; }
  return { message: `Native add-in installed and verified for ${usable.map(year => `AutoCAD ${year}`).join(" and ")}. Start AutoCAD, then refresh connections in Mi.`, destination: bundle };
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
function addinState({ application, payloadDirectory, appData, requiredCompatibility = ADDIN_COMPATIBILITY, releases }) {
  if (application === "autocad") return autocadAddinState({ payloadDirectory, appData, requiredCompatibility, releases });
  const dll = "Mi.Revit.dll";
  const manifest = path.join(appData, "Autodesk", "Revit", "Addins", "2026", "Mi.Native.addin");
  const assembly = fs.existsSync(manifest) && /<Assembly>([^<]+)<\/Assembly>/.exec(fs.readFileSync(manifest, "utf8"));
  if (!assembly) return "missing";
  const installed = assembly[1].replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
  if (!fs.existsSync(installed)) return "missing";
  const carried = path.join(payloadDirectory, dll);
  if (!fs.existsSync(carried)) return "installed";
  if (hash(fs.readFileSync(installed)) === hash(fs.readFileSync(carried))) return "installed";
  const compatibility = installedCompatibility(path.dirname(installed));
  return compatibility !== null && compatibility < requiredCompatibility ? "outdated" : "optional-update";
}
/**
 * The AutoCAD bundle's state for the releases installed on this computer. Each installed supported
 * release needs its own component: the original 2027-only bundle counts as outdated on a computer
 * with AutoCAD 2024, but stays installed where 2027 is the only release. Without a release list,
 * every supported release is considered.
 */
function autocadAddinState({ payloadDirectory, appData, requiredCompatibility = ADDIN_COMPATIBILITY, releases }) {
  const contents = path.join(appData, "Autodesk", "ApplicationPlugins", "Mi.AutoCAD.bundle", "Contents");
  const relevant = AUTOCAD_TARGETS.filter(target => !releases?.length || releases.includes(target.year));
  const components = relevant.map(target => {
    const current = path.join(contents, target.series, "Mi.AutoCAD.dll");
    const legacy = target.year === "2027" ? path.join(contents, "Mi.AutoCAD.dll") : null; // The original 2027-only layout.
    const installed = fs.existsSync(current) ? current : legacy && fs.existsSync(legacy) ? legacy : null;
    return { installed, carried: path.join(payloadDirectory, target.series, "Mi.AutoCAD.dll") };
  });
  const present = components.filter(component => component.installed);
  if (!present.length) return "missing";
  if (present.length < components.length) return "outdated";
  // The original 2027-only layout predates text, table, chart, hatch, dimension, block, and transform
  // edits and places leader text at the origin, so it cannot serve this Mi. Revit is unaffected.
  if (present.some(({ installed }) => path.basename(path.dirname(installed)) === "Contents")) return "outdated";
  for (const { installed } of present) {
    const compatibility = installedCompatibility(path.dirname(installed));
    if (compatibility !== null && compatibility < requiredCompatibility) return "outdated";
  }
  const same = present.every(({ installed, carried }) => !fs.existsSync(carried) || hash(fs.readFileSync(installed)) === hash(fs.readFileSync(carried)));
  return same ? "installed" : "optional-update";
}
module.exports = { addinState, ADDIN_COMPATIBILITY, installNative, readPayload, nativeVersion, ADDIN_ID, installAutocad, readAutocadPayload, autocadApiVersion, autocadReleases, readAutocadRegistry,
  autocadReleasesAsync, readAutocadRegistryAsync, parseRegistryKey,
  AUTOCAD_API, AUTOCAD_PRODUCT, AUTOCAD_TARGETS, AUTOCAD_ADDIN_VERSION };
