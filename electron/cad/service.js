const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const lessons = require("./lessons");
const { execFile } = require("node:child_process");
const { minimizedEnvironment } = require("../childEnvironment");
const { discoverSessions, requestNative, normalizeBindings, WORKSPACE, APPLICATIONS } = require("./nativeClient");
const { addinState, readPayload, nativeVersion, installNative, readAutocadPayload, installAutocad, AUTOCAD_API } = require("./install");

// Mi's own review decides every edit, so a second per-tool prompt from the CLI adds nothing.
const CLAUDE_TOOLS = "mcp__mi_cad";
const REVIEW_TIMEOUT_MS = "130000";
const AGENT_BRIEF = `You are working in the person's open CAD file through Mi's mi_cad tools.
Their request is about the connected Revit model or AutoCAD drawing unless they say otherwise.
Before the first read or edit, call cad_drawing_guide once, then query status, without asking.
Read freely. When they ask for a change, go straight to a preview and apply it, using one batch
for related work. Do not ask whether to proceed first: applying only puts the exact change in front
of them, in a bar at the top of this window, where they choose Apply edit or Decline. Say in one
short line that it is waiting there. Declined means nothing changed, so ask what to adjust.
If a tool says the connection ended, tell them to press Reconnect at the top of this window, and do
not suggest setup steps. Nothing saves: remind them to save when the work is done.`;

const ps = value => `'${String(value).replaceAll("'", "''")}'`;
function tomlLiteral(value) {
  if (/[\r\n]/.test(value) || value.includes("'''")) throw new Error("CAD launch paths cannot contain newlines or three consecutive apostrophes.");
  // Literal TOML survives the Windows PowerShell -> npm .cmd -> native CLI hops.
  // JSON double-quoted strings lose their quotes through those legacy shims.
  return `'''${value}'''`;
}
function writeLocal(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, contents, { flag: "wx" });
  fs.renameSync(temp, file);
}

const programFiles = () => process.env.ProgramFiles || "C:\\Program Files";
const INSTALLED = {
  revit: () => path.join(programFiles(), "Autodesk", "Revit 2026", "RevitAPI.dll"),
  autocad: () => path.join(programFiles(), "Autodesk", "AutoCAD 2027", "accoremgd.dll"),
};
const IMAGE = { revit: "Revit.exe", autocad: "acad.exe" };
function processRunning(application) {
  return new Promise(resolve => execFile("tasklist.exe", ["/FI", `IMAGENAME eq ${IMAGE[application]}`, "/FO", "CSV", "/NH"], { windowsHide: true, timeout: 5000, env: minimizedEnvironment() },
    (error, stdout) => resolve(!error && stdout.toLowerCase().includes(`"${IMAGE[application].toLowerCase()}"`))));
}

