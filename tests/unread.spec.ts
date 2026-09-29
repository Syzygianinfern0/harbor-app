import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PROJECTS=[['app','Agent-Manager'],['api','tessera-api'],['paper','neurips-paper']] as const;
const CHATS=[['a1','app','Tab groups design'],['a2','app','Fix SSH reattach'],['a3','app','Release notes'],['b1','api','Rate limiter'],['b2','api','Flaky auth test'],['c1','paper','Rebuttal draft'],['c2','paper','Plot ablations']] as const;
async function fixture() {
  const dir=await mkdtemp(path.join(tmpdir(),'harbor-unread-'));const createdAt=new Date().toISOString();
  const projects=PROJECTS.map(([id,name])=>({id,name,cwd:dir,hostId:'local',hostLabel:'This Mac',connection:'local',createdAt}));
  const sessions=CHATS.map(([id,projectId,name],i)=>({id,tmuxName:`harbor-cccc${i}`,paneId:`%${i}`,name,host:'local',cwd:dir,launcher:'codex',group:'',tags:[],pinned:false,archived:false,createdAt,updatedAt:new Date(Date.now()-i*1000).toISOString(),status:'closed',projectId,hasMessages:true}));
  await writeFile(path.join(dir,'sessions.json'),JSON.stringify({version:2,projects,sessions}));
  // HARBOR_TEST_HOOKS exposes the engine so the spec can raise the same `attention` events the metadata poller emits.
  return {dir,launch:()=>electron.launch({executablePath:process.env.HARBOR_TEST_APP,args:process.env.HARBOR_TEST_APP?[]:['.'],env:{...process.env,HARBOR_DATA_DIR:dir,HARBOR_TMUX_SOCKET:`harbor-unread-${process.pid}`,HARBOR_TEST_HOOKS:'1'}})};
}
const openChat=(page:Page,name:string)=>page.locator('.sidebar .chat-row',{hasText:name}).click();
// Window focus is stubbed: other apps (and parallel test runs) own the real macOS focus.
const setFocused=(app:ElectronApplication,focused:boolean)=>app.evaluate(({app,BrowserWindow},focused)=>{const w=BrowserWindow.getAllWindows()[0];(w as any).isFocused=()=>focused;if(focused)app.emit('browser-window-focus',{},w);},focused);
const notify=(app:ElectronApplication,id:string,completed=false)=>app.evaluate(({},{id,completed})=>{const engine=(globalThis as any).harborTest.engine;const session=engine.snapshot().sessions.find((s:any)=>s.id===id);engine.emit('attention',{session,completed});},{id,completed});
const row=(page:Page,name:string)=>page.locator('.sidebar .chat-row',{hasText:name});
const badge=(app:ElectronApplication)=>app.evaluate(({app})=>app.dock?.getBadge()??'');

