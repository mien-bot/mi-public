/* eslint-disable @typescript-eslint/no-require-imports -- This Node harness loads fixture scaffolders through tsx/cjs. */
const { _electron, chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net');
const assert = require('node:assert/strict');
const yaml = require('js-yaml');
const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mi-asks-')));
// Run from the checkout with no other next dev process, or pass a packaged Mi.exe path.
const executable = process.argv[2] ? path.resolve(process.argv[2]) : null;
const profile = path.join(root, 'profile'), dropbox = path.join(root, 'dropbox');
const repo = executable ? path.join(profile, 'data') : process.cwd();
if (executable) process.env.MI_CONTENT_ROOT = repo;
fs.mkdirSync(path.join(profile, 'config'), { recursive: true }); fs.mkdirSync(path.join(dropbox, 'shared', 'leads'), { recursive: true }); fs.mkdirSync(path.join(dropbox, 'shared', 'permit-qaqc'), { recursive: true });
process.env.DROPBOX_ROOT = dropbox; process.env.DROPBOX_FIRM_DATA_PATH = 'shared';
require('tsx/cjs');
const { scaffoldProject } = require('../lib/content/scaffoldProject.ts');
const stamp = Date.now().toString(36), slug = `mi-asks-${stamp}`;
scaffoldProject(slug, 'Asks fixture', { client: 'UI fixture', scopeLabels: ['Fixture'], status: 'in-progress' });
const file = path.join(repo, 'projects', slug, 'schedule', 'schedule.yaml');
const past = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
const seed = () => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, yaml.dump({ milestones: [
  { id: 'over', name: 'Submit permit set', planned_date: past(9), actual_date: null, notion_event_id: null },
  { id: 'linked', name: 'Client Meeting - gone', planned_date: past(8), actual_date: null, notion_event_id: '55555555-5555-5555-5555-555555555555' },
  { id: 'vague', name: 'Lobby stuff', planned_date: past(-30), actual_date: null, notion_event_id: null },
] })); };
seed();
// A replaced record and a finished project.
const oldSlug = `mi-replaced-${stamp}`, doneSlug = `mi-done-${stamp}`;
scaffoldProject(oldSlug, 'Replaced record', { client: 'UI fixture', scopeLabels: ['Fixture'], status: 'in-progress' });
scaffoldProject(doneSlug, 'Finished record', { client: 'UI fixture', scopeLabels: ['Fixture'] });
fs.appendFileSync(path.join(repo, 'projects', oldSlug, 'project.yaml'), `terminal_project_slug: ${slug}\n`);
const doneYaml = path.join(repo, 'projects', doneSlug, 'project.yaml');
fs.writeFileSync(doneYaml, fs.readFileSync(doneYaml, 'utf8').replace(/^status: .*$/m, 'status: complete'));
fs.mkdirSync(path.join(repo, 'projects', doneSlug, 'schedule'), { recursive: true });
fs.writeFileSync(path.join(repo, 'projects', doneSlug, 'schedule', 'schedule.yaml'), yaml.dump({ milestones: [{ id: 'd', name: 'Old deadline', planned_date: past(40), actual_date: null, notion_event_id: null }] }));
const read = (id) => yaml.load(fs.readFileSync(file, 'utf8')).milestones.find((m) => m.id === id);
fs.writeFileSync(path.join(profile, 'config/settings.json'), JSON.stringify({ setupCompleted: true, notionSyncEnabled: false, launchAtLogin: false, launchAtLoginConfigured: true, dropboxRoot: dropbox, dropboxFirmDataPath: 'shared', dropboxFirmDataMigrated: true }));
const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'ComSpec', 'PATH'].filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
Object.assign(env, { MI_USER_DATA_DIR: profile, NOTION_API_KEY: 'mi-test-disabled', CLAUDE_CODE_OAUTH_TOKEN: 'mi-test-disabled', ANTHROPIC_API_KEY: 'mi-test-disabled', OPENAI_API_KEY: 'mi-test-disabled', DROPBOX_ROOT: dropbox, DROPBOX_FIRM_DATA_PATH: 'shared' });
let app, browser;
async function run(p, label) {
  const asks = p.getByRole('region', { name: 'Questions from Mi' });
  await asks.getByText('Submit permit set').waitFor({ timeout: 180000 });
  assert.equal(await asks.locator('li').count(), 1);
  const focus = await p.getByText('Overdue', { exact: true }).boundingBox(), card = await asks.boundingBox();
  assert(focus.y < card.y, 'the next step comes before the question');
  await p.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await p.screenshot({ path: path.join(root, `${label}-asks.png`) });

  await asks.locator('li').filter({ hasText: 'Submit permit set' }).getByRole('button', { name: 'Yes, done' }).click();
  await asks.getByText('Submit permit set').waitFor({ state: 'detached', timeout: 60000 });
  assert(read('over').actual_date);

  let calls = 0;
  await p.route('**/api/projects/*/schedule', (route) => (route.request().method() === 'PATCH' && calls++ === 0 ? route.fulfill({ status: 409, json: { error: 'notion-row-missing' } }) : route.continue()));
  await asks.locator('li').filter({ hasText: 'Client Meeting - gone' }).getByRole('button', { name: 'Yes', exact: true }).click();
  await asks.getByRole('button', { name: 'Confirm', exact: true }).click();
  await asks.getByText('no longer exists in Notion').waitFor({ timeout: 60000 });
  assert.equal(read('linked').actual_date, null);
  await asks.getByRole('button', { name: 'Save in Mi only' }).click();
  await asks.locator('li').filter({ hasText: 'Client Meeting - gone' }).waitFor({ state: 'detached', timeout: 60000 });
  assert(read('linked').actual_date);
  await p.unroute('**/api/projects/*/schedule');

  await asks.locator('li').filter({ hasText: 'Lobby stuff' }).getByRole('button', { name: 'Work session' }).click();
  await asks.getByText('Lobby stuff').waitFor({ state: 'detached', timeout: 60000 });
  assert.equal(read('vague').type, 'Work Session');
  console.log(`PASS ${label} one-tap answers`);

  seed();
  await p.reload();
  await asks.getByText('Submit permit set').waitFor({ timeout: 120000 });
  await p.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await asks.getByRole('button', { name: 'Not now' }).click();
  await asks.getByText('Client Meeting - gone').first().waitFor({ timeout: 15000 });
  await p.reload();
  await asks.getByText('Client Meeting - gone').first().waitFor({ timeout: 120000 });
  assert.equal(await asks.getByText('Submit permit set').count(), 0);
  assert.equal(read('over').actual_date, null);
  console.log(`PASS ${label} Not now remembered, nothing written`);
}
(async () => { try {
  const port = await new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const q = s.address().port; s.close(() => r(q)); }); });
  const origin = `http://127.0.0.1:${port}`;
  if (executable) env.PATH = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  app = await _electron.launch({ ...(executable ? { executablePath: executable, cwd: root } : {}), args: [...(executable ? [] : ['.']), `--user-data-dir=${profile}`], env: { ...env, STUDIO_ELECTRON_PORT: String(port) }, timeout: 120000 });
  const mock = (r) => r.fulfill({ json: { counts: { pending: 0, failed: 0 }, perWorkspace: [], announcements: [], scannedAt: Date.now() } });
  await app.context().route('**/api/review-inbox/count*', mock);
  const page = await app.firstWindow({ timeout: 120000 }); await page.getByRole('navigation').first().waitFor({ timeout: 120000 });
  await page.goto(`${origin}/projects/${oldSlug}/knowledge`, { timeout: 180000 });
  await page.waitForURL(`${origin}/projects/${slug}`, { timeout: 60000 });
  await page.goto(`${origin}/projects`, { timeout: 180000 });
  await page.getByRole('link', { name: /Asks fixture/ }).first().waitFor({ timeout: 120000 });
  assert.equal(await page.getByText('Replaced record').count(), 0);
  console.log('PASS replaced project redirects and leaves the list');
  await page.goto(`${origin}/projects/${doneSlug}`, { timeout: 180000 });
  await page.getByRole('region', { name: 'Project in a minute' }).waitFor({ timeout: 120000 });
  assert.equal(await page.getByRole('region', { name: 'Questions from Mi' }).count(), 0);
  console.log('PASS finished project asks nothing');
  await page.goto(`${origin}/projects/${slug}`, { timeout: 180000 }); await run(page, 'desktop');
  seed();
  browser = await chromium.launch({ channel: 'msedge' }); const c = await browser.newContext({ viewport: { width: 390, height: 844 } }); await c.route('**/api/review-inbox/count*', mock);
  const web = await c.newPage();
  await web.goto(`${origin}/projects/${slug}`, { timeout: 120000 });
  assert.equal(await web.evaluate(() => typeof window.electronAPI), 'undefined');
  await run(web, 'browser');
  assert(await web.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  console.log('Artifacts: ' + root);
} finally {
  if (browser) await browser.close(); if (app) await app.close();
  const arch = path.resolve(executable ? root : repo, '.tmp', `asks-fixtures-${stamp}`);
  for (const owned of [slug, oldSlug, doneSlug]) {
    const src = path.resolve(repo, 'projects', owned);
    if (fs.existsSync(src)) { fs.mkdirSync(arch, { recursive: true }); fs.renameSync(src, path.join(arch, owned)); }
  }
} })().catch((e) => { console.error(e); console.log('Artifacts: ' + root); process.exitCode = 1; });
