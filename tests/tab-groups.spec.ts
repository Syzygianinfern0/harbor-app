import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PROJECTS=[['app','Agent-Manager'],['api','tessera-api'],['paper','neurips-paper']] as const;
const CHATS=[['a1','app','Tab groups design'],['a2','app','Fix SSH reattach'],['a3','app','Release notes'],['b1','api','Rate limiter'],['b2','api','Flaky auth test'],['c1','paper','Rebuttal draft'],['c2','paper','Plot ablations']] as const;
async function fixture() {
  const dir=await mkdtemp(path.join(tmpdir(),'harbor-tab-groups-'));const createdAt=new Date().toISOString();
  const projects=PROJECTS.map(([id,name])=>({id,name,cwd:dir,hostId:'local',hostLabel:'This Mac',connection:'local',createdAt}));
  const sessions=CHATS.map(([id,projectId,name],i)=>({id,tmuxName:`harbor-bbbb${i}`,paneId:`%${i}`,name,host:'local',cwd:dir,launcher:'codex',group:'',tags:[],pinned:false,archived:false,createdAt,updatedAt:new Date(Date.now()-i*1000).toISOString(),status:'closed',projectId,hasMessages:true}));
  await writeFile(path.join(dir,'sessions.json'),JSON.stringify({version:2,projects,sessions}));
  return {dir,launch:()=>electron.launch({executablePath:process.env.HARBOR_TEST_APP,args:process.env.HARBOR_TEST_APP?[]:['.'],env:{...process.env,HARBOR_DATA_DIR:dir}})};
}
const openChat=(page:Page,name:string)=>page.locator('.sidebar .chat-row',{hasText:name}).click();
const tabOrder=(page:Page)=>page.locator('.session-toolbar [data-tab-id]').evaluateAll(e=>e.map(t=>(t as HTMLElement).dataset.tabId));
const chipOrder=(page:Page)=>page.locator('.session-toolbar [data-group-key]').evaluateAll(e=>e.map(t=>(t as HTMLElement).dataset.groupKey));
async function setActivity(app:ElectronApplication,page:Page,activity:Record<string,string>) {
  const snapshot=await page.evaluate(()=>window.harbor.snapshot());
  snapshot.sessions=snapshot.sessions.map(s=>activity[s.id]?{...s,status:'running',activity:activity[s.id] as any}:s);
  await app.evaluate(({BrowserWindow,ipcMain},snapshot)=>{
    ipcMain.removeHandler('harbor:snapshot');ipcMain.handle('harbor:snapshot',()=>snapshot);
    const contents=BrowserWindow.getAllWindows()[0].webContents;const send=(contents as any).__send??contents.send.bind(contents);(contents as any).__send=send;
    contents.send=(channel:string,...args:unknown[])=>send(channel,...(channel==='harbor:snapshot-changed'?[snapshot]:args));contents.send('harbor:snapshot-changed',snapshot);
  },snapshot);
}

