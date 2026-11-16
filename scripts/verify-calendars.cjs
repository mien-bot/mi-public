/* eslint-disable @typescript-eslint/no-require-imports -- This Node harness starts a packaged Mi with an owned schedule snapshot. */
const { _electron } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net');
const assert = require('node:assert/strict');
// Pass a packaged Mi.exe path. The snapshot is a fixture and Notion is unreachable by design.
const executable = path.resolve(process.argv[2] ?? 'dist-installer/win-unpacked/Mi.exe');
const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mi-calendars-')));
const profile = path.join(root, 'profile'), dropbox = path.join(root, 'dropbox'), data = path.join(profile, 'data');
fs.mkdirSync(path.join(profile, 'config'), { recursive: true });
fs.mkdirSync(path.join(data, 'notion'), { recursive: true });
fs.mkdirSync(path.join(dropbox, 'shared', 'leads'), { recursive: true });
fs.mkdirSync(path.join(dropbox, 'shared', 'permit-qaqc'), { recursive: true });
const now = new Date(), key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = key(now), later = key(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2));
const entry = (id, name, date, type, extra = {}) => ({ notion_page_id: `3c666723-5a9b-8000-8000-00000000000${id}`, name, date, date_end: null, start_time: null, end_time: null, last_edited_time: null, type, status: 'Not started', hours: null, attendees: [], project_page_ids: [], ...extra });
const snapshot = { schema_version: 3, generated_at: now.toISOString(), window: { from: `${now.getFullYear() - 1}-01-01`, to: `${now.getFullYear() + 1}-12-31` }, entries: [
  entry(1, 'Fixture deadline', later, ['Deadline']),
  entry(2, 'Fixture meeting', later, ['Meeting']),
  entry(3, 'Fixture session', later, ['Work Session']),
  entry(4, 'Fixture client meeting', later, ['Client Meeting']),
  entry(5, 'Fixture internal meeting', later, ['Internal Meeting']),
] };
fs.writeFileSync(path.join(data, 'notion', 'schedule-snapshot.json'), JSON.stringify(snapshot));
fs.writeFileSync(path.join(profile, 'config/settings.json'), JSON.stringify({ setupCompleted: true, notionSyncEnabled: false, launchAtLogin: false, launchAtLoginConfigured: true, dropboxRoot: dropbox, dropboxFirmDataPath: 'shared', dropboxFirmDataMigrated: true }));
const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'ComSpec'].filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
Object.assign(env, { PATH: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32'), MI_USER_DATA_DIR: profile, MI_CONTENT_ROOT: data, NOTION_API_KEY: 'mi-test-disabled', CLAUDE_CODE_OAUTH_TOKEN: 'mi-test-disabled', ANTHROPIC_API_KEY: 'mi-test-disabled', OPENAI_API_KEY: 'mi-test-disabled', DROPBOX_ROOT: dropbox, DROPBOX_FIRM_DATA_PATH: 'shared' });
let app;
(async () => { try {
  const port = await new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const q = s.address().port; s.close(() => r(q)); }); });
  app = await _electron.launch({ executablePath: executable, cwd: root, args: [`--user-data-dir=${profile}`], env: { ...env, STUDIO_ELECTRON_PORT: String(port) }, timeout: 120000 });
  const page = await app.firstWindow({ timeout: 120000 }); await page.getByRole('navigation').first().waitFor({ timeout: 120000 });
  await page.goto(`http://127.0.0.1:${port}/`, { timeout: 120000 });
  const add = page.getByRole('button', { name: /\+ Add event|Hide event form/ });
  await add.waitFor({ timeout: 120000 });
  await page.getByRole('button', { name: /Fixture deadline/ }).first().waitFor({ timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.locator('h1,h2,h3').filter({ hasText: /\d{4}/ }).first().click();

  // Kinds, more, and the card.
  await page.getByRole('button', { name: 'Work sessions' }).click();
  assert.equal(await page.getByRole('button', { name: /Fixture session/ }).count(), 0);
  await page.getByRole('button', { name: 'Work sessions' }).click();
  await page.getByRole('button', { name: /^\+\d+ more$/ }).first().click();
  await page.getByRole('button', { name: /Fixture internal meeting/ }).first().waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /Fixture deadline/ }).first().click();
  const card = page.getByRole('dialog', { name: 'Fixture deadline' });
  await card.getByRole('button', { name: 'Open in Notion' }).waitFor();
  assert.equal(await card.getByRole('button', { name: 'Save to Notion' }).count(), 0);
  await card.getByRole('group', { name: 'Category for Fixture deadline' }).getByRole('button', { name: 'Client meeting' }).click();
  await card.getByRole('button', { name: 'Save to Notion' }).click();
  await card.getByRole('alert').waitFor({ timeout: 30000 });
  await page.keyboard.press('Escape');
  await card.waitFor({ state: 'detached' });
  console.log('PASS Studio filters, +more opens the day, card opens in Mi');

  // Keys.
  const heading = () => page.locator('h3.text-center').first().textContent();
  await page.keyboard.press('m');
  await page.waitForTimeout(150);
  const month = await heading();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  assert.notEqual(await heading(), month);
  await page.keyboard.press('t');
  await page.waitForTimeout(150);
  assert.equal(await heading(), month);
  await page.keyboard.press('w');
  await page.keyboard.press('m');
  await page.waitForTimeout(150);
  await page.keyboard.press('?');
  await page.getByRole('dialog', { name: 'Calendar shortcuts' }).waitFor();
  await page.keyboard.press('Escape');
  await page.keyboard.press('c');
  await page.getByRole('button', { name: 'Hide event form' }).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: 'Hide event form' }).click();
  console.log('PASS Studio keys');

  // A drop asks on screen, and Cancel changes nothing.
  await page.mouse.wheel(0, 400);
  await page.getByRole('button', { name: /Fixture meeting/ }).first().dragTo(page.getByRole('button', { name: `Add event on ${today}` }).locator('xpath=ancestor::div[2]'));
  const confirm = page.getByRole('alertdialog', { name: 'Confirm calendar change' });
  await confirm.waitFor({ timeout: 10000 });
  const box = await confirm.boundingBox(), height = await page.evaluate(() => window.innerHeight);
  assert(box.y >= 0 && box.y + box.height <= height, `confirmation off screen ${JSON.stringify(box)}`);
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await confirm.waitFor({ state: 'detached' });
  console.log('PASS Studio drop confirmation stays on screen');

  // Personal.
  await page.goto(`http://127.0.0.1:${port}/personal`, { timeout: 120000 });
  const tab = page.getByRole('button', { name: /Calendar.*Time and sharing/ }).first();
  await tab.waitFor({ timeout: 60000 });
  await tab.click();
  await page.getByRole('heading', { name: 'Personal calendar' }).waitFor({ timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  const label = page.getByRole('heading', { name: 'Personal calendar' }).locator('xpath=ancestor::section[1]').locator('h3').first();
  const before = await label.textContent();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  assert.notEqual(await label.textContent(), before);
  await page.keyboard.press('t');
  await page.waitForTimeout(150);
  assert.equal(await label.textContent(), before);
  await page.keyboard.press('?');
  await page.getByRole('dialog', { name: 'Calendar shortcuts' }).waitFor();
  await page.keyboard.press('Escape');
  console.log('PASS Personal keys');
} finally { if (app) await app.close(); } })().catch((e) => { console.error(e); console.log('Artifacts: ' + root); process.exitCode = 1; });
