/* eslint-disable @typescript-eslint/no-require-imports -- This Node harness loads fixture scaffolders through tsx/cjs. */
const { _electron, chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net');
const assert = require('node:assert/strict');
const yaml = require('js-yaml');
const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mi-plan-')));
// Run from the checkout with no other next dev process, or pass a packaged Mi.exe path.
const executable = process.argv[2] ? path.resolve(process.argv[2]) : null;
const profile = path.join(root, 'profile'), dropbox = path.join(root, 'dropbox');
const repo = executable ? path.join(profile, 'data') : process.cwd();
if (executable) process.env.MI_CONTENT_ROOT = repo;
fs.mkdirSync(path.join(profile, 'config'), { recursive: true }); fs.mkdirSync(path.join(dropbox, 'shared', 'leads'), { recursive: true });
process.env.DROPBOX_ROOT = dropbox; process.env.DROPBOX_FIRM_DATA_PATH = 'shared';
require('tsx/cjs');
const { scaffoldProject } = require('../lib/content/scaffoldProject.ts');
const stamp = Date.now().toString(36), slug = `mi-plan-${stamp}`;
scaffoldProject(slug, 'Plan fixture', { client: 'UI fixture', scopeLabels: ['Fixture'] });
const scheduleFile = path.join(repo, 'projects', slug, 'schedule', 'schedule.yaml');
const now = new Date(), month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const seed = () => { fs.mkdirSync(path.dirname(scheduleFile), { recursive: true }); fs.writeFileSync(scheduleFile, yaml.dump({ milestones: [
  { id: 'm1', name: 'Submit permit set', planned_date: `${month}-20`, actual_date: null, notion_event_id: null },
  { id: 'e1', name: 'Client Meeting - lobby', planned_date: `${month}-21`, actual_date: null, notion_event_id: null },
  { id: 'e2', name: 'Fixture Daily Block - gone from Notion', planned_date: `${month}-22`, actual_date: null, notion_event_id: '55555555-5555-5555-5555-555555555555' },
] })); };
seed();
const projectYaml = path.join(repo, 'projects', slug, 'project.yaml');
fs.writeFileSync(projectYaml, fs.readFileSync(projectYaml, 'utf8').replace(/^notion_page_id: .*$/m, 'notion_page_id: "3e966723-5a9b-81a7-a0c7-000000000000"'));
const read = () => yaml.load(fs.readFileSync(scheduleFile, 'utf8')).milestones;
fs.writeFileSync(path.join(profile, 'config/settings.json'), JSON.stringify({ setupCompleted: true, notionSyncEnabled: false, launchAtLogin: false, launchAtLoginConfigured: true, dropboxRoot: dropbox, dropboxFirmDataPath: 'shared', dropboxFirmDataMigrated: true }));
const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'ComSpec', 'PATH'].filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
Object.assign(env, { MI_USER_DATA_DIR: profile, NOTION_API_KEY: 'mi-test-disabled', CLAUDE_CODE_OAUTH_TOKEN: 'mi-test-disabled', ANTHROPIC_API_KEY: 'mi-test-disabled', OPENAI_API_KEY: 'mi-test-disabled', DROPBOX_ROOT: dropbox, DROPBOX_FIRM_DATA_PATH: 'shared' });
let app, browser;
const shot = (p, name) => p.screenshot({ path: path.join(root, `${name}.png`) });
const calendar = (p) => p.locator('section').filter({ has: p.getByRole('heading', { name: 'Calendar', exact: true }) });
async function inViewport(p, locator) {
  const box = await locator.boundingBox();
  const height = await p.evaluate(() => window.innerHeight);
  assert(box && box.y >= 0 && box.y + box.height <= height, `outside viewport: ${JSON.stringify(box)} of ${height}`);
}
async function run(p, label) {
  await p.getByRole('heading', { name: 'Calendar', exact: true }).waitFor({ timeout: 180000 });
  if (label === 'browser') await p.emulateMedia({ colorScheme: 'dark' });
  await p.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await p.evaluate(() => document.documentElement.setAttribute('data-mi-motion', 'cinematic'));
  const cal = calendar(p);
  for (const name of ['Submit permit set', 'Client Meeting - lobby', 'Fixture Daily Block - gone from Notion']) assert.equal(await cal.getByRole('button', { name }).count(), 1);
  await cal.getByRole('button', { name: 'Client meetings', exact: true }).click();
  assert.equal(await cal.getByRole('button', { name: 'Client Meeting - lobby' }).count(), 0);
  await cal.getByRole('button', { name: 'Client meetings', exact: true }).click();
  await shot(p, `${label}-month`);
  await p.locator('h2').first().click({ force: true }).catch(() => {});
  await p.keyboard.press('y');
  await cal.getByRole('region', { name: /^January/ }).waitFor({ timeout: 8000 }).catch(async (error) => {
    await p.screenshot({ path: path.join(root, `${label}-year-failed.png`) });
    console.log(await p.evaluate(() => ({ active: document.activeElement?.tagName, cls: document.activeElement?.className?.slice?.(0, 80), modal: document.querySelector("[aria-modal='true']")?.outerHTML?.slice(0, 300) })));
    throw error;
  });
  assert.equal(await cal.locator('section[aria-label$="' + now.getFullYear() + '"]').count(), 12);
  await shot(p, `${label}-year`);
  await cal.getByRole('button', { name: new RegExp(`^${month}-20`) }).click();
  await cal.getByText('All day').waitFor();
  assert.equal(await cal.getByText('7 AM').count(), 1);
  await shot(p, `${label}-day`);
  await p.keyboard.press('w');
  await cal.getByLabel(/^Add at 9 AM/).first().waitFor();
  await cal.getByLabel(/^Add at 9 AM/).first().click();
  const panel = p.getByRole('dialog', { name: 'Add to schedule' });
  await panel.waitFor();
  assert.equal(await panel.getByLabel('Time, optional').inputValue(), '09:00');
  await p.keyboard.press('Escape');
  await p.keyboard.press('m');
  await p.keyboard.press('c');
  await panel.waitFor();
  await inViewport(p, panel);
  await p.keyboard.type(`Hotkey ${label}`);
  await panel.getByLabel('Time, optional').fill('10:30');
  await shot(p, `${label}-quick-add`);
  await panel.getByRole('button', { name: 'Save to Mi' }).click();
  await panel.waitFor({ state: 'detached', timeout: 60000 });
  await cal.getByRole('button', { name: new RegExp(`Hotkey ${label}`) }).waitFor({ timeout: 60000 });
  assert(read().some((m) => m.name === `Hotkey ${label}` && m.type === 'Deadline' && m.start_time === '10:30'));
  console.log(`PASS ${label} calendar kinds, hotkeys, year, hours, timed quick add`);

  // Peek: category from the calendar, then complete.
  await cal.getByRole('button', { name: 'Client Meeting - lobby' }).click();
  const peek = p.getByRole('dialog', { name: 'Client Meeting - lobby' });
  await peek.waitFor();
  await shot(p, `${label}-peek`);
  const picker = peek.getByRole('group', { name: 'Category for Client Meeting - lobby' });
  assert.equal(await picker.getByRole('button', { name: 'Client meeting' }).getAttribute('aria-pressed'), 'true');
  await picker.getByRole('button', { name: 'Work session' }).click();
  await p.waitForFunction(() => document.querySelector('[role=status]')?.textContent?.includes('Work Session'), null, { timeout: 60000 });
  assert.equal(read().find((m) => m.id === 'e1').type, 'Work Session');
  await p.getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await p.getByRole('status').getByText('Category restored').waitFor({ timeout: 30000 });
  assert.equal(read().find((m) => m.id === 'e1').type, undefined);
  await picker.getByRole('button', { name: 'Work session' }).click();
  await p.waitForFunction(() => document.querySelector('[role=status]')?.textContent?.includes('Work Session'), null, { timeout: 60000 });
  await p.keyboard.press('Escape');
  await peek.waitFor({ state: 'detached' });

  // A linked item asks before changing Notion, and can stay in Mi.
  await cal.getByRole('button', { name: 'Fixture Daily Block - gone from Notion' }).click();
  const linked = p.getByRole('dialog', { name: 'Fixture Daily Block - gone from Notion' });
  await linked.getByRole('group', { name: /^Category for/ }).getByRole('button', { name: 'Milestone' }).click();
  const change = p.getByRole('dialog', { name: 'Confirm schedule change' });
  await change.getByText('in Mi and Notion').waitFor({ timeout: 15000 });
  await inViewport(p, change);
  await change.getByRole('button', { name: 'Save in Mi only' }).click();
  await change.waitFor({ state: 'detached', timeout: 30000 });
  assert.equal(read().find((m) => m.id === 'e2').type, 'Deadline');
  await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await linked.getByRole('group', { name: 'Milestone type' }).getByRole('button', { name: 'Kick-off' }).waitFor({ timeout: 15000 });
  await p.waitForTimeout(300);
  const chosen = linked.getByRole('group', { name: /^Category for/ });
  assert.equal(await chosen.getByRole('button', { name: 'Milestone' }).getAttribute('aria-pressed'), 'true');
  assert.equal(await chosen.getByRole('button', { name: 'Work session' }).getAttribute('aria-pressed'), 'false');
  await shot(p, `${label}-picker`);
  await p.keyboard.press('Escape');
  await linked.waitFor({ state: 'detached' });
  console.log(`PASS ${label} peek category`);

  // Mi-only moves save at once and can be undone.
  await p.keyboard.press('m');
  const status = p.getByRole('status');
  await cal.getByRole('button', { name: 'Submit permit set' }).dragTo(cal.getByLabel(`Add on ${month}-25`));
  await status.getByText('Moved to').waitFor({ timeout: 30000 });
  assert.equal(read().find((m) => m.id === 'm1').planned_date, `${month}-25`);
  assert.equal(await p.getByRole('dialog').count(), 0);
  await status.getByRole('button', { name: 'Undo' }).click();
  await status.getByText('Move undone').waitFor({ timeout: 30000 });
  assert.equal(read().find((m) => m.id === 'm1').planned_date, `${month}-20`);
  await p.waitForFunction((m) => document.querySelector(`[aria-label="Add on ${m}-20"]`)?.textContent?.includes('Submit permit set'), month, { timeout: 30000 });

  // The card edits the date and time.
  await cal.getByRole('button', { name: 'Submit permit set' }).click();
  const item = p.getByRole('dialog', { name: 'Submit permit set' });
  await item.getByLabel('Time, optional').fill('14:30');
  await item.getByRole('button', { name: 'Save' }).click();
  await status.getByText('at 14:30').waitFor({ timeout: 30000 });
  assert.equal(read().find((m) => m.id === 'm1').start_time, '14:30');

  // An hour sets the time.
  await p.keyboard.press('t');
  await p.keyboard.press('w');
  const hourly = cal.getByRole('button', { name: new RegExp(`Hotkey ${label}`) });
  await hourly.waitFor({ timeout: 10000 });
  const nine = cal.getByLabel(/^Add at 9 AM/).first();
  await nine.scrollIntoViewIfNeeded();
  await hourly.dragTo(nine);
  await status.getByText('at 09:00').waitFor({ timeout: 30000 });
  assert.equal(read().find((m) => m.name === `Hotkey ${label}`).start_time, '09:00');
  await p.keyboard.press('m');

  // A linked item asks first, and Cancel changes nothing.
  await cal.getByRole('button', { name: 'Fixture Daily Block - gone from Notion' }).dragTo(cal.getByLabel(`Add on ${month}-26`));
  const move = p.getByRole('dialog', { name: 'Confirm schedule change' });
  await move.getByText('keeping its length').waitFor({ timeout: 15000 });
  await inViewport(p, move);
  await move.getByRole('button', { name: 'Cancel' }).click();
  assert.equal(read().find((m) => m.id === 'e2').planned_date.slice(0, 7), month);
  assert.notEqual(read().find((m) => m.id === 'e2').planned_date, `${month}-26`);

  await p.keyboard.press('?');
  await p.getByRole('dialog', { name: 'Calendar shortcuts' }).waitFor();
  await p.keyboard.press('Escape');
  console.log(`PASS ${label} drag, Undo, card edit, hour drop, linked confirmation, shortcuts`);

  // A Mi-only item can go to Notion. The dummy key makes Notion refuse, so it stays Mi-only.
  await cal.getByRole('button', { name: 'Submit permit set' }).click();
  const unsentCard = p.getByRole('dialog', { name: 'Submit permit set' });
  await unsentCard.getByRole('button', { name: 'Send to Notion' }).click();
  const sendDialog = p.getByRole('dialog', { name: 'Confirm schedule change' });
  await sendDialog.getByText('will be added to STUDIO Schedule').waitFor({ timeout: 15000 });
  await inViewport(p, sendDialog);
  await sendDialog.getByRole('button', { name: 'Cancel' }).click();
  assert.equal(read().find((m) => m.id === 'm1').notion_event_id, null);
  await p.keyboard.press('Escape');
  await unsentCard.waitFor({ state: 'detached' });
  const bulk = p.getByRole('button', { name: /^Send \d+ Mi-only items? to Notion$/ });
  await bulk.click();
  await sendDialog.getByRole('button', { name: 'Confirm and apply' }).click();
  await sendDialog.waitFor({ state: 'detached', timeout: 60000 });
  await p.getByRole('status').getByText(/0 of \d+ sent to Notion/).waitFor({ timeout: 30000 });
  await p.getByRole('heading', { name: 'Notion apply report' }).waitFor({ timeout: 10000 });
  const after = read().find((m) => m.id === 'm1');
  assert.equal(after.notion_event_id, null);
  assert.notEqual(after.sync_key ?? null, 'send-m1', 'a refused or unreachable send');
  console.log(`PASS ${label} Send to Notion confirms, reports each item, and changes nothing on refusal`);

  // The dialog stays on screen deep in the page, and a deleted Notion row is explained.
  const card = p.locator('#milestone-e2');
  await card.scrollIntoViewIfNeeded();
  let calls = 0;
  await p.route('**/api/projects/*/schedule', async (route) => {
    if (route.request().method() === 'PATCH' && calls++ === 0) return route.fulfill({ status: 409, json: { error: 'notion-row-missing' } });
    return route.continue();
  });
  await card.getByRole('button', { name: 'Mark complete' }).click();
  const dialog = p.getByRole('dialog', { name: 'Confirm schedule change' });
  await dialog.waitFor();
  await inViewport(p, dialog);
  await dialog.getByRole('button', { name: 'Confirm and apply' }).click();
  await dialog.getByText('no longer exists in Notion').waitFor();
  await shot(p, `${label}-notion-missing`);
  assert.equal(read().find((m) => m.id === 'e2').actual_date, null);
  await dialog.getByRole('button', { name: 'Apply in Mi only' }).click();
  await dialog.waitFor({ state: 'detached', timeout: 15000 }).catch(async (error) => { console.log('DIALOG:', JSON.stringify(await dialog.innerText())); console.log('SCHEDULE:', JSON.stringify(read())); throw error; });
  assert(read().find((m) => m.id === 'e2').actual_date);
  await p.unroute('**/api/projects/*/schedule');
  console.log(`PASS ${label} dialog in viewport, Notion-missing recovery`);
}
(async () => { try {
  const port = await new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const q = s.address().port; s.close(() => r(q)); }); });
  const origin = `http://127.0.0.1:${port}`;
  if (executable) env.PATH = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  app = await _electron.launch({ ...(executable ? { executablePath: executable, cwd: root } : {}), args: [...(executable ? [] : ['.']), `--user-data-dir=${profile}`], env: { ...env, STUDIO_ELECTRON_PORT: String(port) }, timeout: 120000 });
  for (const st of [app.process().stdout, app.process().stderr]) st?.on('data', (d) => fs.appendFileSync(path.join(root, 'server.log'), d));
  const mock = (r) => r.fulfill({ json: { counts: { pending: 0, failed: 0 }, perWorkspace: [], announcements: [], scannedAt: Date.now() } });
  await app.context().route('**/api/review-inbox/count*', mock);
  const page = await app.firstWindow({ timeout: 120000 }); await page.getByRole('navigation').first().waitFor({ timeout: 120000 });
  await page.goto(`${origin}/projects/${slug}`, { timeout: 180000 });
  await page.getByRole('region', { name: 'Project in a minute' }).getByText('Next up').waitFor({ timeout: 180000 });
  await page.getByRole('region', { name: 'Project in a minute' }).getByRole('link', { name: 'Submit permit set' }).waitFor();
  await page.getByRole('heading', { name: 'Coming up' }).waitFor();
  await page.screenshot({ path: path.join(root, 'desktop-overview.png'), fullPage: true });
  console.log('PASS desktop overview focus');
  await page.goto(`${origin}/projects/${slug}/schedule`, { timeout: 180000 }); await run(page, 'desktop');
  // Knowledge shows the note, with Mi's bookkeeping behind Details.
  fs.mkdirSync(path.join(repo, 'projects', slug, 'memory'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'projects', slug, 'memory', 'notes.md'), ['---', "last_updated: '2026-11-01'", '---', '', '## fact note \u2014 2026-08-16 \u2014 Cafe has no cooking', '', '_Imported from the Mi review inbox and confirmed 2026-08-16 by Unnamed Mi user. Source: Mi/inbox/1.json (codex)_', '', 'The cafe is a serving counter.', '', '**Why it was recorded:** Scope.', ''].join('\n'));
  await page.goto(`${origin}/projects/${slug}/knowledge`, { timeout: 180000 });
  await page.getByText('The cafe is a serving counter.').waitFor({ timeout: 120000 });
  assert.equal(await page.getByText('Mi/inbox/1.json').isVisible(), false);
  await page.getByText('Details', { exact: true }).click();
  assert.equal(await page.getByText(/Mi\/inbox\/1\.json/).isVisible(), true);
  await shot(page, 'desktop-knowledge');
  console.log('PASS desktop knowledge summary and Details');
  seed();
  browser = await chromium.launch({ channel: 'msedge' }); const c = await browser.newContext({ viewport: { width: 1280, height: 800 } }); await c.route('**/api/review-inbox/count*', mock);
  const web = await c.newPage();
  await web.goto(`${origin}/projects/${slug}/schedule`, { timeout: 120000 });
  assert.equal(await web.evaluate(() => typeof window.electronAPI), 'undefined');
  await run(web, 'browser');
  console.log('Artifacts: ' + root);
} finally {
  if (browser) await browser.close(); if (app) await app.close();
  const src = path.resolve(repo, 'projects', slug), arch = path.resolve(executable ? root : repo, '.tmp', `plan-fixtures-${stamp}`);
  if (fs.existsSync(src)) { fs.mkdirSync(arch, { recursive: true }); fs.renameSync(src, path.join(arch, slug)); }
} })().catch((e) => { console.error(e); console.log('Artifacts: ' + root); process.exitCode = 1; });