test('project and custom tab groups fold, report status, persist, and link to the sidebar',async()=>{
  const data=await fixture();let app=await data.launch();let page=await app.firstWindow();
  try {
    await mkdir('test-results/screenshots',{recursive:true});
    for(const name of ['Tab groups design','Rate limiter','Fix SSH reattach','Rebuttal draft','Flaky auth test'])await openChat(page,name);
    // Tabs gather into project groups, in sidebar project order, and the sidebar marks open chats.
    await expect.poll(()=>chipOrder(page)).toEqual(['p:app','p:api','p:paper']);
    expect(await tabOrder(page)).toEqual(['a1','a2','b1','b2','c1']);
    await expect(page.locator('.sidebar .chat-row.open-tab')).toHaveCount(5);
    await expect(page.locator('.sidebar .chat-row.open-tab',{hasText:'Release notes'})).toHaveCount(0);

    // Folding the viewed group puts it away: the view moves to the most recently used chat still shown.
    const api=page.getByRole('button',{name:/^tessera-api group/});
    await api.click();await expect(api).toHaveAttribute('aria-expanded','false');
    expect(await tabOrder(page)).toEqual(['a1','a2','c1']);await expect(page.locator('.tab.active')).toHaveAttribute('data-tab-id','c1');
    await expect(page.locator('[data-group-key="p:api"] .chip-count')).toHaveText('2');

    // A folded chat that needs input is reported on the chip, and the bell opens it.
    await setActivity(app,page,{b1:'attention',c2:'working'});
    const bell=page.getByRole('button',{name:'Open Rate limiter: Needs input or approval',exact:true});
    await expect(bell).toBeVisible();await page.screenshot({path:'test-results/screenshots/30-tab-groups-folded.png'});
    await bell.click();await expect(page.locator('.tab.active')).toHaveAttribute('data-tab-id','b1');
    await expect(api).toHaveAttribute('aria-expanded','true');expect(await tabOrder(page)).toEqual(['a1','a2','b1','b2','c1']);

    // ⌘/Shift-click builds a selection; ⌘G makes a custom group and opens its name field.
    await page.locator('[data-tab-id="a2"] > button').first().click({modifiers:['Meta']});
    await page.locator('[data-tab-id="c1"] > button').first().click({modifiers:['Shift']});
    await page.locator('[data-tab-id="b1"] > button').first().click({modifiers:['Meta']});
    await expect(page.locator('.tab.multi-selected')).toHaveCount(2);
    await page.keyboard.press('Meta+g');
    const name=page.getByRole('textbox',{name:'Group name',exact:true});await expect(name).toBeFocused();
    await name.fill('Release 0.6');await page.keyboard.press('Enter');
    const release=page.getByRole('button',{name:/^Release 0\.6 group, 2 chats/});await expect(release).toBeVisible();
    await expect.poll(()=>tabOrder(page)).toEqual(['a1','b1','b2','a2','c1']);
    expect(await chipOrder(page)).toEqual(['p:app','p:api','g:'+(await page.locator('[data-group-key^="g:"]').getAttribute('data-group-key'))!.slice(2)]);

    // Right-click menus: recolor the group, then remove a tab from it.
    await release.click({button:'right'});await page.getByRole('menuitemradio',{name:'Blue',exact:true}).click();
    await expect(page.locator('[data-group-key^="g:"]')).toHaveCSS('--group-color','#8fb4e8');await page.keyboard.press('Escape');
    await page.locator('[data-tab-id="c1"]').click({button:'right'});await page.getByRole('menuitem',{name:'Remove from group'}).click();
    await expect(page.getByRole('button',{name:/^Release 0\.6 group, 1 chat/})).toBeVisible();
    await expect.poll(()=>chipOrder(page)).toEqual(['p:app','p:api','g:'+(await page.locator('[data-group-key^="g:"]').getAttribute('data-group-key'))!.slice(2),'p:paper']);

    // Dragging a tab onto a chip adds it to that group.
    const transfer=await page.evaluateHandle(()=>new DataTransfer());
    await page.locator('[data-tab-id="c1"]').dispatchEvent('dragstart',{dataTransfer:transfer});
    await page.locator('[data-group-key^="g:"]').dispatchEvent('dragover',{dataTransfer:transfer});
    await page.locator('[data-group-key^="g:"]').dispatchEvent('drop',{dataTransfer:transfer});await transfer.dispose();
    await expect(page.getByRole('button',{name:/^Release 0\.6 group, 2 chats/})).toBeVisible();

    // Group shortcuts: ⌥⌘→ and ⌥⌘1 switch groups; ⌘J jumps to the chat needing input.
    await page.locator('[data-tab-id="a1"] > button').first().click();
    await page.keyboard.press('Alt+Meta+ArrowRight');await expect(page.locator('.tab.active')).toHaveAttribute('data-tab-id','b1');
    await page.keyboard.press('Alt+Meta+Digit1');await expect(page.locator('.tab.active')).toHaveAttribute('data-tab-id','a1');
    await page.keyboard.press('Meta+j');await expect(page.locator('.tab.active')).toHaveAttribute('data-tab-id','b1');

    // Focus mode: only the current group is open, and clicking a chip switches to its last-used tab.
    await page.getByRole('button',{name:'Tab groups',exact:true}).click();
    await page.locator('.groups-menu label',{hasText:'Focus mode'}).click();await page.keyboard.press('Escape');
    expect(await tabOrder(page)).toEqual(['b1','b2']);
    await page.getByRole('button',{name:/^Agent-Manager group/}).click();await expect(page.locator('.tab.active')).toHaveAttribute('data-tab-id','a1');
    expect(await tabOrder(page)).toEqual(['a1']);
    await page.keyboard.press('Meta+1');await expect(page.locator('.tab.active')).toHaveAttribute('data-tab-id','a1');
    await page.screenshot({path:'test-results/screenshots/31-tab-groups-focus.png'});

    // The collapsed rail switches groups in focus mode and shows project status.
    await page.keyboard.press('Meta+b');
    await expect(page.locator('.rail-session .rail-badge')).toHaveCount(2);
    await page.getByRole('button',{name:'Open project tessera-api',exact:true}).click();await expect(page.locator('.tab.active')).toHaveAttribute('data-tab-id','b1');
    await page.screenshot({path:'test-results/screenshots/32-tab-groups-rail.png'});
    await page.keyboard.press('Meta+b');
    await page.getByRole('button',{name:'Tab groups',exact:true}).click();
    await page.locator('.groups-menu label',{hasText:'Focus mode'}).click();await page.keyboard.press('Escape');

    // Sidebar: a folded project reports its live chats; its menu shows and folds its tabs.
    await page.getByRole('button',{name:'Collapse project neurips-paper',exact:true}).click();
    await expect(page.locator('.project-rollup')).toHaveCount(1);await expect(page.locator('.project-rollup .chat-activity.working')).toHaveCount(1);
    await page.locator('.project-heading',{hasText:'tessera-api'}).click({button:'right'});
    await page.getByRole('menuitem',{name:'Fold in tab bar',exact:true}).click();
    await expect(page.getByRole('button',{name:/^tessera-api group/})).toHaveAttribute('aria-expanded','false');
    await page.locator('.project-heading',{hasText:'tessera-api'}).click({button:'right'});
    await page.getByRole('menuitem',{name:'Show tabs',exact:true}).click();
    await expect(page.getByRole('button',{name:/^tessera-api group/})).toHaveAttribute('aria-expanded','true');
    // Projects take a color from their sidebar menu; the active tab and selected row use it.
    await page.locator('.project-heading',{hasText:'tessera-api'}).click({button:'right'});
    await page.getByRole('group',{name:'Project color'}).getByRole('menuitemradio',{name:'Rose',exact:true}).click();await page.keyboard.press('Escape');
    await expect(page.locator('[data-group-key="p:api"]')).toHaveCSS('--group-color','#e3a1a8');
    await expect(page.locator('.project-heading',{hasText:'tessera-api'}).locator('.project-folder')).toHaveCSS('color','rgb(227, 161, 168)');
    await expect(page.locator('.tab.active')).toHaveAttribute('data-tab-id','b1');await expect(page.locator('.tab.active')).toHaveCSS('--tab-color','#e3a1a8');
    await page.screenshot({path:'test-results/screenshots/33-tab-groups-sidebar.png'});

    // ⌘⇧G turns project grouping off; custom groups stay.
    await page.keyboard.press('Meta+Shift+g');
    await expect.poll(()=>chipOrder(page)).toHaveLength(1);await expect(page.getByRole('button',{name:/^Release 0\.6 group/})).toBeVisible();
    await page.keyboard.press('Meta+Shift+g');await expect.poll(()=>chipOrder(page)).toHaveLength(3);

    // Groups, folding and colors survive a restart.
    await page.getByRole('button',{name:/^tessera-api group/}).click();
    await app.close();app=await data.launch();page=await app.firstWindow();
    await expect(page.getByRole('button',{name:/^Release 0\.6 group, 2 chats/})).toBeVisible();
    await expect(page.getByRole('button',{name:/^tessera-api group/})).toHaveAttribute('aria-expanded','false');
    await expect(page.locator('[data-group-key^="g:"]')).toHaveCSS('--group-color','#8fb4e8');
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('harbor.tabGroups')!));
    expect(saved.custom[0].members.sort()).toEqual(['a2','c1']);expect(saved.byProject).toBe(true);
  } finally {await app.close();}
});

