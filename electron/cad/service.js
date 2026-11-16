const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const lessons = require("./lessons");
const { execFile } = require("node:child_process");
const { minimizedEnvironment } = require("../childEnvironment");
const { discoverSessions, requestNative, normalizeBindings, forSlot, SLOT, MAX_DRAWINGS, WORKSPACE, SESSION, APPLICATIONS } = require("./nativeClient");
const { addinState, readPayload, nativeVersion, installNative, readAutocadPayload, installAutocad, autocadReleasesAsync } = require("./install");

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
not suggest setup steps.
Work across drawings on your own. A request often needs several: a plan in one, elevations in
another, details in a third. acad_query kind drawings lists the connected drawings and the ones open
in AutoCAD but not connected. Read any connected drawing by passing drawing, with no need to switch.
When you need an open drawing that is not connected, call acad_connect_drawings for every one you
need at once, with a short reason; the person approves them together in a bar at the top of this
window, so say so in one line. Use acad_switch_drawing when most of the work moves to another
drawing; it needs no approval. To find a view, query kind views: viewports list their layout, scale,
nearby title text, and the model area they show, which entities reads with area. Named views work
the same way. In model space, search titles with text, then read the area around them. If a file is
not open in AutoCAD at all, find it in the project folder (the parent of your working directory)
and call acad_open_drawing with its full path and a short reason; the person approves opening and
connecting it in the same bar. To bring work from one drawing into another, use copy_from_drawing
(a native copy) or attach_xref (a live reference) rather than redrawing it. Units are sometimes
wrong: compare both drawings' INSUNITS and one known dimension before copying, referencing, or
drawing to size, and ask the person when they disagree. Other agent windows may be working in
other drawings of this project; switching never moves theirs.
Nothing saves: remind them to save when the work is done.`;
const ENGINES = { claude: "Claude", codex: "Codex" };

const ps = value => `'${String(value).replaceAll("'", "''")}'`;
function tomlLiteral(value) {
  if (/[\r\n]/.test(value) || value.includes("'''")) throw new Error("CAD launch paths cannot contain newlines or three consecutive apostrophes.");
  // Literal TOML survives the Windows PowerShell -> npm .cmd -> native CLI hops.
  // JSON double-quoted strings lose their quotes through those legacy shims.
  return `'''${value}'''`;
}
function writeLocal(file, contents) {
  // Status polls regenerate the same launch and binding files; leave an unchanged file alone.
  try { if (fs.readFileSync(file, "utf8") === contents) return; } catch { /* Missing or unreadable: write it. */ }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, contents, { flag: "wx" });
  fs.renameSync(temp, file);
}

const programFiles = () => process.env.ProgramFiles || "C:\\Program Files";
const REVIT_API = () => path.join(programFiles(), "Autodesk", "Revit 2026", "RevitAPI.dll");
/**
 * Installed AutoCAD releases change only when AutoCAD itself is installed or removed, while status is
 * polled every few seconds by every terminal's banner. The registry is read off the main thread, at
 * most every five minutes, and a stale answer is served while the next read runs.
 */
function cachedReleases(read = autocadReleasesAsync, ttlMs = 300_000, now = Date.now) {
  let value = null, at = 0, pending = null;
  const refresh = () => pending ??= new Promise(resolve => resolve(read()))
    .then(next => { value = next; at = now(); return next; })
    .finally(() => { pending = null; });
  return () => {
    if (!value) return refresh();
    if (now() - at >= ttlMs) refresh().catch(() => {});
    return Promise.resolve(value);
  };
}
const installedReleases = cachedReleases();
const IMAGE = { revit: "Revit.exe", autocad: "acad.exe" };
function processRunning(application) {
  return new Promise(resolve => execFile("tasklist.exe", ["/FI", `IMAGENAME eq ${IMAGE[application]}`, "/FO", "CSV", "/NH"], { windowsHide: true, timeout: 5000, env: minimizedEnvironment() },
    (error, stdout) => resolve(!error && stdout.toLowerCase().includes(`"${IMAGE[application].toLowerCase()}"`))));
}

/** Whether target is strictly inside root. Both must already be canonical. */
function inside(root, target) {
  const relative = path.relative(root, target);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}
const samePath = (a, b) => typeof a === "string" && typeof b === "string" && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/**
 * resolveProjectRoot(workspace) returns the project's human-confirmed folder, or null when it has
 * none. Drawings are opened only from inside it.
 */