function createCadService({ userData, localAppData, appData, payloadDirectory, autocadPayloadDirectory, executable, serverScript, configStore, validateWorkspace, resolveDirectory,
  platform = process.platform, request = requestNative, discover = discoverSessions, isInstalled = application => fs.existsSync(INSTALLED[application]()), isRunning = processRunning }) {
  const root = path.join(userData, "cad");
  // Revit's settings key and bindings.json predate AutoCAD and keep their meaning.
  const stores = {
    revit: { setting: "cadBindings", file: path.join(root, "bindings.json"), sessions: path.join(localAppData, "Mi", "Revit", "sessions"), requiredVersion: "Revit API 26.5.0.0 / .NET 10" },
    autocad: { setting: "autocadBindings", file: path.join(root, "autocad-bindings.json"), sessions: path.join(localAppData, "Mi", "AutoCAD", "sessions"), requiredVersion: `AutoCAD 2027 API ${AUTOCAD_API} / .NET 10` },
  };
  const lessonsFile = path.join(root, "lessons.json");
  const reviewFile = path.join(root, "review.json");
  // Proves to an add-in that a person answered in Mi. Memory only, never settings or disk, because
  // the agent can read everything else this user can. After a Mi restart the add-in's own dialog
  // takes over until the drawing or model is connected again.
  const approvals = new Map();
  const approvalKey = (application, workspace, document) => `${application}\0${workspace}\0${document}`;
  let mutating = false;
  function check(workspace, application) {
    if (!stores[application]) throw new Error("Choose Revit or AutoCAD.");
    if (platform !== "win32") throw new Error(`Native ${APPLICATIONS[application].label} connections require Windows.`);
    if (!WORKSPACE.test(workspace)) throw new Error("Select a project workspace.");
    validateWorkspace(workspace);
  }
  const readBindings = application => normalizeBindings(configStore.getSettings()[stores[application].setting], application);
  function syncBindings(application) {
    const bindings = readBindings(application);
    writeLocal(stores[application].file, JSON.stringify(bindings, null, 2) + "\n");
    return bindings;
  }
  const claudeArguments = (configFile, briefFile) => `--mcp-config ${ps(configFile)} --allowedTools ${ps(CLAUDE_TOOLS)} --append-system-prompt-file ${ps(briefFile)}`;
  function launcher(workspace, resolvedDirectory) {
    check(workspace, "revit");
    syncBindings("revit"); syncBindings("autocad");
    const dir = path.join(root, workspace.slice(9));
    const args = [serverScript, "--workspace", workspace, "--bindings", stores.revit.file, "--autocad-bindings", stores.autocad.file, "--lessons", lessonsFile, "--review", reviewFile];
    const settings = configStore.getSettings();
    const config = { mcpServers: { mi_cad: { command: executable, args, env: { ELECTRON_RUN_AS_NODE: "1" } } } };
    const configFile = path.join(dir, "claude-mcp.json");
    writeLocal(configFile, JSON.stringify(config, null, 2) + "\n");
    const briefFile = path.join(dir, "agent-brief.md");
    writeLocal(briefFile, AGENT_BRIEF + "\n");
    const codexArgs = ["--no-alt-screen", "-c", `mcp_servers.mi_cad.command=${tomlLiteral(executable)}`, "-c", `mcp_servers.mi_cad.args=[${args.map(tomlLiteral).join(",")}]`, "-c", "mcp_servers.mi_cad.env.ELECTRON_RUN_AS_NODE='1'", "-c", "mcp_servers.mi_cad.tool_timeout_sec=130", "-c", "mcp_servers.mi_cad.default_tools_approval_mode='approve'"];
    const directory = resolvedDirectory || resolveDirectory?.(workspace);
    const script = `# Generated by Mi. Local launch settings only; no credentials.\nparam([ValidateSet('codex','claude')][string]$Engine = 'codex')\n$ErrorActionPreference = 'Stop'\n${directory ? `Set-Location -LiteralPath ${ps(directory)}\n` : ""}if ($Engine -eq 'codex') {\n  $cadArguments = @(${codexArgs.map(ps).join(", ")})\n  & ${ps(settings.codexBin || "codex")} @cadArguments\n} else {\n  $env:MCP_TOOL_TIMEOUT = '${REVIEW_TIMEOUT_MS}'\n  & ${ps(settings.claudeBin || "claude")} ${claudeArguments(configFile, briefFile)}\n}\nexit $LASTEXITCODE\n`;
    const file = path.join(dir, "launch.ps1");
    writeLocal(file, script);
    return file;
  }
  // A CAD agent window runs Mi's tools only, so another server's instructions cannot compete
  // with the paired model. launch.ps1 keeps the person's full configuration for copied commands.
  function agentCommand(workspace, engine) {
    check(workspace, "revit");
    if (engine !== "claude") throw new Error("A CAD agent window currently supports Claude. Copy the Codex launch command instead.");
    if (!Object.keys(stores).some(application => readBindings(application)[workspace])) throw new Error("Connect a Revit model or AutoCAD drawing to this project first.");
    const dir = path.dirname(launcher(workspace));
    const file = path.join(dir, "launch-cad-only.ps1");
    writeLocal(file, `# Generated by Mi. Local launch settings only; no credentials.\n$ErrorActionPreference = 'Stop'\nSet-Content -LiteralPath ${ps(path.join(dir, "agent.pid"))} -Value $PID\n$env:MCP_TOOL_TIMEOUT = '${REVIEW_TIMEOUT_MS}'\n& ${ps(configStore.getSettings().claudeBin || "claude")} --strict-mcp-config ${claudeArguments(path.join(dir, "claude-mcp.json"), path.join(dir, "agent-brief.md"))}\nexit $LASTEXITCODE\n`);
    // Absolute, because a terminal's PATH is the person's to change and may omit PowerShell.
    const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    return `"${powershell}" -NoProfile -ExecutionPolicy Bypass -File "${file}"\r`;
  }
  /** Whether this project's agent is still running, not merely whether its shell is. */
  function agentRunning(workspace) {
    try {
      const pid = Number(fs.readFileSync(path.join(root, workspace.slice(9), "agent.pid"), "utf8").trim());
      if (!Number.isSafeInteger(pid) || pid < 1) return false;
      process.kill(pid, 0);
      return true;
    } catch { return false; }
  }
  async function status(workspace, application = "revit") {
    check(workspace, application);
    const { label, noun } = APPLICATIONS[application];
    const bindings = syncBindings(application);
    const sessions = await Promise.all(discover(stores[application].sessions, application).map(async session => {
      try {
        const { document, documents, ...rest } = await request(session.pipe, { method: "discover" }, { timeoutMs: 8000 });
        // Revit reports its one active model; AutoCAD reports every open drawing.
        return { session: session.session, pid: session.pid, ...rest, documents: documents ?? (document ? [document] : []) };
      } catch (e) { return { session: session.session, pid: session.pid, error: e.message, documents: [] }; }
    }));
    const binding = bindings[workspace] || null;
    let health = "Not connected";
    if (binding) {
      try { await request(binding.pipe, { method: "query", workspace, document: binding.document, arguments: { kind: "status" } }, { timeoutMs: 8000 }); health = "Connected"; }
      // A person mid-command is the normal state of a working drawing, not a lost connection.
      catch (error) { health = /is busy/i.test(error?.message) ? "Connected" : `Reconnect required — the ${noun}, ${label} session, or pairing changed`; }
    }
    let payloadAvailable = false;
    try { if (application === "autocad") readAutocadPayload(autocadPayloadDirectory); else readPayload(payloadDirectory); payloadAvailable = true; } catch { /* Source checkouts need a native build first. */ }
    const addin = addinState({ application, payloadDirectory: application === "autocad" ? autocadPayloadDirectory : payloadDirectory, appData });
    const reviewsInMi = Boolean(binding && approvals.has(approvalKey(application, workspace, binding.document)));
    return { application, sessions, binding, health, payloadAvailable, addin, applicationInstalled: isInstalled(application), applicationRunning: await isRunning(application), reviewsInMi, requiredVersion: stores[application].requiredVersion, launcher: launcher(workspace) };
  }
  async function bind(workspace, application, sessionId, documentId) {
    check(workspace, application);
    if (mutating) throw new Error("Another connection change is in progress.");
    const session = discover(stores[application].sessions, application).find(s => s.session === sessionId);
    if (!session) throw new Error(`${APPLICATIONS[application].label} session is no longer available. Refresh connections.`);
    mutating = true;
    try {
      const approval = crypto.randomBytes(32).toString("hex");
      const document = await request(session.pipe, { method: "bind", workspace, document: documentId, approval });
      approvals.set(approvalKey(application, workspace, document.id), approval);
      const bindings = readBindings(application);
      for (const [key, old] of Object.entries(bindings)) if (old.session === sessionId && old.document === documentId) delete bindings[key];
      bindings[workspace] = { session: sessionId, pipe: session.pipe, document: document.id, title: document.title };
      configStore.updateSettings({ [stores[application].setting]: bindings }); syncBindings(application);
      return await status(workspace, application);
    } finally { mutating = false; }
  }
  async function disconnect(workspace, application = "revit") {
    check(workspace, application);
    if (mutating) throw new Error("Another connection change is in progress.");
    mutating = true;
    try {
      const { label } = APPLICATIONS[application];
      const bindings = readBindings(application);
      const binding = bindings[workspace];
      let revoked = true;
      if (binding) {
        try { await request(binding.pipe, { method: "unbind", workspace, document: binding.document }, { timeoutMs: 8000 }); }
        catch { revoked = false; }
      }
      if (binding) approvals.delete(approvalKey(application, workspace, binding.document));
      delete bindings[workspace];
      configStore.updateSettings({ [stores[application].setting]: bindings }); syncBindings(application);
      return { revoked, message: revoked ? "Disconnected." : `Mi's connection was removed. Stop the Mi CAD bridge in ${label} to revoke an unreachable native pairing.` };
    } finally { mutating = false; }
  }
  function install(application, action) {
    if (!stores[application]) throw new Error("Choose Revit or AutoCAD.");
    if (platform !== "win32") throw new Error(`Native ${APPLICATIONS[application].label} requires Windows.`);
    return application === "autocad" ? installAutocad({ payloadDirectory: autocadPayloadDirectory, appData, action }) : installNative({ payloadDirectory, localAppData, appData, action });
  }
  function reviewTarget(workspace, application) {
    const binding = readBindings(application)[workspace];
    const approval = binding && approvals.get(approvalKey(application, workspace, binding.document));
    return approval ? { binding, approval } : null;
  }
  /** The add-in's own wording for a pending preview, or null when Mi cannot review it. */
  async function describeReview(workspace, application, token) {
    check(workspace, application);
    const target = reviewTarget(workspace, application);
    if (!target) return null;
    return request(target.binding.pipe, { method: "describe", workspace, document: target.binding.document, arguments: { preview_token: token } }, { timeoutMs: 8000 });
  }
  async function applyReviewed(workspace, application, token) {
    const target = reviewTarget(workspace, application);
    if (!target) throw new Error("This connection changed during the review. Nothing was applied.");
    return request(target.binding.pipe, { method: "apply", workspace, document: target.binding.document, arguments: { preview_token: token }, approval: target.approval });
  }
  const lessonApi = { list: () => lessons.read(lessonsFile), add: text => lessons.add(lessonsFile, text), review: (id, accept) => lessons.review(lessonsFile, id, accept), remove: id => lessons.remove(lessonsFile, id) };
  return { status, bind, disconnect, launcher, agentCommand, agentRunning, install, describeReview, applyReviewed, reviewFile, lessons: lessonApi, version: nativeVersion };
}
module.exports = { createCadService };