test('tabs shrink step by step before scrolling, and edge markers report hidden chats needing input',async()=>{
  const data=await fixture();const app=await data.launch();const page=await app.firstWindow();
  try {
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(860,700));
    for(const [,,name] of CHATS)await openChat(page,name);
    await page.getByRole('button',{name:'Tab groups',exact:true}).click();await page.locator('.groups-menu label',{hasText:'Group tabs by project'}).click();await page.keyboard.press('Escape');
    const strip=page.locator('.session-toolbar .tab-strip');
    await expect(page.locator('.tab.compact').first()).toBeAttached();
    await expect(page.locator('.tab.active:not(.compact)')).toHaveCount(1);
    await page.getByRole('button',{name:'Tab groups',exact:true}).click();await page.locator('.groups-menu label',{hasText:'Shrink tabs'}).click();await page.keyboard.press('Escape');
    expect(await strip.evaluate(e=>e.scrollWidth>e.clientWidth)).toBe(true);
    await setActivity(app,page,{a1:'attention'});
    await page.locator('[data-tab-id="c2"] > button').first().click();
    const edge=page.locator('.tab-edge.left');await expect(edge).toBeVisible();await expect(edge.locator('.edge-pill.attention')).toHaveText('1');
    await page.screenshot({path:'test-results/screenshots/34-tab-edge-markers.png'});
    await edge.click();await expect.poll(()=>page.locator('[data-tab-id="a1"]').evaluate(e=>{const r=e.getBoundingClientRect(),s=e.parentElement!.getBoundingClientRect();return r.left>=s.left-1&&r.right<=s.right+1;})).toBe(true);
  } finally {await app.close();}
});

