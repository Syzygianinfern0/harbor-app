import { test, expect, _electron as electron, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Transport } from '../src/engine/transport';

const PROJECTS=[['app','Agent-Manager'],['api','tessera-api']] as const;
const CHATS=[['a1','app','Tab groups design'],['a2','app','Fix SSH reattach'],['b1','api','Rate limiter']] as const;
// A private tmux server per run: never the user's `-L harbor` chats.
const socket=`harbor-settings-${randomBytes(4).toString('hex')}`;const transport=new Transport(socket);
async function fixture(chats=true) {
  const dir=await mkdtemp(path.join(tmpdir(),'harbor-settings-'));const createdAt=new Date().toISOString();
  const projects=PROJECTS.map(([id,name])=>({id,name,cwd:dir,hostId:'local',hostLabel:'This Mac',connection:'local',createdAt}));
  const sessions=chats?CHATS.map(([id,projectId,name],i)=>({id,tmuxName:`harbor-bbbb${i}`,paneId:`%${i}`,name,host:'local',cwd:dir,launcher:'codex',group:'',tags:[],pinned:false,archived:false,createdAt,updatedAt:new Date(Date.now()-i*1000).toISOString(),status:'closed',projectId,hasMessages:true})):[];
  await writeFile(path.join(dir,'sessions.json'),JSON.stringify({version:2,projects,sessions}));
  return {dir,launch:(env:Record<string,string>={})=>electron.launch({executablePath:process.env.HARBOR_TEST_APP,args:process.env.HARBOR_TEST_APP?[]:['.'],env:{...process.env,HARBOR_DATA_DIR:dir,HARBOR_TMUX_SOCKET:socket,...env}})};
}
const openChat=(page:Page,name:string)=>page.locator('.sidebar .chat-row',{hasText:name}).click();
const settingsTab=(page:Page)=>page.locator('.session-toolbar [data-tab-id="settings"]');
const activeTab=(page:Page)=>page.locator('.session-toolbar .tab.active').evaluateAll(tabs=>tabs.map(t=>(t as HTMLElement).dataset.tabId));
const tabOrder=(page:Page)=>page.locator('.session-toolbar [data-tab-id]').evaluateAll(e=>e.map(t=>(t as HTMLElement).dataset.tabId));
/** Synthetic drag event at the left or right edge of an element, sharing one DataTransfer per drag. */
const fire=(target:Locator,type:string,spot:'left'|'right'|'middle'='middle')=>target.evaluate((el,[type,spot])=>{
  const r=el.getBoundingClientRect(),w=window as any;if(type==='dragstart')w.__transfer=new DataTransfer();
  const x=spot==='left'?r.left+3:spot==='right'?r.right-3:r.left+r.width/2;
  return !el.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:w.__transfer,clientX:x,clientY:r.top+r.height/2}));
},[type,spot] as const);
const prefs=(page:Page)=>page.evaluate(()=>window.harbor.snapshot().then(s=>s.preferences));
const nav=(page:Page,name:string)=>page.getByRole('navigation',{name:'Settings categories'}).getByRole('button',{name,exact:true});
const quiet=async(app:ElectronApplication)=>{await (await app.firstWindow()).getByRole('button',{name:'Settings',exact:true}).waitFor();await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('harbor:checkReachability');ipcMain.handle('harbor:checkReachability',()=>({}));ipcMain.removeHandler('harbor:importHistory');ipcMain.handle('harbor:importHistory',()=>{});ipcMain.removeHandler('harbor:usage');ipcMain.handle('harbor:usage',()=>[]);});};

