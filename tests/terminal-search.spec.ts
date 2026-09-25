import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Attach/input are stubbed and output is injected, so no tmux session is created or touched.
async function fixture() {
  const dir=await mkdtemp(path.join(tmpdir(),'harbor-terminal-search-'));const createdAt=new Date().toISOString();
  const project={id:'find',name:'Find test',cwd:dir,hostId:'local',hostLabel:'This Mac',connection:'local',createdAt};
  const sessions=[['f1','Search logs'],['f2','Other pane']].map(([id,name],i)=>({id,tmuxName:`harbor-cccc${i}`,paneId:`%${i}`,name,host:'local',cwd:dir,launcher:'codex',group:'',tags:[],pinned:false,archived:false,createdAt,updatedAt:new Date(Date.now()-i*1000).toISOString(),status:'closed',projectId:project.id,hasMessages:true}));
  await writeFile(path.join(dir,'sessions.json'),JSON.stringify({version:2,projects:[project],sessions}));
  return electron.launch({executablePath:process.env.HARBOR_TEST_APP,args:process.env.HARBOR_TEST_APP?[]:['.'],env:{...process.env,HARBOR_DATA_DIR:dir}});
}
async function stub(app:ElectronApplication,page:Page) {
  await expect(page.locator('.sidebar .chat-row')).toHaveCount(2);
  await app.evaluate(({ipcMain})=>{
    for(const channel of ['attach','detach','resize'])ipcMain.removeHandler('harbor:'+channel),ipcMain.handle('harbor:'+channel,()=>{});
    (globalThis as any).typed=[];ipcMain.removeHandler('harbor:input');ipcMain.handle('harbor:input',(_e,_id,data)=>{(globalThis as any).typed.push(data);});
  });
  const snapshot=await page.evaluate(()=>window.harbor.snapshot());snapshot.sessions=snapshot.sessions.map(s=>({...s,status:'running'}));
  await app.evaluate(({BrowserWindow},snapshot)=>{
    const contents=BrowserWindow.getAllWindows()[0].webContents;const send=contents.send.bind(contents);
    contents.send=(channel,...args)=>send(channel,...(channel==='harbor:snapshot-changed'?[snapshot]:args));contents.send('harbor:snapshot-changed',snapshot);
  },snapshot);
}
const output=(app:ElectronApplication,id:string,text:string)=>app.evaluate(({BrowserWindow},[id,text])=>BrowserWindow.getAllWindows()[0].webContents.send('harbor:terminal',{id,type:'data',data:Buffer.from(text).toString('base64')}),[id,text]);
async function split(page:Page,source:string,target:string,side:string) {
  const transfer=await page.evaluateHandle(()=>new DataTransfer());
  await page.locator(`[data-tab-id="${source}"]`).dispatchEvent('dragstart',{dataTransfer:transfer});
  const zone=page.locator(`[data-session-id="${target}"] [data-drop-side="${side}"]`);
  await expect(zone).toBeVisible();await zone.dispatchEvent('dragover',{dataTransfer:transfer});await zone.dispatchEvent('drop',{dataTransfer:transfer});
  await transfer.dispose();
}