test('folding takes the group split with it, unfold undoes it, and folding everything shows the overview',async()=>{
  const data=await fixture();const app=await data.launch();const page=await app.firstWindow();
  try {
    await openChat(page,'Tab groups design');await openChat(page,'Rate limiter');await openChat(page,'Tab groups design');
    await page.getByRole('button',{name:'Split view',exact:true}).click();await page.locator('.split-picker button',{hasText:'Fix SSH reattach'}).click();
    await expect(page.locator('.workspace-pane')).toHaveCount(2);
    const appGroup=page.getByRole('button',{name:/^Agent-Manager group/});
    await appGroup.click();await expect(page.locator('.workspace-pane')).toHaveCount(1);await expect(page.locator('.tab.active')).toHaveAttribute('data-tab-id','b1');
    await appGroup.click();await expect(page.locator('.workspace-pane')).toHaveCount(2);await expect(page.locator('.tab.active')).toHaveAttribute('data-tab-id','a2');
    await page.getByRole('button',{name:'Tab groups',exact:true}).click();await page.getByRole('menuitem',{name:'Collapse all groups'}).click();
    const overview=page.locator('.groups-overview');await expect(overview).toBeVisible();await expect(page.locator('.workspace-pane')).toHaveCount(0);
    await expect(overview.locator('.group-card')).toHaveCount(2);await expect(page.locator('.session-toolbar [data-group-key]')).toHaveCount(2);
    await page.screenshot({path:'test-results/screenshots/35-groups-overview.png'});
    await overview.getByRole('button',{name:/Agent-Manager/}).click();
    await expect(overview).toHaveCount(0);await expect(page.locator('.workspace-pane')).toHaveCount(2);
    await page.getByRole('button',{name:'Tab groups',exact:true}).click();await page.getByRole('menuitem',{name:'Collapse all groups'}).click();
    await overview.locator('.group-card-chat',{hasText:'Rate limiter'}).click();
    await expect(page.locator('.tab.active')).toHaveAttribute('data-tab-id','b1');await expect(page.getByRole('button',{name:/^tessera-api group/})).toHaveAttribute('aria-expanded','true');
    await expect(page.getByRole('button',{name:/^Agent-Manager group/})).toHaveAttribute('aria-expanded','false');
    // Focus mode: folding the open group (or Collapse all) shows the overview; a chip then opens its group with its split.
    await page.getByRole('button',{name:'Tab groups',exact:true}).click();await page.locator('.groups-menu label',{hasText:'Focus mode'}).click();await page.keyboard.press('Escape');
    await page.getByRole('button',{name:/^tessera-api group/}).click();await expect(overview).toBeVisible();await expect(page.locator('.workspace-pane')).toHaveCount(0);
    await page.getByRole('button',{name:/^Agent-Manager group/}).click();await expect(overview).toHaveCount(0);await expect(page.locator('.workspace-pane')).toHaveCount(2);
    await page.getByRole('button',{name:'Tab groups',exact:true}).click();await page.getByRole('menuitem',{name:'Collapse all groups'}).click();await expect(overview).toBeVisible();
    await overview.locator('.group-card-chat',{hasText:'Rate limiter'}).click();await expect(page.locator('.tab.active')).toHaveAttribute('data-tab-id','b1');expect(await tabOrder(page)).toEqual(['b1']);
  } finally {await app.close();}
});