test('chats that raised a notification off screen are marked unread everywhere until viewed, and the mark persists',async()=>{
  const data=await fixture();let app=await data.launch();let page=await app.firstWindow();
  try {
    await mkdir('test-results/screenshots',{recursive:true});
    await setFocused(app,true);
    for(const name of ['Rate limiter','Fix SSH reattach','Tab groups design'])await openChat(page,name);
    await expect(page.locator('.tab.active')).toHaveAttribute('data-tab-id','a1');

    // The chat on screen in a focused window is never marked; the others are, including a finished turn.
    await notify(app,'a1');await notify(app,'b1');await notify(app,'a2',true);await notify(app,'c1');
    await expect(row(page,'Rate limiter').locator('.unread-dot')).toHaveCount(1);
    await expect(row(page,'Tab groups design').locator('.unread-dot')).toHaveCount(0);
    await expect(page.locator('[data-tab-id="b1"] .unread-dot')).toHaveCount(1);await expect(page.locator('[data-tab-id="a2"] .unread-dot')).toHaveCount(1);
    await expect(page.locator('[data-tab-id="a1"] .unread-dot')).toHaveCount(0);
    await expect(row(page,'Rate limiter').locator('.chat-title')).toHaveCSS('font-weight','600');
    await expect.poll(()=>badge(app)).toBe('3');
    await page.screenshot({path:'test-results/screenshots/70-unread-rows-tabs.png'});

    // "Notify when an agent finishes working" off: finished turns no longer mark; input requests still do, with desktop notifications off.
    const prefs=await page.evaluate(()=>window.harbor.snapshot().then(s=>s.preferences));expect(prefs.notifications.enabled).toBe(false);
    await page.evaluate(p=>window.harbor.savePreferences({...p,notifications:{...p.notifications,onComplete:false}}),prefs);
    await notify(app,'b2',true);await page.waitForTimeout(300);await expect(row(page,'Flaky auth test').locator('.unread-dot')).toHaveCount(0);

    // Folded tab group chip rolls up its unread chats.
    const api=page.getByRole('button',{name:/^tessera-api group/});await api.click();await expect(api).toHaveAttribute('aria-expanded','false');
    await expect(page.locator('[data-group-key="p:api"] .unread-dot.rollup')).toHaveAttribute('aria-label','1 unread chat');
    await page.locator('.session-toolbar').screenshot({path:'test-results/screenshots/71-unread-chip.png'});

    // Folded sidebar project, and the collapsed rail.
    await page.getByRole('button',{name:'Collapse project neurips-paper',exact:true}).click();
    await expect(page.locator('.project-heading',{hasText:'neurips-paper'}).locator('.unread-dot.rollup')).toHaveCount(1);
    await expect(page.locator('.project-heading',{hasText:'Agent-Manager'}).locator('.unread-dot')).toHaveCount(0);
    await page.locator('.sidebar').screenshot({path:'test-results/screenshots/72-unread-sidebar.png'});
    await page.getByRole('button',{name:'Collapse sidebar'}).click();
    await expect(page.getByRole('button',{name:'Open project neurips-paper'}).locator('.unread-dot')).toHaveCount(1);
    await expect(page.getByRole('button',{name:'Open project Agent-Manager'}).locator('.unread-dot')).toHaveCount(1);
    await page.locator('.sidebar-rail').screenshot({path:'test-results/screenshots/73-unread-rail.png'});
    await page.getByRole('button',{name:'Expand sidebar'}).click();

    // Shrunken (icon-only) tabs keep the dot.
    // Shrinking is on by default.
    for(const name of ['Release notes','Flaky auth test'])await openChat(page,name);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(950,700));
    await expect.poll(()=>page.locator('.tab.compact .unread-dot').count()).toBeGreaterThan(0);await expect(page.locator('.tab.compact .unread-dot').first()).toBeVisible();
    await page.screenshot({path:'test-results/screenshots/74-unread-shrunk-tabs.png'});

    // Groups overview: cards and the heading count.
    await page.getByRole('button',{name:'Tab groups',exact:true}).click();await page.getByRole('menuitem',{name:'Collapse all groups'}).click();
    const overview=page.locator('.groups-overview');await expect(overview).toBeVisible();
    await expect(overview.locator('.unread-text')).toHaveText('2 unread');
    await expect(overview.locator('.group-card',{hasText:'Rate limiter'}).locator('.group-card-title .unread-dot')).toHaveCount(1);
    await expect(overview.locator('.group-card-chat',{hasText:'Rate limiter'}).locator('.unread-dot')).toHaveCount(1);
    await page.screenshot({path:'test-results/screenshots/75-unread-overview.png'});

    // Opening a chat while Harbor is in the background does not read it; focusing the window does.
    await setFocused(app,false);await overview.locator('.group-card-chat',{hasText:'Rate limiter'}).click();
    await expect(page.locator('.tab.active')).toHaveAttribute('data-tab-id','b1');await page.waitForTimeout(300);
    await expect(row(page,'Rate limiter').locator('.unread-dot')).toHaveCount(1);
    await setFocused(app,true);await expect(row(page,'Rate limiter').locator('.unread-dot')).toHaveCount(0);
    await expect.poll(()=>badge(app)).toBe('2');

    // Clicking a desktop notification sends open-session: the chat opens and is read.
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('harbor:open-session','a2'));
    await expect(page.locator('.tab.active')).toHaveAttribute('data-tab-id','a2');await expect(page.locator('[data-tab-id="a2"] .unread-dot')).toHaveCount(0);

    // The mark is saved with the chat and survives a restart.
    await expect.poll(async()=>JSON.parse(await readFile(path.join(data.dir,'sessions.json'),'utf8')).sessions.filter((s:any)=>s.unread).map((s:any)=>s.id)).toEqual(['c1']);
    await app.close();app=await data.launch();page=await app.firstWindow();
    await page.getByRole('button',{name:'Expand project neurips-paper',exact:true}).click();
    await expect(row(page,'Rebuttal draft').locator('.unread-dot')).toHaveCount(1);await expect.poll(()=>badge(app)).toBe('1');
    await setFocused(app,true);await openChat(page,'Rebuttal draft');await expect(row(page,'Rebuttal draft').locator('.unread-dot')).toHaveCount(0);
    await expect.poll(()=>badge(app)).toBe('');
  } finally { await app.close(); }
});
