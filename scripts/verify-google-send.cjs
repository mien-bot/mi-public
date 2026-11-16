/* eslint-disable @typescript-eslint/no-require-imports -- This Node harness drives a packaged Mi against an in-process fake Google. */
const { _electron } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net');
const assert = require('node:assert/strict');
// Pass a packaged Mi.exe path. Google is replaced inside the main process, so nothing leaves this machine.
const executable = path.resolve(process.argv[2] ?? 'dist-installer/win-unpacked/Mi.exe');
const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mi-google-')));
const profile = path.join(root, 'profile'), dropbox = path.join(root, 'dropbox'), data = path.join(profile, 'data');
fs.mkdirSync(path.join(profile, 'config'), { recursive: true });
fs.mkdirSync(path.join(data, 'notion'), { recursive: true });
fs.mkdirSync(path.join(dropbox, 'shared', 'leads'), { recursive: true });
fs.mkdirSync(path.join(dropbox, 'shared', 'permit-qaqc'), { recursive: true });
const now = new Date(), key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const later = key(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2));
const entry = (id, name, type, projects = ['p1']) => ({ notion_page_id: `3c666723-5a9b-8000-8000-00000000000${id}`, name, date: later, date_end: null, start_time: null, end_time: null, last_edited_time: null, type, status: 'Not started', hours: null, attendees: [{ id: 'x', name: 'Someone' }], project_page_ids: projects });
fs.writeFileSync(path.join(data, 'notion', 'schedule-snapshot.json'), JSON.stringify({ schema_version: 3, generated_at: now.toISOString(), window: { from: `${now.getFullYear() - 1}-01-01`, to: `${now.getFullYear() + 1}-12-31` }, entries: [
  entry(1, 'Fixture deadline', ['Deadline']),
  entry(2, 'Fixture client meeting', ['Client Meeting']),
  entry(3, 'Fixture session', ['Work Session']),
  entry(4, 'Fixture dentist', ['Meeting'], []),
] }));
fs.writeFileSync(path.join(profile, 'config/settings.json'), JSON.stringify({ setupCompleted: true, notionSyncEnabled: false, launchAtLogin: false, launchAtLoginConfigured: true, dropboxRoot: dropbox, dropboxFirmDataPath: 'shared', dropboxFirmDataMigrated: true }));
const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'ComSpec'].filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
Object.assign(env, { PATH: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32'), MI_USER_DATA_DIR: profile, MI_CONTENT_ROOT: data, NOTION_API_KEY: 'mi-test-disabled', CLAUDE_CODE_OAUTH_TOKEN: 'mi-test-disabled', ANTHROPIC_API_KEY: 'mi-test-disabled', OPENAI_API_KEY: 'mi-test-disabled', DROPBOX_ROOT: dropbox, DROPBOX_FIRM_DATA_PATH: 'shared' });

function installFakeGoogle({ shell }, day) {
  const realFetch = globalThis.fetch;
  const human = { id: 'human', summary: 'Team lunch', start: { date: day }, end: { date: day }, htmlLink: 'https://calendar.google.com/x' };
  const fake = globalThis.__google = { events: new Map([['human', human]]), scopes: [], writes: [] };
  const json = (status, body) => new Response(status === 204 ? null : JSON.stringify(body ?? {}), { status, headers: { 'Content-Type': 'application/json' } });
  shell.openExternal = async (url) => {
    const auth = new URL(url);
    fake.scopes.push(auth.searchParams.get('scope'));
    const back = new URL(auth.searchParams.get('redirect_uri'));
    back.searchParams.set('code', 'code');
    back.searchParams.set('state', auth.searchParams.get('state'));
    setTimeout(() => realFetch(back).catch(() => {}), 20);
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.hostname === 'oauth2.googleapis.com') return json(200, { refresh_token: 'r', access_token: 'a', scope: fake.scopes.at(-1) });
    if (url.hostname !== 'www.googleapis.com') return realFetch(input, init);
    if (url.pathname.endsWith('/calendarList')) return json(200, { items: [{ id: 'shared', summary: 'STUDIO Shared', accessRole: 'writer' }] });
    const id = decodeURIComponent(url.pathname.split('/events/')[1] ?? '');
    const method = init.method ?? 'GET';
    if (method !== 'GET') fake.writes.push(`${method} ${id}`);
    if (method === 'GET' && !id) {
      const tagged = url.searchParams.get('privateExtendedProperty') === 'miManaged=1';
      return json(200, { items: [...fake.events.values()].filter((event) => !tagged || event.extendedProperties?.private?.miManaged === '1') });
    }
    if (method === 'GET') return fake.events.has(id) ? json(200, fake.events.get(id)) : json(404);
    if (method === 'POST') { const body = JSON.parse(init.body); if (fake.events.has(body.id)) return json(409); fake.events.set(body.id, body); return json(200, body); }
    if (method === 'PUT') { fake.events.set(id, { ...JSON.parse(init.body), id }); return json(200); }
    if (method === 'DELETE') { fake.events.delete(id); return json(204); }
    return json(400);
  };
}

let app;
(async () => { try {
  const port = await new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const q = s.address().port; s.close(() => r(q)); }); });
  app = await _electron.launch({ executablePath: executable, cwd: root, args: [`--user-data-dir=${profile}`], env: { ...env, STUDIO_ELECTRON_PORT: String(port) }, timeout: 120000 });
  await app.evaluate(installFakeGoogle, later);
  const google = () => app.evaluate(() => ({ events: [...globalThis.__google.events.values()], scopes: globalThis.__google.scopes, writes: globalThis.__google.writes }));
  const page = await app.firstWindow({ timeout: 120000 }); await page.getByRole('navigation').first().waitFor({ timeout: 120000 });
  await page.goto(`http://127.0.0.1:${port}/settings`, { timeout: 120000 });
  const panel = page.getByRole('region', { name: 'Google Calendar' });
  const openConnections = async () => {
    const tab = page.getByRole('tab', { name: /Connections/ }).or(page.getByRole('button', { name: /Connections.*Dropbox/ })).first();
    await tab.waitFor({ timeout: 120000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await tab.click();
    await panel.waitFor({ timeout: 60000 });
  };
  await openConnections();
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

  await panel.getByLabel('Client ID').fill('fixture-client');
  await panel.getByLabel('Client secret').fill('fixture-secret');
  await panel.getByRole('button', { name: 'Save client' }).click();
  await panel.getByRole('button', { name: 'Connect Google Calendar' }).click();
  await panel.getByLabel('Google calendar').selectOption('shared', { timeout: 30000 });
  await panel.getByRole('button', { name: 'Allow sending' }).waitFor({ timeout: 30000 });
  assert.equal(await panel.getByRole('button', { name: 'Preview send' }).count(), 0);
  let state = await google();
  assert(!state.scopes[0].includes('calendar.events'), 'viewing stays read-only');
  console.log('PASS connecting stays read-only until sending is allowed');

  await panel.getByRole('button', { name: 'Allow sending' }).click();
  await panel.getByRole('button', { name: 'Preview send' }).waitFor({ timeout: 30000 });
  assert((await google()).scopes[1].includes('calendar.events'));

  await panel.getByRole('button', { name: 'Preview send' }).click();
  const plan = panel.getByLabel('Google Calendar changes');
  await plan.waitFor({ timeout: 30000 });
  assert.equal(await plan.getByText('Fixture deadline').count(), 1);
  assert.equal(await plan.getByText('Fixture client meeting').count(), 1);
  assert.equal(await plan.getByText('Fixture session').count(), 0);
  assert.equal(await plan.getByText('Fixture dentist').count(), 0);
  assert.equal((await google()).writes.length, 0, 'a preview writes nothing');
  await plan.getByRole('button', { name: 'Confirm 2 changes' }).click();
  await panel.getByText('2 of 2 changes made in STUDIO Shared.').waitFor({ timeout: 30000 });
  state = await google();
  assert.equal(state.events.length, 3);
  assert(state.events.every((event) => !event.attendees), 'nobody is invited');
  console.log('PASS preview writes nothing, confirm sends only project milestones and meetings, no guests');

  await panel.getByRole('button', { name: 'Preview send' }).click();
  await panel.getByText('STUDIO Shared is up to date.').waitFor({ timeout: 30000 });
  await panel.getByRole('button', { name: 'Close' }).click();
  console.log('PASS a second send has nothing to do');

  await panel.getByRole('button', { name: 'Remove everything Mi added' }).click();
  await plan.getByRole('button', { name: 'Confirm 2 changes' }).waitFor({ timeout: 30000 });
  await app.evaluate(() => { const first = [...globalThis.__google.events.keys()].find((id) => id !== 'human'); globalThis.__google.events.delete(first); });
  await plan.getByRole('button', { name: 'Confirm 2 changes' }).click();
  await panel.getByText('changed since this preview').waitFor({ timeout: 30000 });
  assert.equal((await google()).events.length, 2);
  console.log('PASS a changed calendar stops a stale confirmation');

  // Studio shows Mi's copy once, and the person's own event.
  await page.goto(`http://127.0.0.1:${port}/`, { timeout: 120000 });
  await page.getByRole('button', { name: /^\+\d+ more$/ }).first().click({ timeout: 60000 });
  await page.getByRole('button', { name: /Team lunch/ }).first().waitFor({ timeout: 60000 });
  assert.equal(await page.getByRole('button', { name: /Fixture client meeting/ }).count(), 1);
  assert.equal(await page.getByRole('button', { name: /Fixture deadline/ }).count(), 1);
  console.log('PASS Studio shows the shared calendar with no doubles');

  await page.goto(`http://127.0.0.1:${port}/settings`, { timeout: 120000 });
  await openConnections();
  await panel.getByRole('button', { name: 'Remove everything Mi added' }).waitFor({ timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await panel.getByRole('button', { name: 'Remove everything Mi added' }).click();
  await plan.getByRole('button', { name: 'Confirm 1 change' }).click();
  await panel.getByText('1 of 1 change made').waitFor({ timeout: 30000 });
  state = await google();
  assert.deepEqual(state.events.map((event) => event.id), ['human']);
  assert(!state.writes.some((write) => write.endsWith(' human')), 'the person\'s event was never written');
  console.log('PASS remove clears only what Mi added');
} finally { if (app) await app.close(); } })().catch((e) => { console.error(e); console.log('Artifacts: ' + root); process.exitCode = 1; });
