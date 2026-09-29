import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// The engine's fork (launch arguments, real Claude/Codex) is covered by tests/fork.test.ts. Here fork/attach are stubbed in the
// main process, so no agent or tmux session starts; a private tmux socket keeps status polling away from the real server.
const CHATS=[['k1','claude','Design review','aaaaaaaa-0000-4000-8000-000000000001'],['k2','codex','API cleanup','aaaaaaaa-0000-4000-8000-000000000002'],['k3','claude','Fresh chat',undefined],['k4','codex','Release notes','aaaaaaaa-0000-4000-8000-000000000004']] as const;
async function fixture() {
  const dir=await mkdtemp(path.join(tmpdir(),'harbor-fork-e2e-'));const createdAt=new Date().toISOString();
  const project={id:'app',name:'Agent-Manager',cwd:dir,hostId:'local',hostLabel:'This Mac',connection:'local',createdAt};
  const sessions=CHATS.map(([id,launcher,name,conversationId],i)=>({id,tmuxName:`harbor-dddd${i}`,paneId:`%${i}`,name,host:'local',cwd:dir,launcher,group:'',tags:[],pinned:false,archived:false,createdAt,updatedAt:new Date(Date.now()-i*1000).toISOString(),status:'closed',projectId:project.id,...(conversationId?{conversationId,resumable:true,hasMessages:true}:{})}));
  await writeFile(path.join(dir,'sessions.json'),JSON.stringify({version:2,projects:[project],sessions}));
  return electron.launch({executablePath:process.env.HARBOR_TEST_APP,args:process.env.HARBOR_TEST_APP?[]:['.'],env:{...process.env,HARBOR_DATA_DIR:dir,HARBOR_TMUX_SOCKET:'harbor-fork-e2e-'+process.pid}});
}
async function stub(app:ElectronApplication,page:Page) {
  await expect(page.locator('.sidebar .chat-row')).toHaveCount(4);
  const snapshot=await page.evaluate(()=>window.harbor.snapshot());
  snapshot.sessions=snapshot.sessions.map(s=>({...s,status:'running',activity:s.id==='k3'?'starting':'idle'}));
  await app.evaluate(({BrowserWindow,ipcMain},snapshot)=>{
    const g=globalThis as any;g.snapshot=snapshot;g.forks=[];
    for(const channel of ['attach','detach','resize','input'])ipcMain.removeHandler('harbor:'+channel),ipcMain.handle('harbor:'+channel,()=>{});
    const contents=BrowserWindow.getAllWindows()[0].webContents;const send=contents.send.bind(contents);
    contents.send=(channel:string,...args:unknown[])=>send(channel,...(channel==='harbor:snapshot-changed'?[g.snapshot]:args));
    ipcMain.removeHandler('harbor:snapshot');ipcMain.handle('harbor:snapshot',()=>g.snapshot);
    ipcMain.removeHandler('harbor:fork');ipcMain.handle('harbor:fork',(_event,id:string)=>{
      g.forks.push(id);if(id==='k2')throw new Error('This chat is changing state. Fork it again in a moment.');
      const source=g.snapshot.sessions.find((s:any)=>s.id===id);const fork={...source,id:`f${g.forks.length}`,tmuxName:`harbor-eeee${g.forks.length}`,name:`${source.name} (fork)`,conversationId:undefined,forkedFrom:source.conversationId,resumable:false,activity:'starting',nameSource:'manual'};
      g.snapshot={...g.snapshot,sessions:[...g.snapshot.sessions,fork]};contents.send('harbor:snapshot-changed',g.snapshot);return fork;
    });
    contents.send('harbor:snapshot-changed',snapshot);
  },snapshot);
}
const tabOrder=(page:Page)=>page.locator('.session-toolbar [data-tab-id]').evaluateAll(e=>e.map(t=>(t as HTMLElement).dataset.tabId));
const panes=(page:Page)=>page.locator('.workspace-pane').evaluateAll(e=>e.map(p=>({id:(p as HTMLElement).dataset.sessionId,x:Math.round(p.getBoundingClientRect().x),y:Math.round(p.getBoundingClientRect().y),focused:p.classList.contains('focused')})));
const row=(page:Page,name:string)=>page.locator('.sidebar .chat-row',{hasText:name}).first();
const forkCalls=(app:ElectronApplication)=>app.evaluate(()=>(globalThis as any).forks as string[]);

