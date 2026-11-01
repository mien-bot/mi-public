/* eslint-disable @typescript-eslint/no-require-imports -- Desktop verification uses Playwright's Node API. */
const { _electron, chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
if (fs.existsSync(path.join(process.cwd(), ".next/dev/lock"))) throw new Error("An existing Next dev server owns the cache; finish it before verification.");
const repo = process.cwd();
const packagedExecutable = process.env.MI_CAD_TEST_EXECUTABLE;
const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "mi-cad-ui-")));
const profile = path.join(root, "profile");
const slug = `mi-cad-fixture-${Date.now().toString(36)}`;
require("tsx/cjs");
require("../lib/content/scaffoldProject.ts").scaffoldProject(slug, "CAD verification fixture", { client: "Local test fixture" });
if (packagedExecutable) fs.cpSync(path.join(repo, "projects", slug), path.join(profile, "data/projects", slug), { recursive: true });
fs.mkdirSync(path.join(profile, "config"), { recursive: true });
const agentSlug = `${slug}-agent`;
require("../lib/content/scaffoldProject.ts").scaffoldProject(agentSlug, "CAD agent verification fixture", { client: "Local test fixture" });
if (packagedExecutable) fs.cpSync(path.join(repo, "projects", agentSlug), path.join(profile, "data/projects", agentSlug), { recursive: true });
// A stub CLI and a stale pairing exercise Start Claude without a real agent, drawing, or credentials.
const stubClaude = path.join(root, "claude-stub.cmd");
fs.writeFileSync(stubClaude, "@echo MI-CAD-STUB %*\r\n");
const fakeId = crypto.randomUUID().replaceAll("-", "");
const fakeRevitId = crypto.randomUUID().replaceAll("-", "");
const cadBindings = { [`projects/${agentSlug}`]: { session: fakeRevitId, pipe: `mi-revit-1-${fakeRevitId}`, document: fakeRevitId, title: "fixture-model.rvt" } };
const autocadBindings = { [`projects/${agentSlug}`]: { session: fakeId, pipe: `mi-autocad-1-${fakeId}`, document: fakeId, title: "fixture-drawing.dwg" } };
fs.writeFileSync(path.join(profile, "config/settings.json"), JSON.stringify({ setupCompleted: true, notionSyncEnabled: false, launchAtLogin: false, launchAtLoginConfigured: true, claudeBin: stubClaude, cadBindings, autocadBindings }));
const env = Object.fromEntries(["SystemRoot", "WINDIR", "TEMP", "TMP", "APPDATA", "LOCALAPPDATA", "USERPROFILE", "ComSpec", "PATH"].filter(k => process.env[k]).map(k => [k, process.env[k]]));
Object.assign(env, { MI_USER_DATA_DIR: profile, NOTION_API_KEY: "mi-test-disabled", CLAUDE_CODE_OAUTH_TOKEN: "mi-test-disabled", ANTHROPIC_API_KEY: "mi-test-disabled", OPENAI_API_KEY: "mi-test-disabled", DROPBOX_ROOT: path.join(root, "dropbox") });
if (packagedExecutable) env.PATH = path.join(process.env.SystemRoot, "System32");
fs.mkdirSync(env.DROPBOX_ROOT);
let app, browser;
// The add-in may already be installed here, which moves its repair button under More options.
const moreOptions = target => target.locator("details[data-cad-more]").evaluate(element => { element.open = true; });
(async () => {
  try {
    const port = await new Promise(resolve => { const server = net.createServer(); server.listen(0, "127.0.0.1", () => { const p = server.address().port; server.close(() => resolve(p)); }); });
    const origin = `http://127.0.0.1:${port}`;
    const launchOptions = { ...(packagedExecutable ? { executablePath: path.resolve(packagedExecutable) } : {}), args: [...(packagedExecutable ? [] : ["."]), `--user-data-dir=${profile}`], env: { ...env, STUDIO_ELECTRON_PORT: String(port) }, timeout: 120000 };
    app = await _electron.launch(launchOptions);
    for (const stream of [app.process().stdout, app.process().stderr]) stream?.on("data", data => fs.appendFileSync(path.join(root, "server.log"), data));
    const page = await app.firstWindow({ timeout: 120000 }); page.setDefaultTimeout(30000);
    await page.getByRole("navigation").first().waitFor({ timeout: 120000 });
    await page.goto(`${origin}/projects/${slug}/terminal`, { timeout: 120000 });
    await page.getByRole("button", { name: "Set up MCP", exact: true }).click();
    await moreOptions(page);
    await page.getByRole("button", { name: "Install / repair Revit add-in", exact: true }).waitFor();
    await page.getByRole("button", { name: "Copy codex", exact: true }).waitFor();
    await page.getByRole("button", { name: "Install / repair Revit add-in", exact: true }).click({ trial: true }); // Waits until enabled.
    await page.getByRole("button", { name: "AutoCAD", exact: true }).click();
    await page.getByRole("button", { name: "Install / repair AutoCAD add-in", exact: true }).waitFor();
    await page.getByRole("button", { name: "Install / repair AutoCAD add-in", exact: true }).click({ trial: true }); // Waits until enabled.
    await page.screenshot({ path: path.join(root, "cad-autocad.png") });
    await page.getByRole("button", { name: "Revit", exact: true }).click();
    await page.getByRole("button", { name: "Install / repair Revit add-in", exact: true }).waitFor();
    await page.screenshot({ path: path.join(root, "cad-desktop.png") });
    const workspace = `projects/${slug}`;
    await page.evaluate(workspace => window.electronAPI.windows.openPane("terminal", { workspace, session: "2" }), workspace);
    const pane = await new Promise(resolve => {
      const existing = app.windows().find(w => w.url().includes("/terminal/window"));
      if (existing) resolve(existing); else app.once("window", resolve);
    });
    await pane.getByRole("button", { name: "Set up MCP", exact: true }).waitFor();
    await pane.getByRole("button", { name: "Set up MCP", exact: true }).click();
    await moreOptions(pane);
    await pane.getByRole("button", { name: "Copy claude", exact: true }).waitFor();
    await pane.getByRole("button", { name: "AutoCAD", exact: true }).click();
    await pane.getByRole("button", { name: "Install / repair AutoCAD add-in", exact: true }).waitFor();
    await pane.screenshot({ path: path.join(root, "cad-popout.png") });
    await page.goto(`${origin}/projects/${agentSlug}/terminal`, { timeout: 120000 });
    const banner = page.getByRole("status", { name: "MCP connection" });
    await banner.getByText("fixture-drawing.dwg", { exact: false }).waitFor();
    await banner.getByText("fixture-model.rvt", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Set up MCP", exact: true }).click();
    await page.getByText(/^Revit add-in/).first().waitFor();
    await page.getByRole("button", { name: "Start Claude", exact: true }).click();
    await page.getByText("Claude started in session 2.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Set up MCP", exact: true }).click(); // Starting an agent closes setup.
    await moreOptions(page);
    assert(await page.getByRole("button", { name: "Copy claude", exact: true }).isVisible());
    await page.getByText("Improve the MCP").click();
    await page.getByRole("textbox", { name: "New lesson", exact: true }).fill("Keep leaders from crossing.");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("button", { name: "Remove", exact: true }).waitFor();
    await page.getByText("Keep leaders from crossing.", { exact: true }).waitFor();
    await page.screenshot({ path: path.join(root, "cad-lessons.png") });
    const agentPane = await (async () => { for (let i = 0; i < 100; i++) { const found = app.windows().find(w => w.url().includes("/terminal/window") && w.url().includes(agentSlug)); if (found) return found; await new Promise(r => setTimeout(r, 200)); } throw new Error("Agent window did not open."); })();
    await agentPane.getByRole("status", { name: "MCP connection" }).getByText("CAD agent", { exact: false }).waitFor();
    const history = () => agentPane.locator(".xterm").innerText().catch(() => "");
    for (let i = 0; i < 100 && !/MI-CAD-STUB/.test(await history()); i++) await new Promise(r => setTimeout(r, 200));
    await agentPane.screenshot({ path: path.join(root, "cad-agent.png") });
    assert.match(await history(), /MI-CAD-STUB --strict-mcp-config/);
    await agentPane.evaluate(workspace => window.electronAPI.windows.closePane("terminal", { workspace, session: "2" }), `projects/${agentSlug}`).catch(() => {});
    browser = await chromium.launch({ channel: "msedge" }); const web = await browser.newPage();
    await web.goto(`${origin}/projects/${slug}/terminal`, { timeout: 120000 });
    await web.getByRole("button", { name: "Set up MCP", exact: true }).click();
    await web.getByText("CAD connections require the Mi desktop app on Windows.", { exact: true }).waitFor();
    assert.equal(await web.getByRole("button", { name: "Install / repair Revit add-in", exact: true }).count(), 0);
    await web.getByRole("button", { name: "AutoCAD", exact: true }).click();
    await web.getByText("CAD connections require the Mi desktop app on Windows.", { exact: true }).waitFor();
    assert.equal(await web.getByRole("button", { name: "Install / repair AutoCAD add-in", exact: true }).count(), 0);
    await web.screenshot({ path: path.join(root, "cad-browser.png") });
    if (packagedExecutable) {
      await browser.close(); browser = null;
      await app.close(); app = await _electron.launch(launchOptions);
      const restarted = await app.firstWindow({ timeout: 120000 });
      await restarted.getByRole("navigation").first().waitFor({ timeout: 120000 });
      await restarted.goto(`${origin}/projects/${slug}/terminal`, { timeout: 120000 });
      await restarted.getByRole("button", { name: "Set up MCP", exact: true }).click();
      await moreOptions(restarted);
      await restarted.getByRole("button", { name: "Copy codex", exact: true }).waitFor();
      await restarted.screenshot({ path: path.join(root, "cad-restarted.png") });
    }
    console.log(`PASS desktop CAD setup, native payload availability, session-2 pop-out, and browser fallback. Evidence: ${root}`);
  } finally {
    if (app) for (const [index, window] of app.windows().entries()) {
      try { await window.screenshot({ path: path.join(root, `final-window-${index}.png`) }); } catch { /* Window may already be closing. */ }
    }
    await browser?.close(); await app?.close();
    for (const owned of [slug, agentSlug]) {
    const fixture = path.resolve(repo, "projects", owned);
    const archive = path.resolve(repo, ".tmp", `${owned}-archived`);
    assert(fixture.startsWith(path.resolve(repo, "projects") + path.sep));
    assert(archive.startsWith(path.resolve(repo, ".tmp") + path.sep));
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    if (fs.existsSync(fixture)) fs.renameSync(fixture, archive);
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