test('Command-F finds text in a terminal and its scrollback, one pane at a time',async()=>{
  const app=await fixture();const page=await app.firstWindow();
  try {
    await mkdir('test-results/screenshots',{recursive:true});await stub(app,page);
    await page.locator('.sidebar .chat-row',{hasText:'Search logs'}).click();
    await expect(page.locator('.connection-label')).toHaveText('Connected');
    const lines=Array.from({length:400},(_,i)=>i===0?'ancient-marker: the first line, deep in scrollback':i%40===5||(i>390&&i%3===2)?`step ${i}: needle found here`:`step ${i}: routine output`);
    await output(app,'f1',lines.join('\r\n')+'\r\n› ');
    const pane=page.locator('[data-session-id="f1"]');const textarea=pane.locator('.xterm-helper-textarea');
    await expect(pane.locator('.xterm-rows')).toContainText('step 399');await expect(textarea).toBeFocused();

    // ⌘F from the terminal opens the pane's find bar instead of the sidebar search, and xterm sends nothing.
    await page.keyboard.press('Meta+f');
    const find=pane.getByRole('textbox',{name:'Find in terminal'});await expect(find).toBeFocused();
    await expect(page.getByRole('textbox',{name:'Search chats'})).not.toBeFocused();
    const count=pane.locator('.terminal-find-count');
    await find.fill('needle');await expect(count).toHaveText('13 of 13');
    await expect(pane.locator('.xterm-find-result-decoration').first()).toBeAttached();
    // The current match is outlined in mint (the addon's active class is not reliably applied on first render).
    await expect(pane.locator('.xterm-find-result-decoration[style*="rgb(140, 224, 191)"]')).toHaveCount(1);
    await page.screenshot({path:'test-results/screenshots/40-terminal-find.png'});
    await page.keyboard.press('Enter');await expect(count).toHaveText('12 of 13');
    await page.keyboard.press('Enter');await expect(count).toHaveText('11 of 13');
    await page.keyboard.press('Shift+Enter');await expect(count).toHaveText('12 of 13');
    await pane.getByRole('button',{name:'Newer match'}).click();await expect(count).toHaveText('13 of 13');await expect(find).toBeFocused();
    await pane.getByRole('button',{name:'Newer match'}).click();await expect(count).toHaveText('1 of 13');

    // Scrollback: the first line scrolls into view.
    await find.fill('ancient-marker');await expect(count).toHaveText('1 of 1');
    await expect(pane.locator('.xterm-rows')).toContainText('ancient-marker');await expect(pane.locator('.xterm-rows')).not.toContainText('step 399');
    await find.fill('no such text');await expect(count).toHaveText('No results');await expect(find).toHaveClass(/no-results/);
    await expect(pane.getByRole('button',{name:'Older match'})).toBeDisabled();
    await page.screenshot({path:'test-results/screenshots/41-terminal-find-none.png'});

    // Esc closes, clears highlights and returns focus to the terminal; ⌘F again restores the query, selected.
    await find.fill('needle');await expect(count).toHaveText('13 of 13');
    await page.keyboard.press('Escape');await expect(pane.locator('.terminal-find')).toHaveCount(0);
    await expect(textarea).toBeFocused();await expect(pane.locator('.xterm-find-result-decoration')).toHaveCount(0);
    await page.keyboard.press('Meta+f');await expect(find).toBeFocused();await expect(find).toHaveValue('needle');
    expect(await find.evaluate((e:HTMLInputElement)=>[e.selectionStart,e.selectionEnd])).toEqual([0,6]);
    await expect(count).toHaveText('13 of 13');
    // ⌘F inside the bar reselects rather than reaching App; ⌘G stays a tab-group shortcut (not intercepted here).
    await page.keyboard.press('Meta+f');await expect(find).toBeFocused();
    await page.keyboard.press('Escape');await expect(textarea).toBeFocused();
    expect(await app.evaluate(()=>(globalThis as any).typed)).toEqual([]);

    // Another text field keeps its own ⌘F: the sidebar search takes it and no find bar opens.
    await page.getByRole('textbox',{name:'Search chats'}).focus();await page.keyboard.press('Meta+f');
    await expect(page.getByRole('textbox',{name:'Search chats'})).toBeFocused();await expect(page.locator('.terminal-find')).toHaveCount(0);

    // Split panes: only the focused pane's bar opens, and each searches its own buffer.
    await page.locator('.sidebar .chat-row',{hasText:'Other pane'}).click();
    await expect(page.locator('[data-session-id="f2"] .connection-label')).toHaveText('Connected');
    await split(page,'f1','f2','left');await expect(page.locator('.connection-label')).toHaveText(['Connected','Connected']);
    await output(app,'f2','other pane output\r\nneedle once\r\n› ');
    const other=page.locator('[data-session-id="f2"]');
    await other.locator('.xterm-screen').click();await expect(other.locator('.xterm-helper-textarea')).toBeFocused();
    await page.keyboard.press('Meta+f');
    await expect(page.locator('.terminal-find')).toHaveCount(1);await expect(other.locator('.terminal-find')).toHaveCount(1);
    await other.getByRole('textbox',{name:'Find in terminal'}).fill('needle');await expect(other.locator('.terminal-find-count')).toHaveText('1 of 1');
    await expect(pane.locator('.xterm-find-result-decoration')).toHaveCount(0);
    await page.screenshot({path:'test-results/screenshots/42-terminal-find-split.png'});
    await page.keyboard.press('Escape');await expect(other.locator('.xterm-helper-textarea')).toBeFocused();
    expect(await app.evaluate(()=>(globalThis as any).typed)).toEqual([]);
  } finally { await app.close(); }
});