test('Fork chat opens the fork beside its original: next tab, same group, split to the right',async()=>{
  const app=await fixture();const page=await app.firstWindow();
  try {
    await mkdir('test-results/screenshots',{recursive:true});await stub(app,page);
    await row(page,'Release notes').click();await row(page,'Design review').click();
    await expect.poll(()=>tabOrder(page)).toEqual(['k4','k1']);await expect.poll(()=>panes(page)).toEqual([expect.objectContaining({id:'k1'})]);
    // Sidebar row menu, original on screen: the fork's tab follows the original and it splits in to the right, focused.
    await row(page,'Design review').click({button:'right'});
    const item=page.getByRole('menuitem',{name:'Fork chat'});await expect(item).toHaveAttribute('aria-disabled','false');await expect(item).toHaveAttribute('title',/original stays as it is/);
    await page.screenshot({path:'test-results/screenshots/70-fork-menu.png'});await item.click();
    await expect.poll(()=>tabOrder(page)).toEqual(['k4','k1','f1']);
    await expect(page.locator('[data-tab-id="f1"]')).toContainText('Design review (fork)');
    await expect.poll(async()=>{const p=await panes(page);return p.map(v=>v.id).join()+(p.length===2&&p[1].x>p[0].x&&p[1].y===p[0].y&&p[1].focused?' right':'');}).toBe('k1,f1 right');
    await expect(row(page,'Design review (fork)')).toBeVisible();expect(await forkCalls(app)).toEqual(['k1']);
    await page.screenshot({path:'test-results/screenshots/71-fork-split.png'});
    // Tab menu, original not on screen: the original is shown with the fork split in to its right; the earlier split is parked.
    await page.locator('[data-tab-id="k4"]').click({button:'right'});await page.getByRole('menuitem',{name:'Fork chat'}).click();
    await expect.poll(()=>tabOrder(page)).toEqual(['k4','f2','k1','f1']);
    await expect.poll(async()=>(await panes(page)).map(p=>p.id)).toEqual(['k4','f2']);
    // Custom group: a fork from the chat actions menu joins the original's group.
    await page.locator('[data-tab-id="k1"]').click();await page.locator('[data-tab-id="k1"]').click({button:'right'});await page.getByRole('menuitem',{name:/New group with this tab/}).click();await page.keyboard.press('Escape');
    const group=async()=>{const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('harbor.tabGroups')||'{}'));return state.custom?.[0]?.members as string[]|undefined;};
    await expect.poll(group).toEqual(['k1']);
    await page.getByRole('button',{name:'Chat actions'}).click();await page.locator('.actions-menu').getByRole('menuitem',{name:'Fork chat'}).click();
    await expect.poll(group).toEqual(['k1','f3']);await expect.poll(()=>tabOrder(page)).toContain('f3');
    const order=await tabOrder(page);expect(order.indexOf('f3')).toBe(order.indexOf('k1')+1);
    await expect.poll(async()=>(await panes(page)).map(p=>p.id)).toContain('f3');
    await page.screenshot({path:'test-results/screenshots/72-fork-group.png'});
    // A chat without a saved conversation explains why it cannot be forked, and nothing is launched.
    await row(page,'Fresh chat').click({button:'right'});const blocked=page.getByRole('menuitem',{name:'Fork chat'});
    await expect(blocked).toHaveAttribute('aria-disabled','true');await expect(blocked).toHaveAttribute('title','This chat is still starting. Fork it once it is ready.');
    await page.screenshot({path:'test-results/screenshots/73-fork-blocked.png'});await blocked.click({force:true}); // aria-disabled keeps it clickable for the explanation.
    await expect(page.locator('.toast')).toContainText('still starting');expect(await forkCalls(app)).toEqual(['k1','k4','k1']);
    // Engine errors reach the user without the IPC prefix.
    await row(page,'API cleanup').click({button:'right'});await page.getByRole('menuitem',{name:'Fork chat'}).click();
    await expect(page.locator('.toast')).toHaveText(/^This chat is changing state\. Fork it again in a moment\./);
    expect(await forkCalls(app)).toEqual(['k1','k4','k1','k2']);
  } finally { await app.close(); }
});