test('Settings is a regular tab: it opens at the end, ⌘, focuses it, it reorders, ⌘1–9 and Control-Tab include it, ⌘W closes only it',async()=>{
  const data=await fixture();let app=await data.launch();let page=await app.firstWindow();
  try {
    await quiet(app);await mkdir('test-results/screenshots',{recursive:true});
    await openChat(page,'Tab groups design');await openChat(page,'Rate limiter');
    await app.evaluate(({dialog})=>{(globalThis as any).asked=0;dialog.showMessageBox=(async()=>{(globalThis as any).asked++;return {response:0,checkboxChecked:false};}) as any;});
    await page.keyboard.press('Meta+,');
    await expect(settingsTab(page)).toHaveCount(1);await expect(page.locator('.settings-view')).toBeVisible();await expect(page.locator('.pane-workspace')).toBeHidden();
    expect(await activeTab(page)).toEqual(['settings']);
    // The search box takes focus, and ⌘F returns to it.
    await expect(page.getByLabel('Search settings')).toBeFocused();
    await page.getByRole('heading',{name:'General'}).click();await page.keyboard.press('Meta+f');await expect(page.getByLabel('Search settings')).toBeFocused();
    await page.screenshot({path:'test-results/screenshots/settings-tab.png'});
    // Asking again focuses the same tab, with a pulse; the sidebar button does too.
    await page.keyboard.press('Meta+,');await expect(settingsTab(page)).toHaveAttribute('data-pulse','1');
    await page.getByRole('button',{name:'Settings',exact:true}).click();await expect(settingsTab(page)).toHaveCount(1);
    // It opened at the end, like a new chat tab, and it is ungrouped.
    expect(await tabOrder(page)).toEqual(['a1','b1','settings']);await expect(settingsTab(page)).not.toHaveClass(/grouped/);
    // ⌘1–9 and Control-Tab treat it like any tab.
    await page.keyboard.press('Meta+1');expect(await activeTab(page)).toEqual(['a1']);await expect(page.locator('.settings-view')).toBeHidden();await expect(settingsTab(page)).toHaveCount(1);
    await page.keyboard.press('Meta+9');expect(await activeTab(page)).toEqual(['settings']);await expect(page.locator('.settings-view')).toBeVisible();
    await page.keyboard.press('Control+Tab');expect(await activeTab(page)).toEqual(['a1']);
    await page.keyboard.press('Control+Shift+Tab');expect(await activeTab(page)).toEqual(['settings']);
    await page.keyboard.press('Meta+Shift+[');expect(await activeTab(page)).toEqual(['b1']);
    // Dragged onto a group's tab, it lands beside the whole group and stays out of it.
    const chip=page.locator('.session-toolbar [data-group-key="p:app"]');
    await fire(settingsTab(page),'dragstart');expect(await fire(page.locator('[data-tab-id="a1"]'),'dragover','left')).toBe(true);
    await expect(page.locator('.tab-drop-caret')).toBeVisible();await fire(page.locator('[data-tab-id="a1"]'),'drop','left');await fire(settingsTab(page),'dragend');
    expect(await tabOrder(page)).toEqual(['settings','a1','b1']);
    expect(await settingsTab(page).evaluate(e=>e.compareDocumentPosition(document.querySelector('[data-group-key="p:app"]')!)&Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
    // It cannot be dropped into a group chip or onto a chat pane.
    await fire(settingsTab(page),'dragstart');expect(await fire(chip,'dragover','middle')).toBe(false);await expect(page.locator('.pane-drop-zone')).toHaveCount(0);await fire(settingsTab(page),'dragend');
    await page.waitForTimeout(500);await page.screenshot({path:'test-results/screenshots/settings-tab-moved.png'});
    // Its place comes back after a restart, behind the chat you were in.
    await app.close();app=await data.launch();page=await app.firstWindow();await quiet(app);
    await expect(settingsTab(page)).toHaveCount(1);expect(await activeTab(page)).toEqual(['b1']);expect(await tabOrder(page)).toEqual(['settings','a1','b1']);
    // Clicking it shows it; ⌘W then closes Settings alone, without asking, and the chat comes back.
    await settingsTab(page).getByRole('button',{name:'Settings tab'}).click();expect(await activeTab(page)).toEqual(['settings']);
    await app.evaluate(({dialog})=>{(globalThis as any).asked=0;dialog.showMessageBox=(async()=>{(globalThis as any).asked++;return {response:0,checkboxChecked:false};}) as any;});
    await page.keyboard.press('Meta+w');
    await expect(settingsTab(page)).toHaveCount(0);expect(await tabOrder(page)).toEqual(['a1','b1']);expect(await activeTab(page)).toEqual(['a1']);
    expect(await app.evaluate(()=>(globalThis as any).asked)).toBe(0);
    // Links into Settings open the right page: Add project → Manage remotes, and the menu's ⌘, path.
    await page.getByRole('button',{name:'Add project',exact:true}).click();await page.getByLabel('Host',{exact:true}).selectOption('manage');
    await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.settings-page')).toHaveAttribute('data-category','remotes');
    await settingsTab(page).getByRole('button',{name:'Close Settings'}).click();await expect(settingsTab(page)).toHaveCount(0);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('harbor:preferences'));await expect(page.locator('.settings-page')).toHaveAttribute('data-category','remotes');
    // Middle-click closes it, like a chat tab.
    await settingsTab(page).click({button:'middle'});await expect(settingsTab(page)).toHaveCount(0);
  } finally {await app.close();await rm(data.dir,{recursive:true,force:true});}
});

test('terminals stay attached while Settings is showing',async()=>{
  const data=await fixture(false);const app=await data.launch();const page=await app.firstWindow();
  try {
    await quiet(app);
    await page.getByRole('button',{name:'New chat in Agent-Manager',exact:true}).click();await page.getByRole('button',{name:'Terminal',exact:true}).click();await page.getByRole('button',{name:'Create chat',exact:true}).click();
    await expect(page.locator('.connection-label')).toHaveText('Connected',{timeout:30000});
    const session=(await page.evaluate(()=>window.harbor.snapshot())).sessions[0];
    const clients=()=>transport.run('local',transport.setup()+transport.tmux(['list-clients','-t',`=${session.tmuxName}`,'-F','#{client_pid}'])).then(v=>v.trim());
    const before=await clients();expect(before).not.toBe('');
    await expect.poll(async()=>(await transport.run('local',transport.setup()+transport.tmux(['display-message','-p','-t',session.paneId,'#{bracket_paste_flag}']))).trim(),{timeout:20000}).toBe('1');
    await page.locator('.xterm-helper-textarea').focus();await page.keyboard.type('echo SETTINGS_$((40+2))');await page.keyboard.press('Enter');
    await expect(page.locator('.xterm-rows')).toContainText('SETTINGS_42');
    await page.locator('.xterm').evaluate(e=>{(e as any).marked=true;});
    await page.keyboard.press('Meta+,');await expect(page.locator('.settings-view')).toBeVisible();
    // Hidden, not unmounted: the same terminal stays in the page while Settings shows.
    expect(await page.locator('.xterm').evaluate(e=>e.isConnected&&(e as any).marked)).toBe(true);await expect(page.locator('.pane-workspace')).toBeHidden();
    await nav(page,'Updates').click();await nav(page,'Remotes').click();await page.waitForTimeout(500);
    await page.keyboard.press('Meta+w');await expect(page.locator('.settings-view')).toHaveCount(0);
    await expect(page.locator('.connection-label')).toHaveText('Connected');
    expect(await page.locator('.xterm').evaluate(e=>(e as any).marked)).toBe(true);await expect(page.locator('.xterm-rows')).toContainText('SETTINGS_42');
    expect(await clients()).toBe(before);
  } finally {await app.close();await rm(data.dir,{recursive:true,force:true});await transport.run('local',transport.tmux(['kill-server'])).catch(()=>{});}
});

test('every category keeps the same content size, and narrow windows move the categories to a top row',async()=>{
  const data=await fixture();const app=await data.launch();const page=await app.firstWindow();
  try {
    await quiet(app);await mkdir('test-results/screenshots',{recursive:true});
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    const categories=['General','Agents','Remotes','Projects','Notifications','Open in…','Usage','Updates','Shortcuts','Status icons','About'];
    const measure=async()=>({content:await page.locator('.settings-content').boundingBox(),page:await page.locator('.settings-page').evaluate(e=>{const r=e.getBoundingClientRect();return {x:r.x,width:r.width};})});
    let first:Awaited<ReturnType<typeof measure>>|undefined;
    for(const name of categories){
      await nav(page,name).click();await expect(nav(page,name)).toHaveAttribute('aria-current','page');
      const size=await measure();first??=size;expect(size).toEqual(first);
      await page.screenshot({path:`test-results/screenshots/settings-${name.replace(/\W/g,'').toLowerCase()}.png`});
    }
    expect(first!.page.width).toBeLessThanOrEqual(760);
    // Minimum window with the sidebar pinned: the list becomes a row above the page, and nothing scrolls sideways.
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(950,640));
    await expect.poll(()=>page.evaluate(()=>innerWidth)).toBeLessThanOrEqual(950);
    await nav(page,'General').click();
    const navBox=(await page.locator('.settings-nav').boundingBox())!,content=(await page.locator('.settings-content').boundingBox())!;
    expect(navBox.height).toBeLessThan(110);expect(content.y).toBeGreaterThanOrEqual(navBox.y+navBox.height-1);
    expect(await page.locator('.settings-content').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
    await page.screenshot({path:'test-results/screenshots/settings-narrow.png'});
    const narrow=await measure();await nav(page,'Updates').click();expect(await measure()).toEqual(narrow);
    await nav(page,'Remotes').click();await page.screenshot({path:'test-results/screenshots/settings-narrow-remotes.png'});
  } finally {await app.close();await rm(data.dir,{recursive:true,force:true});}
});

test('changes save as you go, merged per section; remote connection fields wait for Save or Revert',async()=>{
  const data=await fixture();const app=await data.launch();const page=await app.firstWindow();
  try {
    await quiet(app);await mkdir('test-results/screenshots',{recursive:true});
    await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('harbor:diagnose');ipcMain.handle('harbor:diagnose',()=>({ok:true,tmux:'tmux 3.4',codex:true,claude:false}));});
    await page.keyboard.press('Meta+,');
    // A switch saves on its own and says so.
    await page.getByRole('checkbox',{name:'Expand sidebar on hover'}).uncheck();await expect(page.locator('.settings-saved.on')).toBeVisible();
    await expect.poll(async()=>(await prefs(page)).sidebar.expandOnHover).toBe(false);
    await page.getByLabel('Terminal font size').selectOption('15');await expect.poll(async()=>(await prefs(page)).terminal.fontSize).toBe(15);
    // Something else saving meanwhile (another page, or the main process) is not overwritten by the next change here.
    await page.evaluate(async()=>{const p=(await window.harbor.snapshot()).preferences;await window.harbor.savePreferences({...p,notifications:{...p.notifications,whenFocused:true}});});
    await page.getByRole('checkbox',{name:'Cursor blink'}).uncheck();
    await expect.poll(async()=>(await prefs(page)).terminal.cursorBlink).toBe(false);expect((await prefs(page)).notifications.whenFocused).toBe(true);
    // Two sections changed back to back both land.
    await nav(page,'Agents').click();await page.getByLabel('Codex permission mode').selectOption('full-access');
    await nav(page,'Notifications').click();await page.getByRole('checkbox',{name:'Play a sound'}).uncheck();
    await expect.poll(async()=>{const p=await prefs(page);return [p.agents.codex,p.notifications.sound];}).toEqual(['full-access',false]);

    // A new remote is a draft until saved, Test connection comes first, and Save writes it.
    await nav(page,'Add remote').click();
    const editor=page.locator('.host-editor');const bar=page.getByRole('region',{name:'Unsaved changes'});
    await expect(bar).toContainText('not saved yet');
    const test=editor.getByRole('button',{name:'Test connection',exact:true});await expect(test).toBeDisabled();
    await editor.getByLabel('Display name',{exact:true}).fill('devbox');await editor.getByLabel('SSH alias or address',{exact:true}).fill('devbox.example.invalid');
    expect((await test.boundingBox())!.y).toBeLessThan((await editor.getByLabel('Display name',{exact:true}).boundingBox())!.y);
    await test.click();await expect(editor.getByRole('status').filter({hasText:'Connected'})).toHaveText('Connected · tmux 3.4 · Codex available · Claude Code not found');
    expect((await prefs(page)).hosts).toHaveLength(1);
    await page.screenshot({path:'test-results/screenshots/settings-remote-draft.png'});
    await bar.getByRole('button',{name:'Save',exact:true}).click();await expect(bar).toHaveCount(0);
    await expect.poll(async()=>(await prefs(page)).hosts.map(h=>h.connection?.target??h.id)).toEqual(['local','devbox.example.invalid']);
    // Editing shows Save and Revert; Revert puts the saved values back without writing.
    const target=editor.getByLabel('SSH alias or address',{exact:true});
    await target.fill('alice@devbox.example.invalid');await expect(bar).toContainText('Unsaved changes to devbox');
    await expect(page.locator('.settings-nav-item.sub .settings-unsaved')).toHaveCount(1);
    // The launcher switch still saves by itself, keeping the unsaved edit.
    await editor.getByRole('checkbox',{name:'Show in launcher'}).uncheck();await expect.poll(async()=>(await prefs(page)).hosts[1].enabled).toBe(false);
    await expect(target).toHaveValue('alice@devbox.example.invalid');expect((await prefs(page)).hosts[1].connection?.target).toBe('devbox.example.invalid');
    await page.screenshot({path:'test-results/screenshots/settings-remote-unsaved.png'});
    await bar.getByRole('button',{name:'Revert',exact:true}).click();await expect(target).toHaveValue('devbox.example.invalid');await expect(bar).toHaveCount(0);
    await expect(editor.getByRole('checkbox',{name:'Show in launcher'})).not.toBeChecked();
    // Return in a field saves, like the Save button.
    await editor.getByLabel('Port',{exact:true}).fill('2222');await target.press('Enter');
    await expect.poll(async()=>(await prefs(page)).hosts[1].connection?.port).toBe(2222);
    // Removing asks first.
    await editor.getByRole('button',{name:'Remove remote',exact:true}).click();await editor.getByRole('button',{name:'Remove',exact:true}).click();
    await expect.poll(async()=>(await prefs(page)).hosts).toHaveLength(1);await expect(page.locator('.settings-page')).toHaveAttribute('data-category','remotes');

    // Projects: visibility applies at once; deleting needs a confirmation.
    await nav(page,'Projects').click();
    await page.locator('.managed-project',{hasText:'tessera-api'}).getByRole('checkbox',{name:'Visible'}).uncheck();
    await expect(page.locator('.sidebar .project-section')).toHaveCount(1);
    await page.getByRole('button',{name:'Delete project tessera-api'}).click();
    await expect(page.getByRole('group',{name:'Delete tessera-api'})).toBeVisible();expect((await page.evaluate(()=>window.harbor.snapshot())).projects).toHaveLength(2);
    await page.screenshot({path:'test-results/screenshots/settings-project-delete.png'});
    await page.getByRole('button',{name:'Delete project',exact:true}).click();
    await expect.poll(async()=>(await page.evaluate(()=>window.harbor.snapshot())).projects.map(p=>p.id)).toEqual(['app']);
  } finally {await app.close();await rm(data.dir,{recursive:true,force:true});}
});

