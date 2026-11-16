/* eslint-disable @typescript-eslint/no-require-imports -- This Node harness loads fixture scaffolders through tsx/cjs. */
// Review batch "Choose folder…": New folder creates a folder inside the project's confirmed
// Dropbox folder and selects it, in the desktop window and in a plain browser.
const { _electron, chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net');
const assert = require('node:assert/strict');
const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mi-review-folder-')));
const executable = process.argv[2] ? path.resolve(process.argv[2]) : null;
const profile = path.join(root, 'profile'), dropbox = path.join(root, 'dropbox');
const repo = executable ? path.join(profile, 'data') : process.cwd();
if (executable) process.env.MI_CONTENT_ROOT = repo;
const slug = 'fix-review-folder', projectFolder = path.join(dropbox, 'Projects', 'Review Folder Fixture');
fs.mkdirSync(path.join(profile, 'config'), { recursive: true });
fs.mkdirSync(projectFolder, { recursive: true });
fs.mkdirSync(path.join(dropbox, 'shared'), { recursive: true });
process.env.DROPBOX_ROOT = dropbox; process.env.DROPBOX_FIRM_DATA_PATH = 'shared';
require('tsx/cjs');
const { scaffoldProject } = require('../lib/content/scaffoldProject.ts');
const { appendOutboxEntry } = require('../lib/content/workspaceOutbox.ts');
scaffoldProject(slug, 'Review folder fixture', { client: 'UI fixture', scopeLabels: ['Fixture'], dropboxPath: 'Projects/Review Folder Fixture' });
const entry = (title) => ({ version: 1, kind: 'fact', created_at: new Date().toISOString(), session: { id: 'fixture', agent: 'claude' },
  workspace: { type: 'project', slug }, visibility: 'internal', title, body: `${title} body.` });
appendOutboxEntry('project', slug, entry('Fixture fact one'));
fs.writeFileSync(path.join(profile, 'config/settings.json'), JSON.stringify({ setupCompleted: true, notionSyncEnabled: false, launchAtLogin: false, launchAtLoginConfigured: true, dropboxRoot: dropbox, dropboxFirmDataPath: 'shared', dropboxFirmDataMigrated: true }));
const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'ComSpec', 'PATH'].filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
Object.assign(env, { MI_USER_DATA_DIR: profile, NOTION_API_KEY: 'mi-test-disabled', CLAUDE_CODE_OAUTH_TOKEN: 'mi-test-disabled', ANTHROPIC_API_KEY: 'mi-test-disabled', OPENAI_API_KEY: 'mi-test-disabled', DROPBOX_ROOT: dropbox, DROPBOX_FIRM_DATA_PATH: 'shared' });

async function createFolder(page, name, label) {
  await page.goto(page.url().replace(/\/review.*$/, '/review'), { timeout: 180000 });
  const box = page.getByRole('checkbox', { name: 'Select Fixture fact one' });
  await box.waitFor({ timeout: 180000 });
  await box.check();
  await page.getByRole('combobox', { name: 'Destination for Review folder fixture' }).selectOption({ label: 'Choose folder…' });
  await page.getByRole('button', { name: 'New folder', exact: true }).click();
  await page.getByRole('textbox', { name: 'New folder name for Review folder fixture' }).fill('bad/name');
  await page.getByRole('button', { name: 'Create folder' }).click();
  await page.getByRole('alert').filter({ hasText: 'can’t contain' }).waitFor({ timeout: 30000 });
  await page.getByRole('textbox', { name: 'New folder name for Review folder fixture' }).fill(name);
  await page.getByRole('button', { name: 'Create folder' }).click();
  await page.getByText(`Created “${name}”.`).waitFor({ timeout: 30000 });
  assert(fs.statSync(path.join(projectFolder, name)).isDirectory(), `${label}: folder created`);
  if (label === 'desktop') await page.getByText(name, { exact: true }).waitFor({ timeout: 10000 });
  else assert.equal(await page.getByRole('textbox', { name: 'Folder for Review folder fixture' }).inputValue(), name);
  await page.getByRole('button', { name: 'Preview save' }).click();
  await page.getByText(`Projects/Review Folder Fixture/${name}/Mi Review Notes.md`).first().waitFor({ state: 'attached', timeout: 60000 });
  await page.screenshot({ path: path.join(root, `review-folder-${label}.png`) });
  assert.deepEqual(fs.readdirSync(path.join(projectFolder, name)), [], `${label}: preview writes nothing`);
  console.log(`PASS ${label}: New folder refuses an unsafe name, creates and selects the folder, and the preview targets it`);
}

let app, browser;
(async () => { try {
  const port = await new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const q = s.address().port; s.close(() => r(q)); }); });
  if (executable) env.PATH = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  app = await _electron.launch({ ...(executable ? { executablePath: executable, cwd: root } : {}), args: [...(executable ? [] : ['.']), `--user-data-dir=${profile}`], env: { ...env, STUDIO_ELECTRON_PORT: String(port) }, timeout: 120000 });
  for (const st of [app.process().stdout, app.process().stderr]) st?.on('data', (d) => fs.appendFileSync(path.join(root, 'server.log'), d));
  const page = await app.firstWindow({ timeout: 120000 }); await page.getByRole('navigation').first().waitFor({ timeout: 120000 });
  await page.goto(`http://127.0.0.1:${port}/review`, { timeout: 180000 });
  await createFolder(page, 'Review Notes', 'desktop');

  browser = await chromium.launch({ channel: 'msedge' });
  const tab = await (await browser.newContext()).newPage();
  await tab.goto(`http://127.0.0.1:${port}/review`, { timeout: 180000 });
  await createFolder(tab, 'Browser Notes', 'browser');
  console.log('Artifacts: ' + root);
} finally { if (browser) await browser.close(); if (app) await app.close(); } })().catch((e) => { console.error(e); console.log('Artifacts: ' + root); process.exitCode = 1; });