function createCadService({ userData, localAppData, appData, payloadDirectory, autocadPayloadDirectory, executable, serverScript, configStore, validateWorkspace, resolveDirectory, resolveProjectRoot,
  platform = process.platform, request = requestNative, discover = discoverSessions, releases = installedReleases,
  isInstalled = async application => application === "autocad" ? (await releases()).supported.length > 0 : fs.existsSync(REVIT_API()), isRunning = processRunning }) {
  const root = path.join(userData, "cad");
  // Revit's settings key and bindings.json predate AutoCAD and keep their meaning.
  const stores = {
    revit: { setting: "cadBindings", file: path.join(root, "bindings.json"), sessions: path.join(localAppData, "Mi", "Revit", "sessions"), requiredVersion: "Revit API 26.5.0.0 / .NET 10" },
    autocad: { setting: "autocadBindings", file: path.join(root, "autocad-bindings.json"), sessions: path.join(localAppData, "Mi", "AutoCAD", "sessions"), requiredVersion: "AutoCAD 2024 (API 24.3.0.0 / .NET Framework 4.8) or AutoCAD 2027 (API 26.0.0.0 / .NET 10), full AutoCAD only" },
  };
  const lessonsFile = path.join(root, "lessons.json");
  const reviewFile = path.join(root, "review.json");
  // Proves to an add-in that a person answered in Mi. Memory only, never settings or disk, because
  // the agent can read everything else this user can. After a Mi restart the add-in's own dialog
  // takes over until the drawing or model is connected again.
  const approvals = new Map();
  const approvalKey = (application, workspace, document) => `${application}\0${workspace}\0${document}`;
  let mutating = false;
  const payloadVerified = { revit: false, autocad: false };
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
  // The AutoCAD sessions folder lets the server list drawings that are open but not yet connected.
  const mcpArguments = (workspace, slot) => [serverScript, "--workspace", workspace, "--bindings", stores.revit.file, "--autocad-bindings", stores.autocad.file, "--autocad-sessions", stores.autocad.sessions, "--lessons", lessonsFile, "--review", reviewFile, ...(slot ? ["--slot", slot] : [])];
  const claudeArguments = (configFile, briefFile) => `--mcp-config ${ps(configFile)} --allowedTools ${ps(CLAUDE_TOOLS)} --append-system-prompt-file ${ps(briefFile)}`;
  // Codex reads Mi's server from -c overrides, so nothing is written to the person's ~/.codex.
  const codexServer = args => ["-c", `mcp_servers.mi_cad.command=${tomlLiteral(executable)}`, "-c", `mcp_servers.mi_cad.args=[${args.map(tomlLiteral).join(",")}]`, "-c", "mcp_servers.mi_cad.env.ELECTRON_RUN_AS_NODE='1'", "-c", "mcp_servers.mi_cad.tool_timeout_sec=130", "-c", "mcp_servers.mi_cad.default_tools_approval_mode='approve'"];
  function launcher(workspace, resolvedDirectory) {
    check(workspace, "revit");
    syncBindings("revit"); syncBindings("autocad");
    const dir = path.join(root, workspace.slice(9));
    const args = mcpArguments(workspace);
    const settings = configStore.getSettings();
    const config = { mcpServers: { mi_cad: { command: executable, args, env: { ELECTRON_RUN_AS_NODE: "1" } } } };
    const configFile = path.join(dir, "claude-mcp.json");
    writeLocal(configFile, JSON.stringify(config, null, 2) + "\n");
    const briefFile = path.join(dir, "agent-brief.md");
    writeLocal(briefFile, AGENT_BRIEF + "\n");
    const codexArgs = ["--no-alt-screen", ...codexServer(args)];
    const directory = resolvedDirectory || resolveDirectory?.(workspace);
    const script = `# Generated by Mi. Local launch settings only; no credentials.\nparam([ValidateSet('codex','claude')][string]$Engine = 'codex')\n$ErrorActionPreference = 'Stop'\n${directory ? `Set-Location -LiteralPath ${ps(directory)}\n` : ""}if ($Engine -eq 'codex') {\n  $cadArguments = @(${codexArgs.map(ps).join(", ")})\n  & ${ps(settings.codexBin || "codex")} @cadArguments\n} else {\n  $env:MCP_TOOL_TIMEOUT = '${REVIEW_TIMEOUT_MS}'\n  & ${ps(settings.claudeBin || "claude")} ${claudeArguments(configFile, briefFile)}\n}\nexit $LASTEXITCODE\n`;
    const file = path.join(dir, "launch.ps1");
    writeLocal(file, script);
    return file;
  }
  /**
   * Codex has no --strict-mcp-config. Its configured servers are listed at launch and each is
   * switched off for this run only with -c, and plugins and apps, whose servers cannot be switched
   * off one by one, are disabled. If the list cannot be read, or a name cannot be written as a
   * config key, the agent does not start rather than starting with tools it should not have.
   */
  function codexScript({ dir, slot, args }) {
    const codex = configStore.getSettings().codexBin || "codex";
    const brief = AGENT_BRIEF.replace(/\s*\n\s*/g, " ");
    const fixed = ["--no-alt-screen", "--disable", "plugins", "--disable", "apps", ...codexServer(args), "-c", `developer_instructions=${tomlLiteral(brief)}`];
    return `# Generated by Mi. Local launch settings only; no credentials.
$ErrorActionPreference = 'Stop'
Set-Content -LiteralPath ${ps(path.join(dir, `agent-${slot}.pid`))} -Value $PID
$codex = ${ps(codex)}
# Codex can write warnings to stderr; only its exit code and output decide.
$ErrorActionPreference = 'Continue'
$listed = (& $codex mcp list --json --disable plugins --disable apps 2>$null | Out-String).Trim()
$listedExit = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($listedExit -ne 0 -or -not $listed.StartsWith('[')) {
  Write-Host 'Mi could not list Codex''s MCP servers, so it cannot start Codex with only Mi''s CAD tools. Update Codex (codex update), then start the agent again.'
  exit 1
}
$cadArguments = @(${fixed.map(ps).join(", ")})
# Windows PowerShell 5.1 emits a JSON array as one object; foreach over it visits each element.
$servers = ConvertFrom-Json $listed
foreach ($server in $servers) {
  $name = [string]$server.name
  if (-not $name -or $name -eq 'mi_cad') { continue }
  if ($name -notmatch '^[A-Za-z0-9_-]+$') {
    Write-Host "Mi cannot switch off the Codex MCP server '$name' for this agent, so it did not start. Copy the Codex launch command under Set up MCP > More options to use your full Codex setup instead."
    exit 1
  }
  $cadArguments += @('-c', "mcp_servers.$name.enabled=false")
}
& $codex @cadArguments
exit $LASTEXITCODE
`;
  }
  // A CAD agent window runs Mi's tools only, so another server's instructions cannot compete
  // with the paired model. launch.ps1 keeps the person's full configuration for copied commands.
  // Each window gets its own terminal slot and pins its own AutoCAD drawing, so several agents can
  // work in different drawings of one project and switching in one never moves another.
  function agentCommand(workspace, engine, slot, documentId) {
    check(workspace, "revit");
    if (!Object.hasOwn(ENGINES, engine ?? "")) throw new Error("Choose Claude or Codex for the agent.");
    if (!SLOT.test(slot ?? "")) throw new Error("Choose a terminal session for the agent.");
    if (!Object.keys(stores).some(application => readBindings(application)[workspace])) throw new Error("Connect a Revit model or AutoCAD drawing to this project first.");
    if (mutating) throw new Error("Another connection change is in progress.");
    const autocad = readBindings("autocad");
    const binding = autocad[workspace];
    if (binding) {
      const pin = documentId ?? binding.document;
      if (!binding.drawings.some(item => item.document === pin)) throw new Error("That drawing is no longer connected to this project. Connect it again.");
      autocad[workspace] = { ...binding, pins: { ...binding.pins, [slot]: pin } };
      save("autocad", autocad);
    }
    const dir = path.dirname(launcher(workspace));
    const file = path.join(dir, `launch-cad-only-${slot}.ps1`);
    if (engine === "codex") writeLocal(file, codexScript({ dir, slot, args: mcpArguments(workspace, slot) }));
    else {
      const configFile = path.join(dir, `claude-mcp-${slot}.json`);
      writeLocal(configFile, JSON.stringify({ mcpServers: { mi_cad: { command: executable, args: mcpArguments(workspace, slot), env: { ELECTRON_RUN_AS_NODE: "1" } } } }, null, 2) + "\n");
      writeLocal(file, `# Generated by Mi. Local launch settings only; no credentials.\n$ErrorActionPreference = 'Stop'\nSet-Content -LiteralPath ${ps(path.join(dir, `agent-${slot}.pid`))} -Value $PID\n$env:MCP_TOOL_TIMEOUT = '${REVIEW_TIMEOUT_MS}'\n& ${ps(configStore.getSettings().claudeBin || "claude")} --strict-mcp-config ${claudeArguments(configFile, path.join(dir, "agent-brief.md"))}\nexit $LASTEXITCODE\n`);
    }
    // Absolute, because a terminal's PATH is the person's to change and may omit PowerShell.
    const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    return `"${powershell}" -NoProfile -ExecutionPolicy Bypass -File "${file}"\r`;
  }
  /** Whether the agent in this project's terminal slot is still running, not merely whether its shell is. */
  function agentRunning(workspace, slot) {
    if (!SLOT.test(slot ?? "")) return false;
    try {
      const pid = Number(fs.readFileSync(path.join(root, workspace.slice(9), `agent-${slot}.pid`), "utf8").trim());
      if (!Number.isSafeInteger(pid) || pid < 1) return false;
      process.kill(pid, 0);
      return true;
    } catch { return false; }
  }
  /** The AutoCAD drawing an agent window works in, or null when the project has no drawing connected. */
  function agentDrawing(workspace, slot) {
    return forSlot(readBindings("autocad")[workspace], slot)?.document ?? null;
  }
  /** slot names an agent window, whose own pinned drawing is reported as current. */
  async function status(workspace, application = "revit", slot) {
    check(workspace, application);
    const { label, noun } = APPLICATIONS[application];
    const bindings = syncBindings(application);
    const sessions = await Promise.all(discover(stores[application].sessions, application).map(async session => {
      try {
        const { document, documents, ...rest } = await request(session.pipe, { method: "discover" }, { timeoutMs: 8000 });
        // Revit reports its one active model; AutoCAD reports every open drawing.
        const features = Array.isArray(rest.features) ? rest.features.filter(item => typeof item === "string").slice(0, 10) : [];
        return { session: session.session, pid: session.pid, ...rest, features, year: session.year ?? null, documents: documents ?? (document ? [document] : []) };
        // A live application that does not answer is usually showing a modal dialog, such as a
        // connect or edit review, which holds its request queue until the person answers.
      } catch (e) { return { session: session.session, pid: session.pid, year: session.year ?? null, error: e.message, ...(e.code === "ETIMEDOUT" ? { busy: true } : {}), documents: [] }; }
    }));
    const stored = forSlot(bindings[workspace], slot) || null;
    // Other connected drawings are reachable while their file is still open in a live session. A
    // busy session cannot list its files, so its drawings are not reported as closed.
    const open = (drawing) => sessions.some(session => session.session === drawing.session && (session.busy || session.documents.some(item => item.id === drawing.document)));
    const binding = stored && (stored.drawings ? { ...stored, drawings: stored.drawings.map(drawing => ({ ...drawing, open: open(drawing) })) } : stored);
    let health = "Not connected";
    if (binding) {
      if (sessions.some(session => session.session === binding.session && session.busy)) health = "Busy";
      else {
        try { await request(binding.pipe, { method: "query", workspace, document: binding.document, arguments: { kind: "status" } }, { timeoutMs: 8000 }); health = "Connected"; }
        // A person mid-command is the normal state of a working drawing, not a lost connection.
        catch (error) { health = /is busy/i.test(error?.message) ? "Connected" : error?.code === "ETIMEDOUT" ? "Busy" : `Reconnect required — the ${noun}, ${label} session, or pairing changed`; }
      }
    }
    // A carried payload does not change while Mi runs, so a verified one is not hashed again.
    if (!payloadVerified[application]) {
      try { if (application === "autocad") readAutocadPayload(autocadPayloadDirectory); else readPayload(payloadDirectory); payloadVerified[application] = true; } catch { /* Source checkouts need a native build first. */ }
    }
    const payloadAvailable = payloadVerified[application];
    const found = application === "autocad" ? await releases() : null;
    const addin = addinState({ application, payloadDirectory: application === "autocad" ? autocadPayloadDirectory : payloadDirectory, appData, releases: found?.supported });
    const reviewsInMi = Boolean(binding && approvals.has(approvalKey(application, workspace, binding.document)));
    return { application, sessions, binding, health, payloadAvailable, addin, applicationInstalled: await isInstalled(application), applicationRunning: await isRunning(application), reviewsInMi, requiredVersion: stores[application].requiredVersion,
      ...(found ? { releases: found } : {}), launcher: launcher(workspace) };
  }
  /** A binding without one drawing, or null when nothing is left. The next connected drawing becomes current. */
  function withoutDrawing(binding, sessionId, documentId) {
    const matches = drawing => drawing.session === sessionId && drawing.document === documentId;
    if (!binding.drawings) return matches(binding) ? null : binding;
    const drawings = binding.drawings.filter(drawing => !matches(drawing));
    if (!drawings.length) return null;
    return matches(binding) ? { ...drawings[0], drawings, pins: binding.pins } : { ...binding, drawings };
  }
  /** What an add-in reports about itself: its features and the ids of the files open in it. */
  const describeSession = info => ({ features: Array.isArray(info?.features) ? info.features : [], open: new Set((Array.isArray(info?.documents) ? info.documents : []).map(item => item?.id)) });
  const sessionInfo = pipe => request(pipe, { method: "discover" }, { timeoutMs: 8000 }).then(describeSession, () => describeSession(null));
  /**
   * The approval secret of another drawing of this project that is still open in the same AutoCAD,
   * which lets the add-in skip its own dialog because the person already approved in Mi. A closed
   * file's pairing is gone from the add-in, so its secret proves nothing. A drawing that belongs to
   * another project gets none, since connecting moves it. The secret stays in this process.
   */
  function trustFor(workspace, sessionId, documentId, bindings, { features, open }) {
    if (!features.includes("trusted-connect")) return undefined;
    if (documentId && Object.entries(bindings).some(([key, value]) => key !== workspace && (value.drawings ?? [value]).some(item => item.session === sessionId && item.document === documentId))) return undefined;
    return (bindings[workspace]?.drawings ?? []).filter(item => item.session === sessionId && item.document !== documentId && open.has(item.document))
      .map(item => approvals.get(approvalKey("autocad", workspace, item.document))).find(Boolean);
  }
  // A window pinned to a closed file keeps its pin when that file is connected again under its new identity.
  const remapPins = (pins, from, to) => pins && Object.fromEntries(Object.entries(pins).map(([slot, id]) => [slot, from.has(id) ? to : id]));
  // A reopened file has a new identity, so an entry of the same name whose file closed is the same drawing.
  async function closedDrawing(drawing, live) {
    const owner = live.find(item => item.session === drawing.session);
    if (!owner) return true;
    const found = await request(owner.pipe, { method: "discover" }, { timeoutMs: 8000 }).catch(() => null);
    return Boolean(found) && !(found.documents ?? []).some(item => item.id === drawing.document);
  }
  const unbind = drawing => request(drawing.pipe, { method: "unbind", workspace: drawing.workspace, document: drawing.document }, { timeoutMs: 8000 }).then(() => true, () => false);
  // A window's pin to a drawing that left the project is not kept. The drawing order is left alone.
  const prunePins = binding => {
    if (!binding?.pins) return binding;
    const pins = Object.fromEntries(Object.entries(binding.pins).filter(([, id]) => (binding.drawings ?? []).some(item => item.document === id)));
    const { pins: _old, ...rest } = binding;
    return Object.keys(pins).length ? { ...rest, pins } : rest;
  };
  function save(application, bindings) {
    configStore.updateSettings({ [stores[application].setting]: Object.fromEntries(Object.entries(bindings).map(([key, value]) => [key, prunePins(value)])) });
    syncBindings(application);
  }
  async function changing(action) {
    if (mutating) throw new Error("Another connection change is in progress.");
    mutating = true;
    try { return await action(); } finally { mutating = false; }
  }
  /**
   * Connects an open file and makes it current. An AutoCAD project keeps its other drawings. With a
   * slot, it becomes current for that agent window only, and the project's default stays as it was.
   */
  async function bind(workspace, application, sessionId, documentId, slot) {
    check(workspace, application);
    const session = discover(stores[application].sessions, application).find(s => s.session === sessionId);
    if (!session) throw new Error(`${APPLICATIONS[application].label} session is no longer available. Refresh connections.`);
    await changing(async () => {
      const approval = crypto.randomBytes(32).toString("hex");
      const info = application === "autocad" ? await sessionInfo(session.pipe) : describeSession(null);
      const { features } = info;
      const trust = application === "autocad" ? trustFor(workspace, sessionId, documentId, readBindings(application), info) : undefined;
      const document = await request(session.pipe, { method: "bind", workspace, document: documentId, approval, ...(trust ? { trust } : {}) });
      const bindings = readBindings(application);
      approvals.set(approvalKey(application, workspace, document.id), approval);
      const entry = { session: sessionId, pipe: session.pipe, document: document.id, title: document.title, ...(session.year ? { year: session.year } : {}) };
      // The add-in moves a file to the project that connected it last.
      for (const [key, old] of Object.entries(bindings)) {
        if (key === workspace) continue;
        const left = withoutDrawing(old, sessionId, document.id);
        if (left === old) continue;
        approvals.delete(approvalKey(application, key, document.id));
        if (left) bindings[key] = left; else delete bindings[key];
      }
      const previous = bindings[workspace];
      if (application === "autocad") {
        // An add-in from before multi-drawing support keeps one drawing per project in each session.
        const many = features.includes("multi-drawing");
        const live = discover(stores[application].sessions, application);
        const stale = new Set();
        for (const drawing of previous?.drawings ?? []) if (drawing.document !== document.id && drawing.title === document.title && await closedDrawing(drawing, live)) stale.add(drawing);
        const staleIds = new Set([...stale].map(drawing => drawing.document));
        const others = (previous?.drawings ?? []).filter(drawing => !stale.has(drawing) && !(drawing.session === sessionId && (drawing.document === document.id || !many)));
        const kept = others.slice(0, MAX_DRAWINGS - 1);
        for (const dropped of (previous?.drawings ?? []).filter(drawing => drawing.document !== document.id && !kept.includes(drawing))) {
          approvals.delete(approvalKey(application, workspace, dropped.document));
          if (many || dropped.session !== sessionId) await unbind({ ...dropped, workspace });
        }
        const pinned = SLOT.test(slot ?? "");
        const stays = pinned ? kept.find(drawing => drawing.session === previous.session && drawing.document === previous.document) : undefined;
        bindings[workspace] = { ...(stays ?? entry), drawings: [entry, ...kept], pins: { ...remapPins(previous?.pins, staleIds, document.id), ...(pinned ? { [slot]: document.id } : {}) } };
      } else {
        if (previous && previous.document !== document.id) approvals.delete(approvalKey(application, workspace, previous.document));
        // A Revit project holds one model, so a model in another session leaves its old pairing behind.
        if (previous && previous.session !== sessionId) await unbind({ ...previous, workspace });
        bindings[workspace] = entry;
      }
      save(application, bindings);
    });
    return status(workspace, application, slot);
  }
  /**
   * The open AutoCAD drawings to connect, as Mi itself finds them: titles and paths come from the
   * add-in, never from the agent. Drawings already connected are skipped. asks marks the drawings
   * whose AutoCAD will show its own dialog: the first in an AutoCAD where this project has no
   * approval yet. The rest in that AutoCAD use the approval the first one creates.
   */
  async function connectPlan(workspace, targets) {
    check(workspace, "autocad");
    if (!Array.isArray(targets) || targets.length < 1 || targets.length >= MAX_DRAWINGS || targets.some(item => !SESSION.test(item?.session) || !SESSION.test(item?.document))) throw new Error(`Name 1–${MAX_DRAWINGS - 1} open drawings.`);
    const bindings = readBindings("autocad");
    const connected = bindings[workspace]?.drawings ?? [];
    const live = discover(stores.autocad.sessions, "autocad");
    const found = new Map();
    const plan = [];
    for (const target of targets) {
      if (plan.some(item => item.session === target.session && item.document === target.document)) continue;
      if (connected.some(item => item.session === target.session && item.document === target.document)) continue;
      const session = live.find(item => item.session === target.session);
      if (!session) throw new Error("That AutoCAD session has closed. List the drawings again.");
      if (!found.has(session.session)) found.set(session.session, await request(session.pipe, { method: "discover" }, { timeoutMs: 8000 }));
      const info = found.get(session.session) ?? {};
      const open = (Array.isArray(info.documents) ? info.documents : []).find(item => item?.id === target.document);
      if (!open) throw new Error("That drawing is no longer open in AutoCAD. List the drawings again.");
      const features = Array.isArray(info.features) ? info.features : [];
      if (!features.includes("multi-drawing")) throw new Error("This AutoCAD add-in connects one drawing per project. Ask the person to close AutoCAD and install the update under Set up MCP → More options.");
      const elsewhere = Object.entries(bindings).find(([key, value]) => key !== workspace && (value.drawings ?? [value]).some(item => item.session === session.session && item.document === open.id))?.[0];
      // Trusted once this project has an approval in that AutoCAD, or an earlier drawing here creates one.
      const trusted = features.includes("trusted-connect") && (Boolean(trustFor(workspace, session.session, null, bindings, describeSession(info)))
        || plan.some(item => item.session === session.session));
      plan.push({ session: session.session, pipe: session.pipe, year: session.year ?? null, document: open.id, title: String(open.title ?? "Drawing").slice(0, 300),
        path: typeof open.path === "string" ? open.path.slice(0, 1000) : null, readOnly: open.isReadOnly === true, elsewhere, info: describeSession(info), asks: Boolean(elsewhere) || !trusted });
    }
    if (!plan.length) throw new Error("Those drawings are already connected to this project. Read them by name.");
    if (connected.length + plan.length > MAX_DRAWINGS) throw new Error(`A project can have ${MAX_DRAWINGS} drawings connected. Ask the person to disconnect one first.`);
    return plan;
  }
  /** What the person approves before an agent's requested drawings are connected. */
  async function describeConnect(workspace, targets, reason) {
    const plan = await connectPlan(workspace, targets);
    const lines = plan.map(item => [`${item.year ? `AutoCAD ${item.year} · ` : ""}${item.title}${item.readOnly ? " · read-only" : ""}`, item.path ?? "Not saved yet",
      ...(item.elsewhere ? [`Connected to ${item.elsewhere.slice(9)} now; connecting moves it to this project.`] : []),
      ...(item.asks ? ["AutoCAD asks you to confirm this one as well."] : [])].join("\n"));
    const why = reason ? `\n\nThe agent's reason: ${reason}` : "";
    const titles = plan.map(item => item.title).join(", ");
    return { title: titles.length > 300 ? `${plan.length} drawings` : titles,
      summary: `${lines.join("\n\n")}${why}\n\nThe agent can then read ${plan.length === 1 ? "it" : "them"}. Its current drawing stays the same, and every edit still needs your approval.` };
  }
  /**
   * Records a drawing the add-in just paired with this project, keeping the project's current
   * drawing and every window's pin. A closed file of the same name that it replaces hands over its
   * place: current if it was current, and the pins that pointed at it.
   */
  async function record(workspace, item, document, approval) {
    approvals.set(approvalKey("autocad", workspace, document.id), approval);
    const bindings = readBindings("autocad");
    // The add-in moves a file to the project that connected it last.
    for (const [key, old] of Object.entries(bindings)) {
      if (key === workspace) continue;
      const left = withoutDrawing(old, item.session, document.id);
      if (left === old) continue;
      approvals.delete(approvalKey("autocad", key, document.id));
      if (left) bindings[key] = left; else delete bindings[key];
    }
    const entry = { session: item.session, pipe: item.pipe, document: document.id, title: String(document.title ?? "Drawing").slice(0, 300), ...(item.year ? { year: item.year } : {}) };
    const previous = bindings[workspace];
    const live = discover(stores.autocad.sessions, "autocad");
    const stale = new Set();
    for (const drawing of previous?.drawings ?? []) if (drawing.document !== document.id && drawing.title === entry.title && await closedDrawing(drawing, live)) stale.add(drawing.document);
    for (const id of stale) approvals.delete(approvalKey("autocad", workspace, id));
    const kept = (previous?.drawings ?? []).filter(drawing => !stale.has(drawing.document) && drawing.document !== document.id);
    if (kept.length >= MAX_DRAWINGS) throw new Error(`A project can have ${MAX_DRAWINGS} drawings connected. Disconnect one first.`);
    // A closed file that this one replaces stops being current; otherwise the current drawing stays.
    const current = previous && !stale.has(previous.document) ? previous : entry;
    bindings[workspace] = { ...current, drawings: [...kept, entry], ...(previous?.pins ? { pins: remapPins(previous.pins, stale, document.id) } : {}) };
    save("autocad", bindings);
  }
  /** Pairs each planned drawing in turn; the first in each AutoCAD creates the approval the rest use. */
  async function attachPlanned(workspace, plan) {
    const results = [];
    for (const item of plan) {
      try {
        const approval = crypto.randomBytes(32).toString("hex");
        const trust = item.elsewhere ? undefined : trustFor(workspace, item.session, item.document, readBindings("autocad"), item.info);
        const document = await request(item.pipe, { method: "bind", workspace, document: item.document, approval, ...(trust ? { trust } : {}) });
        await record(workspace, item, document, approval);
        results.push({ drawing: document.title, connected: true });
      } catch (error) { results.push({ drawing: item.title, connected: false, error: error instanceof Error ? error.message : String(error) }); }
    }
    return results;
  }
  /**
   * Connects the drawings a person approved in Mi, from an agent's request or from Set up MCP.
   * Each drawing reports its own outcome; one that fails leaves the others connected.
   */
  async function attach(workspace, targets) {
    return changing(async () => attachPlanned(workspace, await connectPlan(workspace, targets)));
  }
  /**
   * The drawing an agent asked to open, as Mi finds it: a .dwg file inside the project's confirmed
   * folder, after every link is resolved, and the AutoCAD that will open it. A file that is already
   * open becomes a connect plan instead.
   */
  async function openPlan(workspace, requested) {
    check(workspace, "autocad");
    if (typeof requested !== "string" || !requested.trim() || requested.length > 1000 || /[\u0000-\u001f\u007f]/.test(requested)) throw new Error("Name one .dwg file in this project's folder.");
    const folder = resolveProjectRoot?.(workspace);
    if (!folder) throw new Error("This project has no confirmed folder, so Mi cannot open drawings for it. Ask the person to open the drawing in AutoCAD.");
    const root = fs.realpathSync.native(folder);
    const candidate = path.resolve(root, requested.trim());
    if (!/\.dwg$/i.test(candidate)) throw new Error("Only .dwg drawings can be opened.");
    let stat;
    try { stat = fs.lstatSync(candidate); } catch { throw new Error(`${path.basename(candidate)} was not found in this project's folder. List the folder again.`); }
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("That path is not a drawing file Mi can open.");
    const file = fs.realpathSync.native(candidate);
    if (!inside(root, file)) throw new Error("Mi only opens drawings inside this project's folder.");
    const relative = path.relative(root, file);
    const live = discover(stores.autocad.sessions, "autocad");
    if (!live.length) throw new Error("AutoCAD is not running. Ask the person to open AutoCAD.");
    const found = (await Promise.all(live.map(session => request(session.pipe, { method: "discover" }, { timeoutMs: 8000 }).then(info => ({ session, info }), () => null)))).filter(Boolean);
    for (const { session, info } of found) {
      const open = (Array.isArray(info?.documents) ? info.documents : []).find(item => samePath(item?.path, file));
      if (open) return { connect: { session: session.session, document: open.id }, relative, title: path.basename(file) };
    }
    if ((readBindings("autocad")[workspace]?.drawings?.length ?? 0) >= MAX_DRAWINGS) throw new Error(`A project can have ${MAX_DRAWINGS} drawings connected. Ask the person to disconnect one first.`);
    const able = found.filter(({ info }) => Array.isArray(info?.features) && info.features.includes("open-drawing"));
    if (!able.length) throw new Error("This AutoCAD add-in cannot open drawings yet. Ask the person to open it in AutoCAD, or to close AutoCAD and install the update under Set up MCP → More options.");
    const holding = new Set((readBindings("autocad")[workspace]?.drawings ?? []).map(item => item.session));
    const preferred = able.filter(({ session }) => holding.has(session.session));
    const choice = preferred.length === 1 ? preferred[0] : able.length === 1 ? able[0] : null;
    if (!choice) throw new Error("Several AutoCAD windows are open. Ask the person to open the drawing in the one they want.");
    const { session, info } = choice;
    return { session: session.session, pipe: session.pipe, year: session.year ?? null, info: describeSession(info), file, relative, title: path.basename(file) };
  }
  /** What the person approves before Mi opens a drawing for an agent and connects it. */
  async function describeOpen(workspace, requested, readOnly, reason) {
    const plan = await openPlan(workspace, requested);
    const why = reason ? `\n\nThe agent's reason: ${reason}` : "";
    // Already open: the same checks as connecting it, so a drawing already connected is refused here too.
    if (plan.connect) await connectPlan(workspace, [plan.connect]);
    if (plan.connect) return { title: plan.title, summary: `${plan.relative}\n\nAlready open in AutoCAD. Connecting lets the agent read it.${why}\n\nIts current drawing stays the same, and every edit still needs your approval.` };
    const asks = !trustFor(workspace, plan.session, null, readBindings("autocad"), plan.info);
    return { title: plan.title,
      summary: `${plan.year ? `AutoCAD ${plan.year} · ` : ""}${plan.relative}\n${readOnly ? "Opens read-only, so the agent can read it but not change it." : "Opens for editing. Every edit still needs your approval, and nothing saves."}${why}\n\nAutoCAD opens it as if you had opened it, makes it active, and Mi connects it to this project.${asks ? " AutoCAD asks you to confirm as well." : ""}` };
  }
  /** Opens the approved drawing in AutoCAD and connects it, or connects it if it is already open. */
  async function openDrawing(workspace, requested, readOnly) {
    return changing(async () => {
      const plan = await openPlan(workspace, requested);
      if (plan.connect) {
        const [result] = await attachPlanned(workspace, await connectPlan(workspace, [plan.connect]));
        return { opened: false, ...result };
      }
      const approval = crypto.randomBytes(32).toString("hex");
      const trust = trustFor(workspace, plan.session, null, readBindings("autocad"), plan.info);
      // The add-in opens the file and pairs it in one step, so the person answers at most once.
      const document = await request(plan.pipe, { method: "open", workspace, path: plan.file, readOnly: readOnly === true, approval, ...(trust ? { trust } : {}) });
      await record(workspace, plan, document, approval);
      return { opened: true, drawing: document.title, connected: true, readOnly: document.isReadOnly === true };
    });
  }
  /**
   * Makes an already-connected drawing current, for one agent window when a slot is given, or as the
   * project's default otherwise. Nothing reaches the application, so no dialog appears.
   */
  async function select(workspace, application, documentId, slot) {
    check(workspace, application);
    if (!SESSION.test(documentId)) throw new Error("Choose a connected drawing.");
    await changing(async () => {
      const bindings = readBindings(application);
      const drawing = bindings[workspace]?.drawings?.find(item => item.document === documentId);
      if (!drawing) throw new Error("That drawing is no longer connected to this project. Connect it again.");
      const { pins, drawings } = bindings[workspace];
      bindings[workspace] = SLOT.test(slot ?? "") ? { ...bindings[workspace], pins: { ...pins, [slot]: documentId } } : { ...drawing, drawings, pins };
      save(application, bindings);
    });
    return status(workspace, application, slot);
  }
  /** Disconnects one drawing and leaves the project's others connected. */
  async function forget(workspace, application, documentId, slot) {
    check(workspace, application);
    if (!SESSION.test(documentId)) throw new Error("Choose a connected drawing.");
    let revoked = true;
    await changing(async () => {
      const bindings = readBindings(application);
      const binding = bindings[workspace];
      const drawing = (binding?.drawings ?? (binding ? [binding] : [])).find(item => item.document === documentId);
      if (!drawing) return;
      revoked = await unbind({ ...drawing, workspace });
      approvals.delete(approvalKey(application, workspace, documentId));
      const left = withoutDrawing(binding, drawing.session, documentId);
      if (left) bindings[workspace] = left; else delete bindings[workspace];
      save(application, bindings);
    });
    return { ...(await status(workspace, application, slot)), revoked };
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
      for (const drawing of binding?.drawings ?? (binding ? [binding] : [])) {
        if (!await unbind({ ...drawing, workspace })) revoked = false;
        approvals.delete(approvalKey(application, workspace, drawing.document));
      }
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
  /** The connected file a preview belongs to: the named one, or the current one when none is named. */
  function reviewTarget(workspace, application, document) {
    const current = readBindings(application)[workspace];
    const binding = !current || !document || current.document === document ? current : current.drawings?.find(item => item.document === document);
    const approval = binding && approvals.get(approvalKey(application, workspace, binding.document));
    return approval ? { binding, approval } : null;
  }
  /** The add-in's own wording for a pending preview, or null when Mi cannot review it. */
  async function describeReview(workspace, application, token, document) {
    check(workspace, application);
    const target = reviewTarget(workspace, application, document);
    if (!target) return null;
    return request(target.binding.pipe, { method: "describe", workspace, document: target.binding.document, arguments: { preview_token: token } }, { timeoutMs: 8000 });
  }
  async function applyReviewed(workspace, application, token, document) {
    const target = reviewTarget(workspace, application, document);
    if (!target) throw new Error("This connection changed during the review. Nothing was applied.");
    return request(target.binding.pipe, { method: "apply", workspace, document: target.binding.document, arguments: { preview_token: token }, approval: target.approval });
  }
  const lessonApi = { list: () => lessons.read(lessonsFile), add: text => lessons.add(lessonsFile, text), review: (id, accept) => lessons.review(lessonsFile, id, accept), remove: id => lessons.remove(lessonsFile, id) };
  return { status, bind, select, forget, disconnect, launcher, agentCommand, agentRunning, agentDrawing, install, describeReview, applyReviewed, describeConnect, attach, describeOpen, openDrawing, reviewFile, lessons: lessonApi, version: nativeVersion };
}
module.exports = { createCadService, cachedReleases, AGENT_BRIEF };
