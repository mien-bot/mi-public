/* eslint-disable @typescript-eslint/no-require-imports -- This Node harness uses tsx/cjs to load fixture scaffolders without a separate build. */
const { _electron, chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const assert = require('node:assert/strict');
// Run from the checkout with no other next dev process. All writes use owned fixtures
// or a canonical temporary profile. Agent activity below is simulated; no model is called.
const executable = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!executable && fs.existsSync(path.join(process.cwd(), '.next', 'dev', 'lock'))) throw Error('Stop the existing next dev server before running the project overview regression.');
const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mi-project-overview-ui-')));
const repo = process.cwd();
const profile = path.join(root, 'profile');
const dropbox = path.join(root, 'dropbox');
const contentRoot = executable ? path.join(profile, 'data') : repo;
if (executable) process.env.MI_CONTENT_ROOT = contentRoot;
fs.mkdirSync(path.join(profile, 'config'), { recursive: true });
fs.mkdirSync(path.join(dropbox, 'shared', 'leads'), { recursive: true });
process.env.DROPBOX_ROOT = dropbox;
process.env.DROPBOX_FIRM_DATA_PATH = 'shared';
require('tsx/cjs');
const { scaffoldProject } = require('../lib/content/scaffoldProject.ts');

const stamp=Date.now().toString(36), slug=`mi-overview-${stamp}`;
scaffoldProject(slug,'A little studio project',{client:'UI fixture',scopeLabels:['Design a welcoming studio with a courtyard and flexible meeting rooms. '.repeat(8)]});
fs.mkdirSync(path.join(contentRoot,'projects',slug,'schedule'),{recursive:true});
fs.writeFileSync(path.join(contentRoot,'projects',slug,'schedule','schedule.yaml'),'milestones:\n  - id: sketch\n    name: Sketch the possibilities\n    planned_date: "2026-01-01"\n    actual_date: null\n  - id: courtyard\n    name: Review the courtyard\n    planned_date: "2027-03-01"\n    actual_date: null\n');
fs.writeFileSync(path.join(profile,'config/settings.json'),JSON.stringify({setupCompleted:true,notionSyncEnabled:false,launchAtLogin:false,launchAtLoginConfigured:true,dropboxRoot:dropbox,dropboxFirmDataPath:'shared',dropboxFirmDataMigrated:true}));
const env=Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP','APPDATA','LOCALAPPDATA','USERPROFILE','ComSpec','PATH'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
Object.assign(env,{MI_USER_DATA_DIR:profile,NOTION_API_KEY:'mi-test-disabled',CLAUDE_CODE_OAUTH_TOKEN:'mi-test-disabled',ANTHROPIC_API_KEY:'mi-test-disabled',OPENAI_API_KEY:'mi-test-disabled',DROPBOX_ROOT:dropbox,DROPBOX_FIRM_DATA_PATH:'shared'});
if (executable) env.PATH = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
let app,browser;
async function verify(page,label){
 await page.getByRole('region',{name:'Project in a minute',exact:true}).waitFor({timeout:120000});
 for(const name of ['Read full scope','Files & shared work','Project facts: fee, scope & connections','Milestone details & archive','Recent activity & project knowledge']){
  const summary=page.getByText(name,{exact:true});assert.equal(await summary.locator('..').getAttribute('open'),null);
  await summary.focus();await page.keyboard.press('Enter');assert.notEqual(await summary.locator('..').getAttribute('open'),null);
  await summary.click();
 }
 const trail=page.getByRole('region',{name:'Project milestone trail'});
 assert.equal(await trail.locator('li').count(),2);
 assert.equal(await trail.locator('li').first().getByRole('link').textContent(),'Sketch the possibilities');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
 await page.screenshot({path:path.join(root,`${label}.png`),fullPage:true});console.log('PASS '+label+' keyboard disclosures, milestone order, layout');
}
(async()=>{try{
 const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p));});});
 const origin=`http://127.0.0.1:${port}`;
 app=await _electron.launch({...(executable ? {executablePath:executable,cwd:root} : {}),args:[...(!executable ? ['.'] : []),`--user-data-dir=${profile}`],env:{...env,STUDIO_ELECTRON_PORT:String(port)},timeout:120000});
 for(const stream of [app.process().stdout,app.process().stderr])stream?.on('data',data=>fs.appendFileSync(path.join(root,'server.log'),data));
 const mock=route=>route.fulfill({json:{counts:{pending:0,failed:0},perWorkspace:[],announcements:[],scannedAt:Date.now()}});
 await app.context().route('**/api/review-inbox/count*',mock);
 const page=await app.firstWindow({timeout:120000});await page.getByRole('navigation').first().waitFor({timeout:120000});
 await page.goto(`${origin}/projects/${slug}`,{timeout:120000});await verify(page,'desktop');
 browser=await chromium.launch({channel:'msedge'});const context=await browser.newContext();await context.route('**/api/review-inbox/count*',mock);
 const web=await context.newPage();await web.setViewportSize({width:390,height:844});await web.emulateMedia({reducedMotion:'reduce',colorScheme:'dark'});
 await web.goto(`${origin}/projects/${slug}`,{timeout:120000});assert.equal(await web.evaluate(()=>typeof window.electronAPI),'undefined');await verify(web,'browser-mobile-dark');
 console.log('Artifacts: '+root);
}finally{
 if(browser)await browser.close();if(app)await app.close();
 if (!executable) {
 const source=path.resolve(repo,'projects',slug),archive=path.resolve(repo,'.tmp',`overview-fixtures-${stamp}`);
 if(!source.startsWith(path.resolve(repo,'projects')+path.sep)||!archive.startsWith(path.resolve(repo,'.tmp')+path.sep))throw Error('Unsafe archive paths');
 fs.mkdirSync(archive,{recursive:true});fs.renameSync(source,path.join(archive,slug));
 }
}})().catch(error=>{console.error(error);console.log('Artifacts: '+root);process.exitCode=1;});