test('search finds settings across categories and remotes, and jumps to the setting',async()=>{
  const data=await fixture();const app=await data.launch();const page=await app.firstWindow();
  try {
    await quiet(app);await mkdir('test-results/screenshots',{recursive:true});
    await page.evaluate(async()=>{const p=(await window.harbor.snapshot()).preferences;p.hosts.push({id:'devbox',label:'devbox',source:'manual',enabled:true,defaultDirectory:'~',connection:{target:'devbox.example.invalid'}});await window.harbor.savePreferences(p);});
    await page.keyboard.press('Meta+,');
    const search=page.getByLabel('Search settings');
    await search.fill('ssh');
    const results=page.locator('.settings-result');
    await expect(results.filter({hasText:'Import from SSH config'})).toHaveCount(1);await expect(results.filter({hasText:'Remotes › devbox'}).filter({hasText:'SSH alias or address'})).toHaveCount(1);
    await expect(page.locator('.settings-nav-item',{hasText:'Remotes'}).first().locator('.settings-hits')).toBeVisible();
    await expect(page.locator('.settings-nav-item.dimmed',{hasText:'Shortcuts'})).toHaveCount(1);
    await page.screenshot({path:'test-results/screenshots/settings-search.png'});
    await results.filter({hasText:'Identity file'}).click();
    await expect(search).toHaveValue('');await expect(page.locator('.host-editor')).toBeVisible();await expect(page.locator('[data-setting="identity"]')).toHaveClass(/setting-highlight/);
    await search.fill('beta');await expect(results).toHaveCount(1);await search.press('Enter');
    await expect(page.locator('.settings-page')).toHaveAttribute('data-category','updates');
    await search.fill('nothing like this');await expect(page.locator('.settings-empty')).toBeVisible();
    await search.press('Escape');await expect(search).toHaveValue('');await expect(page.locator('.settings-view')).toBeVisible();
  } finally {await app.close();await rm(data.dir,{recursive:true,force:true});}
});

