import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Session, Snapshot } from '../src/shared/types';

// Attach/input are stubbed and snapshots are injected, so no tmux session is created or touched.
async function fixture() {
  const dir=await mkdtemp(path.join(tmpdir(),'harbor-terminal-status-'));const createdAt=new Date().toISOString();
  const project={id:'term',name:'Terminal test',cwd:dir,hostId:'local',hostLabel:'This Mac',connection:'local',createdAt};
  const base={host:'local',cwd:dir,group:'',tags:[],pinned:false,archived:false,createdAt,status:'closed',projectId:project.id};
  const sessions=[
    {...base,id:'a1',tmuxName:'harbor-aaaa0',paneId:'%0',name:'Agent chat',launcher:'codex',hasMessages:true,updatedAt:new Date(Date.now()-1000).toISOString()},
    {...base,id:'t1',tmuxName:'harbor-bbbb0',paneId:'%1',name:'Build shell',launcher:'shell',updatedAt:new Date().toISOString()},
    {...base,id:'t2',tmuxName:'harbor-bbbb1',paneId:'%2',name:'Old shell',launcher:'shell',updatedAt:new Date(Date.now()-2000).toISOString()},
  ];
  await writeFile(path.join(dir,'sessions.json'),JSON.stringify({version:2,projects:[project],sessions}));
  return electron.launch({executablePath:process.env.HARBOR_TEST_APP,args:process.env.HARBOR_TEST_APP?[]:['.'],env:{...process.env,HARBOR_DATA_DIR:dir,HARBOR_TMUX_SOCKET:`harbor-terminal-status-${process.pid}`,HARBOR_TEST_HOOKS:'1'}});
}
async function stub(app:ElectronApplication,page:Page) {
  await expect(page.locator('.sidebar .chat-row')).toHaveCount(1);
  await app.evaluate(({ipcMain})=>{for(const channel of ['attach','detach','resize','input'])ipcMain.removeHandler('harbor:'+channel),ipcMain.handle('harbor:'+channel,()=>{});});
  const snapshot=await page.evaluate(()=>window.harbor.snapshot());
  // From here on the renderer sees only the snapshots this spec pushes.
  await app.evaluate(({BrowserWindow},snapshot)=>{
    const contents=BrowserWindow.getAllWindows()[0].webContents;const send=contents.send.bind(contents);(globalThis as any).fake=snapshot;
    contents.send=(channel,...args)=>send(channel,...(channel==='harbor:snapshot-changed'?[(globalThis as any).fake]:args));
  },snapshot);
  return snapshot;
}
/** Pushes a snapshot with these session fields changed, as the engine's status poll would. */
const push=(app:ElectronApplication,snapshot:Snapshot,patch:Record<string,Partial<Session>>)=>app.evaluate(({BrowserWindow},next)=>{(globalThis as any).fake=next;BrowserWindow.getAllWindows()[0].webContents.send('harbor:snapshot-changed',next);},{...snapshot,sessions:snapshot.sessions.map(s=>({...s,...patch[s.id]}))});
const row=(page:Page,name:string)=>page.locator('.sidebar .chat-row',{hasText:name});

test('open terminals are listed and tabbed without a status, unread mark or notification, also after a host reconnects',async()=>{
  const app=await fixture();const page=await app.firstWindow();
  try {
    await mkdir('test-results/screenshots',{recursive:true});const snapshot=await stub(app,page);
    // Closed terminals are not listed; a running one is, with no status glyph even while its activity is unknown (as after a restart).
    await expect(row(page,'Build shell')).toHaveCount(0);
    await push(app,snapshot,{t1:{status:'running',activity:'unknown'},a1:{status:'running',activity:'unknown'}});
    await expect(row(page,'Build shell')).toHaveCount(1);await expect(row(page,'Old shell')).toHaveCount(0);
    await expect(row(page,'Build shell').locator('.chat-activity.no-status')).toHaveCount(1);
    await expect(row(page,'Build shell').getByRole('img')).toHaveCount(0);
    await expect(row(page,'Build shell')).toHaveAttribute('title',/^Terminal\n/);
    // Agent chats keep their status, including "Status unavailable".
    await expect(row(page,'Agent chat').getByRole('img',{name:'Status unavailable'})).toHaveCount(1);

    // Opening it adds a tab with the terminal icon and no status.
    await row(page,'Build shell').click();
    const tab=page.locator('[data-tab-id="t1"]');await expect(tab).toHaveClass(/active/);
    await expect(tab.locator('svg.lucide-terminal')).toHaveCount(1);await expect(tab.getByRole('img')).toHaveCount(0);
    await expect(row(page,'Build shell')).toHaveClass(/open-tab/);

    // A remote host dropping and coming back: unreachable, then running with stale activity. Still no "?".
    await push(app,snapshot,{t1:{status:'unreachable',activity:'unknown'},a1:{status:'unreachable',activity:'unknown'}});
    await expect(row(page,'Agent chat').getByRole('img',{name:'Status unavailable'})).toHaveCount(1);
    await expect(tab.getByRole('img')).toHaveCount(0);await expect(row(page,'Build shell').getByRole('img')).toHaveCount(0);
    await push(app,snapshot,{t1:{status:'running',activity:'unknown',unread:true},a1:{status:'running',activity:'attention'}});
    await expect(row(page,'Agent chat').getByRole('img',{name:'Needs input or approval'})).toHaveCount(1);
    await expect(tab.getByRole('img')).toHaveCount(0);await expect(tab.locator('.unread-dot')).toHaveCount(0);
    await expect(row(page,'Build shell').locator('.unread-dot')).toHaveCount(0);

    // The split picker offers open terminals too.
    await row(page,'Agent chat').click();await page.getByRole('button',{name:'Split view'}).click();
    await expect(page.locator('.split-picker button',{hasText:'Build shell'})).toHaveCount(1);
    await expect(page.locator('.split-picker button',{hasText:'Old shell'})).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.screenshot({path:'test-results/screenshots/80-terminal-tab-no-status.png'});

    // A terminal that exits stays listed while its tab is open.
    await push(app,snapshot,{t1:{status:'closed',activity:'closed'},a1:{status:'running',activity:'idle'}});
    await expect(row(page,'Build shell')).toHaveCount(1);await expect(row(page,'Build shell').getByRole('img')).toHaveCount(0);
  } finally { await app.close(); }
});

test('the engine raises no notification for a terminal',async()=>{
  const app=await fixture();const page=await app.firstWindow();
  try {
    await expect(page.locator('.sidebar .chat-row')).toHaveCount(1);
    // Even if an attention event reached the notifier for a terminal, it must not be marked unread.
    await app.evaluate(()=>{const engine=(globalThis as any).harborTest.engine;const session=engine.snapshot().sessions.find((s:any)=>s.id==='t1');engine.emit('attention',{session,completed:false});});
    await page.waitForTimeout(300);
    expect(await page.evaluate(()=>window.harbor.snapshot().then(s=>s.sessions.find(v=>v.id==='t1')?.unread))).toBeUndefined();
  } finally { await app.close(); }
});
