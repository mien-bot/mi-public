/* eslint-disable @typescript-eslint/no-require-imports -- This Node harness loads fixture scaffolders through tsx/cjs. */
const { _electron } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net');
const assert = require('node:assert/strict');
const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mi-term-')));
// Run from the checkout with no other next dev process, or pass a packaged Mi.exe path.
const executable = process.argv[2] ? path.resolve(process.argv[2]) : null;
const profile = path.join(root, 'profile'), dropbox = path.join(root, 'dropbox');
const repo = executable ? path.join(profile, 'data') : process.cwd();
if (executable) process.env.MI_CONTENT_ROOT = repo;
fs.mkdirSync(path.join(profile, 'config'), { recursive: true }); fs.mkdirSync(path.join(dropbox, 'shared', 'permit-qaqc'), { recursive: true }); fs.mkdirSync(path.join(dropbox, 'shared', 'leads'), { recursive: true });
process.env.DROPBOX_ROOT = dropbox; process.env.DROPBOX_FIRM_DATA_PATH = 'shared';
require('tsx/cjs');
const { scaffoldLead } = require('../lib/content/scaffoldLead.ts');
const { scaffoldProject } = require('../lib/content/scaffoldProject.ts');
scaffoldLead('fix-term', 'Terminal lead');
scaffoldProject('fix-term-meetings', 'Terminal meetings');
fs.writeFileSync(path.join(profile, 'config/settings.json'), JSON.stringify({ setupCompleted: true, notionSyncEnabled: false, launchAtLogin: false, launchAtLoginConfigured: true, dropboxRoot: dropbox, dropboxFirmDataPath: 'shared', dropboxFirmDataMigrated: true }));
const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'ComSpec', 'PATH'].filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
Object.assign(env, { MI_USER_DATA_DIR: profile, NOTION_API_KEY: 'mi-test-disabled', CLAUDE_CODE_OAUTH_TOKEN: 'mi-test-disabled', ANTHROPIC_API_KEY: 'mi-test-disabled', OPENAI_API_KEY: 'mi-test-disabled', DROPBOX_ROOT: dropbox, DROPBOX_FIRM_DATA_PATH: 'shared' });
let app;
const atBottom = (p) => p.evaluate(() => { const text = document.querySelector('.xterm-rows').innerText; return { bottom: text.includes('line 300'), tail: text.slice(-80) }; });
(async () => { try {
  const port = await new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const q = s.address().port; s.close(() => r(q)); }); });
  if (executable) env.PATH = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  app = await _electron.launch({ ...(executable ? { executablePath: executable, cwd: root } : {}), args: [...(executable ? [] : ['.']), `--user-data-dir=${profile}`], env: { ...env, STUDIO_ELECTRON_PORT: String(port) }, timeout: 120000 });
  for (const st of [app.process().stdout, app.process().stderr]) st?.on('data', (d) => fs.appendFileSync(path.join(root, 'server.log'), d));
  const page = await app.firstWindow({ timeout: 120000 }); await page.getByRole('navigation').first().waitFor({ timeout: 120000 });
  await page.goto(`http://127.0.0.1:${port}/leads/fix-term/terminal`, { timeout: 180000 });
  const handle = page.getByRole('separator', { name: 'Terminal height' });
  await handle.waitFor({ timeout: 180000 });
  await page.locator('.xterm-helper-textarea').waitFor({ state: 'attached', timeout: 60000 });
  await page.waitForTimeout(4000);

  // Drag.
  await handle.scrollIntoViewIfNeeded();
  const before = await page.locator('.mi-terminal-surface').boundingBox();
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 150, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const after = await page.locator('.mi-terminal-surface').boundingBox();
  assert(Math.abs(before.height - after.height - 158) < 12, `height ${before.height} -> ${after.height}`);
  const saved = await page.evaluate(() => localStorage.getItem('mi:terminal-height'));
  assert(saved, 'height remembered');
  console.log(`PASS drag ${Math.round(before.height)} -> ${Math.round(after.height)}, saved ${saved}`);
  await page.reload(); await handle.waitFor({ timeout: 120000 }); await page.locator('.xterm-helper-textarea').waitFor({ state: 'attached', timeout: 60000 }); await page.waitForTimeout(3000);
  assert.equal(await handle.getAttribute('aria-valuenow'), saved);
  console.log('PASS height survives reload');

  // Output, scroll up, then bottom button.
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('for /L %i in (1,1,300) do @echo line %i\n');
  await page.waitForTimeout(2500);
  let state = await atBottom(page);
  assert(state.bottom, `output ${JSON.stringify(state)}`);
  await page.locator('.mi-terminal-surface').scrollIntoViewIfNeeded();
  const surface = await page.locator('.mi-terminal-surface').boundingBox();
  await page.mouse.move(surface.x + 200, surface.y + 100);
  await page.mouse.wheel(0, -1500);
  await page.waitForTimeout(500);
  state = await atBottom(page);
  assert(!state.bottom, `scrolled up ${JSON.stringify(state)}`);
  await page.getByRole('button', { name: 'Go to bottom' }).click();
  await page.waitForTimeout(400);
  assert((await atBottom(page)).bottom);
  await page.screenshot({ path: path.join(root, 'terminal.png') });
  console.log('PASS go to bottom');

  // Minimize, restore, and resize with auto-follow on.
  for (const round of [1, 2, 3]) {
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((w) => w.isVisible())?.minimize(); });
    await page.waitForTimeout(900);
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.restore(); w.focus(); });
    await page.waitForTimeout(900);
    state = await atBottom(page);
    assert(state.bottom, `round ${round} ${JSON.stringify(state)}`);
  }
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(900, 500); });
  await page.waitForTimeout(800);
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1500, 950); });
  await page.waitForTimeout(800);
  assert((await atBottom(page)).bottom, 'after resize');
  assert.equal(await page.getByRole('button', { name: 'Auto-follow on' }).count(), 1);
  console.log('PASS stays at bottom after minimize, restore, resize; auto-follow stays on');

  // The rows fill whole cells, so the viewport behind them shows through below the last row.
  await page.goto(`http://127.0.0.1:${port}/projects/fix-term-meetings/terminal`, { timeout: 180000 });
  const meetings = page.getByRole('button', { name: 'Send to Meetings' });
  await meetings.waitFor({ timeout: 180000 });
  await page.locator('.xterm-helper-textarea').waitFor({ state: 'attached', timeout: 60000 });
  await page.waitForTimeout(3000);
  const problems = [];
  for (const theme of ['dark', 'light']) {
    await page.evaluate((value) => document.documentElement.setAttribute('data-mi-theme', value), theme);
    await page.waitForTimeout(400);
    const colors = await page.evaluate(() => {
      const viewport = document.querySelector('.xterm-viewport'), rows = document.querySelector('.xterm-scrollable-element');
      return { viewport: getComputedStyle(viewport).backgroundColor, rows: getComputedStyle(rows).backgroundColor, leftover: viewport.getBoundingClientRect().bottom - rows.getBoundingClientRect().bottom };
    });
    if (colors.viewport !== colors.rows) problems.push(`${theme} leftover strip ${JSON.stringify(colors)}`);
    await page.screenshot({ path: path.join(root, `terminal-${theme}.png`) });
  }
  await page.evaluate(() => document.documentElement.setAttribute('data-mi-theme', 'dark'));
  console.log(problems.length ? 'FAIL leftover strip colour' : 'PASS leftover strip matches the terminal in both themes');

  // A toolbar click must hand the keyboard back: Enter submits, it never clicks the button again.
  const promptCopies = () => page.evaluate(() => (document.querySelector('.xterm-rows').innerText.replace(/\s+/g, '').match(/Filethissession/g) ?? []).length);
  const terminalFocused = () => page.evaluate(() => document.activeElement?.classList.contains('xterm-helper-textarea') ?? false);
  await meetings.click();
  await page.waitForTimeout(500);
  if (!await terminalFocused()) problems.push('keyboard focus stayed on Send to Meetings');
  await meetings.click();
  await page.waitForTimeout(500);
  if (await promptCopies() !== 1) problems.push(`second click typed again: ${await promptCopies()} copies`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  if (await promptCopies() !== 1) problems.push(`Enter retyped the request: ${await promptCopies()} copies`);
  // cmd says "not recognized", unless a PATH entry such as Git's file.exe runs instead.
  if (!/not recognized|cannot open/.test(await page.locator('.xterm-rows').innerText())) problems.push('Enter did not reach the shell');
  await meetings.click();
  await page.waitForTimeout(500);
  if (await promptCopies() !== 2) problems.push(`button unavailable after submitting: ${await promptCopies()} copies`);
  await page.getByRole('button', { name: 'Paste', exact: true }).click();
  await page.waitForTimeout(300);
  if (!await terminalFocused()) problems.push('keyboard focus stayed on Paste');
  await page.getByRole('button', { name: 'Increase terminal text size' }).click();
  await page.waitForTimeout(300);
  if (!await terminalFocused()) problems.push('keyboard focus stayed on text size');
  await page.screenshot({ path: path.join(root, 'terminal-meetings.png') });
  assert.deepEqual(problems, []);
  console.log('PASS toolbar clicks return the keyboard; Send to Meetings types once per message');

  // Copy text drops the indent an agent puts in front of its reply; Copy keeps it.
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.press('Escape'); // clears what the steps above left on the input line
  await page.keyboard.type('cls\n');
  await page.waitForTimeout(800);
  await page.keyboard.type('echo   Hello Sarah,& echo   Thanks for the drawings.\n');
  await page.waitForTimeout(1200);
  const rowBox = (start) => page.evaluate((prefix) => {
    const row = [...document.querySelectorAll('.xterm-rows > div')].find((r) => r.textContent.trim().startsWith(prefix));
    const box = row?.getBoundingClientRect();
    return box && { x: box.x, y: box.y, height: box.height, width: box.width };
  }, start);
  const first = await rowBox('Hello Sarah,'), second = await rowBox('Thanks for the drawings.');
  assert(first && second, 'echoed rows visible');
  await page.mouse.move(first.x + 1, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(second.x + second.width * 0.6, second.y + second.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const clipboardText = () => app.evaluate(({ clipboard }) => clipboard.readText());
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await page.waitForTimeout(300);
  const raw = (await clipboardText()).replace(/\r\n/g, '\n');
  await page.getByRole('button', { name: 'Copy text', exact: true }).click();
  await page.waitForTimeout(300);
  const plain = (await clipboardText()).replace(/\r\n/g, '\n');
  assert.equal(plain, 'Hello Sarah,\nThanks for the drawings.', `Copy text gave ${JSON.stringify(plain)}`);
  assert(raw.startsWith('  Hello Sarah,\n  Thanks'), `Copy gave ${JSON.stringify(raw)}`);
  await page.screenshot({ path: path.join(root, 'terminal-copy-text.png') });
  console.log('PASS Copy text removes the indent; Copy keeps the selection as shown');
  console.log('Artifacts: ' + root);
} finally { if (app) await app.close(); } })().catch((e) => { console.error(e); console.log('Artifacts: ' + root); process.exitCode = 1; });