test('importing from SSH config lists aliases as rows to pick, filter and import',async()=>{
  const data=await fixture();
  // A throwaway HOME whose ~/.ssh/config holds placeholder aliases; the real one is never read.
  const home=path.join(data.dir,'home');await mkdir(path.join(home,'.ssh'),{recursive:true});
  const aliases=['devbox','build-01','build-02','gpu-node','gpu-node-long-name.example.invalid','staging','bastion'];
  await writeFile(path.join(home,'.ssh','config'),aliases.map(a=>`Host ${a}\n  HostName ${a}.example.invalid\n`).join('\n')+'Host *\n  ServerAliveInterval 30\n');
  const app=await data.launch({HOME:home});const page=await app.firstWindow();
  try {
    await quiet(app);await mkdir('test-results/screenshots',{recursive:true});
    await page.keyboard.press('Meta+,');await nav(page,'Remotes').click();
    await page.getByRole('button',{name:'Import from SSH config'}).click();
    const list=page.getByRole('group',{name:'SSH aliases'}),rows=list.locator('.import-option');
    await expect(rows).toHaveCount(aliases.length);
    // Rows, not one wrapped line: each alias sits on its own row, in a column or a tidy grid.
    const boxes=await rows.evaluateAll(e=>e.map(r=>{const b=r.getBoundingClientRect();return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height)};}));
    expect(new Set(boxes.map(b=>b.w)).size).toBe(1);expect(Math.min(...boxes.map(b=>b.h))).toBeGreaterThanOrEqual(28);expect(new Set(boxes.map(b=>b.x)).size).toBeLessThanOrEqual(3);
    await page.screenshot({path:'test-results/screenshots/settings-ssh-import.png'});
    // At the minimum window the grid drops to fewer columns and nothing scrolls sideways.
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(950,640));await expect.poll(()=>page.evaluate(()=>innerWidth)).toBeLessThanOrEqual(950);
    expect(await page.locator('.settings-content').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
    await page.screenshot({path:'test-results/screenshots/settings-ssh-import-narrow.png'});
    // Clicking the row's name ticks it; the count follows.
    await rows.filter({hasText:'devbox'}).locator('span').click();await expect(page.getByRole('button',{name:'Import selected (1)'})).toBeEnabled();
    await page.getByLabel('Search SSH aliases').fill('gpu');await expect(rows).toHaveCount(2);
    await page.getByRole('button',{name:'Select all',exact:true}).click();await expect(page.getByRole('button',{name:'Import selected (3)'})).toBeEnabled();
    await page.getByRole('button',{name:'Clear',exact:true}).click();await expect(page.getByRole('button',{name:'Import selected (1)'})).toBeEnabled();
    await page.getByLabel('Search SSH aliases').fill('nothing');await expect(list).toContainText('No aliases match');
    await page.getByLabel('Search SSH aliases').fill('');await rows.filter({hasText:'staging'}).click();
    await page.getByRole('button',{name:'Import selected (2)'}).click();
    await expect.poll(async()=>(await prefs(page)).hosts.filter(h=>h.source==='ssh-config').map(h=>h.connection?.target).sort()).toEqual(['devbox','staging']);
    // The first imported remote's page opens; both are listed under Remotes.
    await expect(page.locator('.host-editor')).toContainText('devbox');await nav(page,'Remotes').click();await expect(page.locator('.settings-row',{hasText:'staging'})).toBeVisible();
    // Importing again marks what is already added.
    await page.getByRole('button',{name:'Import from SSH config'}).click();
    await expect(rows.filter({hasText:'devbox'})).toContainText('Added');await expect(rows.filter({hasText:'devbox'}).getByRole('checkbox')).toBeDisabled();
    await page.getByRole('button',{name:'Select all',exact:true}).click();await expect(page.getByRole('button',{name:`Import selected (${aliases.length-2})`})).toBeEnabled();
  } finally {await app.close();await rm(data.dir,{recursive:true,force:true});}
});
