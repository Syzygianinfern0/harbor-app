import { test, expect, _electron as electron, type Page } from '@playwright/test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
async function fixture(shell=false) {
 const dir=await mkdtemp(path.join(tmpdir(),'harbor-flex-ui-'));const createdAt=new Date().toISOString();
 const project={id:'fixture',name:'Workspace test',cwd:dir,hostId:'local',hostLabel:'This Mac',connection:'local',createdAt};
 const sessions=Array.from({length:10},(_,i)=>({id:`chat-${i}`,tmuxName:`harbor-aaaa${i}`,paneId:`%${i}`,name:`Chat ${i+1}`,host:'local',cwd:dir,launcher:shell&&i!==9?'shell':'codex',group:'',tags:[],pinned:false,archived:false,createdAt,updatedAt:createdAt,status:'closed',projectId:project.id,...(i===1?{originalLaunchCommand:'codex --sandbox read-only',latestLaunchCommand:"codex resume 'example-id'"}:{}),...(i===9?{hasMessages:false}:{})}));
 await writeFile(path.join(dir,'sessions.json'),JSON.stringify({version:2,projects:[project],sessions}));
 return {dir,launch:()=>electron.launch({executablePath:process.env.HARBOR_TEST_APP,args:process.env.HARBOR_TEST_APP?[]:['.'],env:{...process.env,HARBOR_DATA_DIR:dir}})};
}
async function split(page:Page,source:string,target:string,side:string) {
 const transfer=await page.evaluateHandle(()=>new DataTransfer());
 await page.locator(`[data-tab-id="${source}"]`).dispatchEvent('dragstart',{dataTransfer:transfer});
 const zone=page.locator(`[data-session-id="${target}"] [data-drop-side="${side}"]`);
 await expect(zone).toBeVisible();await zone.dispatchEvent('dragover',{dataTransfer:transfer});await zone.dispatchEvent('drop',{dataTransfer:transfer});
 await transfer.dispose();
}

test('browser shortcuts, reorder, nested splits, sidebar and pane resizing persist',async()=>{
 const fixtureData=await fixture();let app=await fixtureData.launch();let page=await app.firstWindow();
 try {
  await expect(page.locator('.sidebar .chat-row')).toHaveCount(5);
  await page.getByRole('button',{name:'Show more (4)',exact:true}).click();await expect(page.locator('.sidebar .chat-row')).toHaveCount(9);await expect(page.locator('.sidebar')).not.toContainText('Chat 10');
  for(let i=1;i<=9;i++)await page.locator('.sidebar .chat-row').filter({hasText:new RegExp(`^Chat ${i}Ready|^Chat ${i}$`)}).click();
  await page.keyboard.press('Meta+1');await expect(page.locator('.tab.active')).toHaveAttribute('data-tab-id','chat-0');
  await page.keyboard.press('Meta+3');await expect(page.locator('.tab.active')).toHaveAttribute('data-tab-id','chat-2');
  await page.keyboard.press('Control+Tab');await expect(page.locator('.tab.active')).toHaveAttribute('data-tab-id','chat-3');
  await page.keyboard.press('Control+Shift+Tab');await expect(page.locator('.tab.active')).toHaveAttribute('data-tab-id','chat-2');
  await page.keyboard.press('Meta+9');await expect(page.locator('.tab.active')).toHaveAttribute('data-tab-id','chat-8');
  // Tabs shrink before scrolling; with shrinking off, the strip scrolls as before.
  const strip=page.locator('.session-toolbar .tab-strip');await expect(page.locator('.tab.compact').first()).toBeAttached();expect(await strip.evaluate(e=>e.scrollWidth>e.clientWidth)).toBe(false);await expect(page.locator('.tab.active:not(.compact):not(.narrow)')).toHaveCount(1);
  await page.getByRole('button',{name:'Tab groups',exact:true}).click();await page.locator('.groups-menu label',{hasText:'Shrink tabs before scrolling'}).click();await page.keyboard.press('Escape');await expect(page.locator('.tab.compact,.tab.narrow')).toHaveCount(0);
  expect(await strip.evaluate(e=>e.scrollWidth>e.clientWidth)).toBe(true);expect(await strip.evaluate(e=>getComputedStyle(e).scrollbarWidth)).toBe('none');
  await strip.evaluate(e=>{e.scrollLeft=e.scrollWidth;});await strip.hover();await page.mouse.wheel(0,-400);await expect.poll(()=>strip.evaluate(e=>e.scrollLeft)).toBeLessThan(await strip.evaluate(e=>e.scrollWidth-e.clientWidth));await strip.evaluate(e=>{e.scrollLeft=0;});
  await page.keyboard.press('Control+Tab');await expect(page.locator('.tab.active')).toHaveAttribute('data-tab-id','chat-0');
  // Actual browser drag/drop reorders tabs.
  const dragTab=page.locator('[data-tab-id="chat-2"] > button').first();await dragTab.scrollIntoViewIfNeeded();const dragBounds=await dragTab.boundingBox();const firstBounds=await page.locator('[data-tab-id="chat-0"]').boundingBox();await page.mouse.move(dragBounds!.x+15,dragBounds!.y+12);await page.mouse.down();await page.mouse.move(dragBounds!.x+30,dragBounds!.y+15,{steps:5});await expect(page.locator('.tab.dragging')).toHaveCount(1);await page.mouse.move(firstBounds!.x+3,firstBounds!.y+15,{steps:10});await page.mouse.move(firstBounds!.x+4,firstBounds!.y+15);await page.mouse.up();
  await expect(page.locator('.tab').first()).toHaveAttribute('data-tab-id','chat-2');
  const source=page.locator('[data-tab-id="chat-1"]');await source.scrollIntoViewIfNeeded();const sourceBounds=await source.boundingBox();await page.mouse.move(sourceBounds!.x+20,sourceBounds!.y+15);await page.mouse.down();await page.mouse.move(sourceBounds!.x+30,sourceBounds!.y+45,{steps:6});const dropTarget=page.locator('[data-session-id="chat-0"] [data-drop-side="right"]');await expect(dropTarget).toBeVisible();const targetBounds=await dropTarget.boundingBox();await page.mouse.move(targetBounds!.x+targetBounds!.width/2,targetBounds!.y+targetBounds!.height/2,{steps:8});await page.mouse.up();await expect(page.locator('.workspace-pane')).toHaveCount(2);await split(page,'chat-2','chat-1','bottom');await split(page,'chat-3','chat-2','left');await split(page,'chat-4','chat-0','top');
  await expect(page.locator('.workspace-pane')).toHaveCount(5);
  // Nested splits read as one linked set in the strip: adjacent, in pane order, one outline, lit as the view.
  const panes=await page.locator('.workspace-pane').evaluateAll(e=>e.map(p=>(p as HTMLElement).dataset.sessionId));await expect(page.locator('.tab.split-view')).toHaveCount(5);await expect(page.locator('.tab.split-start')).toHaveCount(1);await expect(page.locator('.tab.split-end')).toHaveCount(1);
  const order=await page.locator('.session-toolbar [data-tab-id]').evaluateAll(e=>e.map(t=>(t as HTMLElement).dataset.tabId));const from=order.indexOf(panes[0]);expect(order.slice(from,from+5)).toEqual(panes);await expect(page.locator(`[data-tab-id="${panes[0]}"]`)).toHaveAttribute('data-split',panes.join(' '));
  const sidebar=page.getByRole('separator',{name:'Resize sidebar',exact:true});const sb=await sidebar.boundingBox();
  await page.mouse.move(sb!.x+2,sb!.y+200);await page.mouse.down();await page.mouse.move(sb!.x+102,sb!.y+200,{steps:8});await page.mouse.up();await expect(sidebar).toHaveAttribute('aria-valuenow','372');
  const divider=page.getByRole('separator',{name:'Resize columns',exact:true}).first();const before=Number(await divider.getAttribute('aria-valuenow'));await divider.focus();await page.keyboard.press('ArrowRight');expect(Number(await divider.getAttribute('aria-valuenow'))).toBeGreaterThan(before);
  const horizontal=page.getByRole('separator',{name:'Resize rows',exact:true}).first();const bounds=await horizontal.boundingBox();const prev=Number(await horizontal.getAttribute('aria-valuenow'));await page.mouse.move(bounds!.x+20,bounds!.y+2);await page.mouse.down();await page.mouse.move(bounds!.x+20,bounds!.y+62,{steps:8});await page.mouse.up();expect(Number(await horizontal.getAttribute('aria-valuenow'))).toBeGreaterThan(prev);
  await mkdir('test-results/screenshots',{recursive:true});await page.screenshot({animations:'disabled',path:'test-results/screenshots/14-flexible-workspace.png'});
  const layout=await page.evaluate(()=>localStorage.getItem('harbor.layout'));await app.close();app=await fixtureData.launch();page=await app.firstWindow();await expect(page.locator('.workspace-pane')).toHaveCount(5);expect(await page.evaluate(()=>localStorage.getItem('harbor.layout'))).toBe(layout);await expect(page.getByRole('separator',{name:'Resize sidebar'})).toHaveAttribute('aria-valuenow','372');
  await page.getByRole('button',{name:'Close pane Chat 3',exact:true}).click();await expect(page.locator('.workspace-pane')).toHaveCount(4);await expect(page.locator('[data-tab-id="chat-2"]')).toHaveCount(1);
 }finally{await app.close();}
});

test('agent defaults populate new chats, explicit mode overrides, fresh empty chats stay visible',async()=>{
 const fixtureData=await fixture();const app=await fixtureData.launch();const page=await app.firstWindow();
 try {
  await page.getByRole('button',{name:'Preferences',exact:true}).click();await page.getByRole('button',{name:'Agent defaults',exact:true}).click();
  await page.getByLabel('Codex permission mode',{exact:true}).selectOption('full-access');await page.getByLabel('Claude Code permission mode',{exact:true}).selectOption('accept-edits');await page.getByRole('button',{name:'Save preferences'}).click();
  await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('harbor:create');ipcMain.handle('harbor:create',async(_event,input)=>{(globalThis as any).createdInput=input;return {id:'fresh',name:'Fresh chat',status:'running',hasMessages:false,launcher:input.launcher,projectId:input.projectId,cwd:input.cwd};});});
  await page.getByRole('button',{name:'New chat in Workspace test',exact:true}).click();await expect(page.getByLabel('Permission mode',{exact:true})).toHaveValue('full-access');
  await page.getByRole('button',{name:'Claude Code',exact:true}).click();await expect(page.getByLabel('Permission mode',{exact:true})).toHaveValue('accept-edits');
  await page.getByLabel('Permission mode',{exact:true}).selectOption('plan');await expect(page.getByRole('button',{name:'Claude Code',exact:true})).toHaveClass('selected');await page.mouse.move(10,10);await expect(page.getByRole('button',{name:'Claude Code',exact:true})).toHaveCSS('background-color','rgb(41, 61, 50)');await page.screenshot({animations:'disabled',path:'test-results/screenshots/15-agent-permissions.png'});await page.getByRole('button',{name:'Create chat',exact:true}).click();
  expect(await app.evaluate(()=>(globalThis as any).createdInput.permissionMode)).toBe('plan');
  const data=await page.evaluate(()=>window.harbor.snapshot());
  await app.evaluate(({BrowserWindow},data)=>BrowserWindow.getAllWindows()[0].webContents.send('harbor:snapshot-changed',{...data,sessions:[...data.sessions,{id:'fresh',name:'Fresh chat',status:'running',hasMessages:false,launcher:'claude',projectId:'fixture',cwd:'.',updatedAt:new Date().toISOString()}]}),data);
  await expect(page.locator('.sidebar .chat-row').filter({hasText:'Fresh chat'})).toHaveCount(1);
 }finally{await app.close();}
});

test('shortcuts focus live split terminals and resizing keeps sessions attached',async()=>{
 const fixtureData=await fixture(true);const app=await fixtureData.launch();const page=await app.firstWindow();
 const {Transport}=await import('../src/engine/transport');const transport=new Transport();const names:string[]=[];
 try {
  await expect(page.getByRole('button',{name:'New chat in Workspace test'})).toBeVisible();
  for(const i of [1,2]) {
   await app.evaluate(({BrowserWindow},id)=>BrowserWindow.getAllWindows()[0].webContents.send('harbor:open-session',id),`chat-${i-1}`);await page.getByRole('button',{name:'Reopen terminal',exact:true}).click();await expect(page.locator('.connection-label')).toHaveText('Connected');
   const session=(await page.evaluate(()=>window.harbor.snapshot())).sessions.find(s=>s.id===`chat-${i-1}`)!;names.push(session.tmuxName);
  }
  await split(page,'chat-0','chat-1','left');await expect(page.locator('.connection-label')).toHaveText(['Connected','Connected']);
  await page.keyboard.press('Meta+2');await expect(page.locator('[data-session-id="chat-1"] .xterm-helper-textarea')).toBeFocused();
  await page.keyboard.press('Control+Shift+Tab');await expect(page.locator('[data-session-id="chat-0"] .xterm-helper-textarea')).toBeFocused();
  await page.keyboard.type("printf 'PANE_FOCUS_OK\\n'");await page.keyboard.press('Enter');
  const session=(await page.evaluate(()=>window.harbor.snapshot())).sessions.find(s=>s.id==='chat-0')!;
  await expect.poll(()=>transport.run('local',transport.setup()+transport.tmux(['capture-pane','-p','-t',session.paneId]))).toContain('PANE_FOCUS_OK');
  // Isolate line editing from the user's login-shell startup scripts.
  await transport.run('local',transport.setup()+transport.tmux(['respawn-pane','-k','-t',session.paneId,'exec /bin/bash --noprofile --norc -i']));
  await expect.poll(()=>transport.run('local',transport.setup()+transport.tmux(['capture-pane','-p','-t',session.paneId]))).toMatch(/bash-[0-9.]+[$#]/);
  await page.keyboard.type('LINE_NAV_OK');await page.keyboard.press('Meta+ArrowLeft');await page.keyboard.type('echo ');await page.keyboard.press('Meta+ArrowRight');await page.keyboard.type('_END');await page.keyboard.press('Enter');
  await expect.poll(()=>transport.run('local',transport.setup()+transport.tmux(['capture-pane','-p','-t',session.paneId]))).toContain('echo LINE_NAV_OK_END');
  await page.getByRole('separator',{name:'Resize columns'}).focus();await page.keyboard.press('ArrowRight');await expect(page.locator('.connection-label')).toHaveText(['Connected','Connected']);
 }finally{await app.close();for(const name of names)await transport.run('local',transport.setup()+transport.tmux(['kill-session','-t',`=${name}`])).catch(()=>{});}
});

test('refresh, keyboard creation, middle close, and dialog project management',async()=>{
 const data=await fixture();const app=await data.launch();const page=await app.firstWindow();
 try {
  await expect(page.locator('.sidebar .chat-row')).toHaveCount(5);
  await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('harbor:create');ipcMain.handle('harbor:create',(_event,input)=>{(globalThis as any).createdInput=input;return {id:'new',...input};});});
  await page.keyboard.press('Meta+n');await expect(page.getByLabel('Chat name',{exact:true})).toBeFocused();await page.keyboard.press('Enter');await expect(page.getByRole('dialog')).toHaveCount(0);expect(await app.evaluate(()=>(globalThis as any).createdInput.launcher)).toBe('codex');
  await page.keyboard.press('Meta+n');const chatDialog=page.getByRole('dialog',{name:'New chat',exact:true});await expect(chatDialog.locator('.launcher-options kbd')).toHaveText(['⌘1','⌘2','⌘3']);
  await page.keyboard.press('Meta+2');await expect(page.getByRole('button',{name:'Claude Code',exact:true})).toHaveClass('selected');await expect(page.getByLabel('Chat name',{exact:true})).toBeFocused();
  await page.keyboard.press('Meta+3');await expect(page.getByRole('button',{name:'Terminal',exact:true})).toHaveClass('selected');
  await page.keyboard.press('Meta+1');await expect(page.getByRole('button',{name:'Codex',exact:true})).toHaveClass('selected');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('harbor:tab-shortcut',3));await expect(page.getByRole('button',{name:'Terminal',exact:true})).toHaveClass('selected');
  await page.keyboard.press('Meta+9');await expect(page.getByRole('button',{name:'Terminal',exact:true})).toHaveClass('selected');
  await page.keyboard.press('Enter');await expect(page.getByRole('dialog')).toHaveCount(0);expect(await app.evaluate(()=>(globalThis as any).createdInput.launcher)).toBe('shell');
  await page.locator('.sidebar .chat-row').first().click();await expect(page.locator('[data-tab-id="chat-0"]')).toBeVisible();await page.locator('[data-tab-id="chat-0"] button').first().click({button:'middle'});await expect(page.locator('[data-tab-id="chat-0"]')).toHaveCount(0);
  await page.getByRole('button',{name:'Refresh all chats and status'}).click();await expect(page.getByRole('alert')).toContainText('up to date');
  await page.getByRole('button',{name:'Preferences',exact:true}).click();await page.getByRole('button',{name:'Projects',exact:true}).click();await expect(page.getByRole('button',{name:'Terminal',exact:true})).toHaveCount(0);
  const bounds=await page.locator('.preferences-modal').boundingBox();const size=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));expect(bounds!.x).toBeGreaterThan(0);expect(bounds!.y).toBeGreaterThan(0);expect(bounds!.width).toBeLessThan(size.width);expect(bounds!.height).toBeLessThan(size.height);
  await page.getByRole('checkbox',{name:'Visible',exact:true}).uncheck();await page.getByRole('button',{name:'Save preferences'}).click();await expect(page.locator('.sidebar .project-section')).toHaveCount(0);
  await page.getByRole('button',{name:'Preferences',exact:true}).click();await page.getByRole('button',{name:'Projects',exact:true}).click();await expect(page.getByRole('checkbox',{name:'Visible'})).not.toBeChecked();await page.screenshot({path:'test-results/screenshots/16-project-manager.png'});await page.getByRole('button',{name:'Delete project Workspace test'}).click();await page.getByRole('button',{name:'Save preferences'}).click();expect((await page.evaluate(()=>window.harbor.snapshot())).projects).toHaveLength(0);
 }finally{await app.close();}
});

test('Shift Enter and Control Enter send distinct modified Enter sequences for both agents',async()=>{
 const data=await fixture();const app=await data.launch();const page=await app.firstWindow();
 try {
  await expect(page.locator('.sidebar .chat-row')).toHaveCount(5);
  await app.evaluate(({ipcMain})=>{for(const channel of ['attach','input','detach','resize'])ipcMain.removeHandler('harbor:'+channel);ipcMain.handle('harbor:attach',()=>{});ipcMain.handle('harbor:detach',()=>{});ipcMain.handle('harbor:resize',()=>{});ipcMain.handle('harbor:input',(_event,id,text)=>{((globalThis as any).inputs??=[]).push({id,text});});});
  const snapshot=await page.evaluate(()=>window.harbor.snapshot());
  await app.evaluate(({BrowserWindow})=>{const contents=BrowserWindow.getAllWindows()[0].webContents;const send=contents.send.bind(contents);contents.send=(channel,...args)=>{if(channel==='harbor:snapshot-changed'&&(globalThis as any).keyboardSnapshot)args=[(globalThis as any).keyboardSnapshot];send(channel,...args);};});
  for(const launcher of ['codex','claude']){
   await app.evaluate(({BrowserWindow},{snapshot,launcher})=>{(globalThis as any).keyboardSnapshot={...snapshot,sessions:[{...snapshot.sessions[0],id:launcher,name:launcher,launcher,status:'running'}]};BrowserWindow.getAllWindows()[0].webContents.send('harbor:snapshot-changed',(globalThis as any).keyboardSnapshot);},{snapshot,launcher});
   await expect(page.locator('.sidebar .chat-row')).toHaveCount(1);await expect(page.locator('.sidebar .chat-row')).toContainText(launcher);
   await page.locator('.sidebar .chat-row').first().click();await expect(page.locator('.connection-label')).toHaveText('Connected');await page.keyboard.press('Shift+Enter');
   await expect.poll(()=>app.evaluate(()=>(globalThis as any).inputs?.at(-1))).toEqual({id:launcher,text:'\x1b[13;2u'});
   await page.keyboard.press('Control+Enter');
   await expect.poll(()=>app.evaluate(()=>(globalThis as any).inputs?.at(-1))).toEqual({id:launcher,text:'\x1b[13;5u'});
  }
  expect(await app.evaluate(()=>(globalThis as any).inputs.length)).toBe(4);
 }finally{await app.close();}
});

test('saved preview is readable without resuming and projects drag into a persistent order',async()=>{
 const data=await fixture();await mkdir(path.join(data.dir,'second'));const app=await data.launch();const page=await app.firstWindow();
 try {
  await expect(page.locator('.sidebar .chat-row')).toHaveCount(5);
  await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('harbor:chatPreview');ipcMain.handle('harbor:chatPreview',()=>({messageCount:12,messages:[{role:'user',text:'Please review the project changes.'},{role:'assistant',text:'The changes are ready for review.\nAll checks passed.'}]}));});
  await page.locator('.sidebar .chat-row').first().click();await expect(page.getByRole('region',{name:'Conversation preview'})).toContainText('12 messages');await expect(page.getByRole('region',{name:'Conversation preview'})).toContainText('All checks passed.');await page.screenshot({animations:'disabled',path:'test-results/screenshots/17-chat-preview.png'});
  await page.evaluate(cwd=>window.harbor.addProject({name:'Second project',host:'local',cwd}),path.join(data.dir,'second'));
  await page.getByRole('button',{name:'Preferences',exact:true}).click();await page.getByRole('button',{name:'Projects',exact:true}).click();await expect(page.getByRole('button',{name:'Projects',exact:true})).toHaveClass('active');
  const transfer=await page.evaluateHandle(()=>new DataTransfer());const rows=page.locator('.managed-project');await rows.nth(1).dispatchEvent('dragstart',{dataTransfer:transfer});await rows.first().dispatchEvent('dragover',{dataTransfer:transfer});await rows.first().dispatchEvent('drop',{dataTransfer:transfer});await transfer.dispose();await expect(rows.first()).toContainText('Second project');await page.screenshot({animations:'disabled',path:'test-results/screenshots/16-project-manager.png'});
  await page.getByRole('button',{name:'Save preferences'}).click();await expect(page.locator('.sidebar .project-name').first()).toHaveText('Second project');
  await expect(page.getByRole('dialog')).toHaveCount(0);await page.keyboard.press('Meta+r');await expect(page.getByRole('button',{name:'Refresh all chats and status'})).toBeDisabled();await expect(page.getByRole('alert')).toContainText('up to date',{timeout:30000});
 }finally{await app.close();}
});

test('each tab preserves its transcript scroll position',async()=>{
 const data=await fixture();const app=await data.launch();const page=await app.firstWindow();
 try {
  await expect(page.locator('.sidebar .chat-row')).toHaveCount(5);
  await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('harbor:chatPreview');ipcMain.handle('harbor:chatPreview',()=>({messageCount:4,messages:Array.from({length:4},(_,i)=>({role:'assistant',text:`Message ${i}\n`+'Saved line\n'.repeat(60)}))}));});
  await page.locator('.sidebar .chat-row').nth(0).click();await expect(page.locator('.chat-preview article')).toHaveCount(4);
  await page.locator('.closed-chat-panel').evaluate(node=>{node.scrollTop=400;});
  await expect.poll(()=>page.locator('.closed-chat-panel').evaluate(node=>node.scrollTop)).toBe(400);
  await page.locator('.sidebar .chat-row').nth(1).click();await expect(page.locator('.chat-preview article')).toHaveCount(4);
  await page.locator('.closed-chat-panel').evaluate(node=>{node.scrollTop=750;});
  await page.keyboard.press('Meta+1');await expect.poll(()=>page.locator('.closed-chat-panel').evaluate(node=>node.scrollTop)).toBe(400);
  await page.keyboard.press('Meta+2');await expect.poll(()=>page.locator('.closed-chat-panel').evaluate(node=>node.scrollTop)).toBe(750);
 }finally{await app.close();}
});

test('cost views show compact sidebar, rolling host and model totals, and lifetime chat metrics',async()=>{
 const f=await fixture();const app=await f.launch();const page=await app.firstWindow();
 try {
  await app.evaluate(({ipcMain})=>{
   const tokens=(n:number)=>({inputTokens:n-10,outputTokens:10,cacheReadTokens:20,cacheWriteTokens:0,totalTokens:n});
   const cost=(usd:number)=>({usd,estimated:1,recorded:0,unpriced:0,models:[{model:'gpt-6-astra',usd,estimated:1,recorded:0,unpriced:0}],days:[{day:'2026-09-17',model:'gpt-6-astra',usd,estimated:1,recorded:0,unpriced:0}]});
   const agent={agent:'codex',tokens:tokens(900),sessions:4,recordedSessions:4,periods:{day:{tokens:tokens(100),sessions:1,cost:cost(12.34)},week:{tokens:tokens(300),sessions:2,cost:cost(50)},month:{tokens:tokens(900),sessions:4,cost:cost(100)}}};
   ipcMain.removeHandler('harbor:usage');ipcMain.handle('harbor:usage',()=>[{hostId:'local',hostLabel:'This Mac',checkedAt:new Date().toISOString(),agents:[agent]},{hostId:'remote',hostLabel:'Research server',checkedAt:new Date().toISOString(),agents:[{...agent,agent:'claude'}]},{hostId:'offline',hostLabel:'Offline server',checkedAt:new Date().toISOString(),agents:[],error:'SSH connection timed out'}]);
   ipcMain.removeHandler('harbor:chatUsage');ipcMain.handle('harbor:chatUsage',()=>({tokens:tokens(900),compactionCount:3,subagents:2,cost:cost(8.42)}));
  });
  await page.reload();
  const sidebar=page.getByRole('button',{name:'Usage cost in the last 24 hours',exact:true});
  await expect(sidebar).toContainText('$24.68');expect((await sidebar.boundingBox())!.height).toBeLessThan(32);
  await page.locator('.sidebar .chat-row').first().click();const chat=page.getByLabel('Chat usage',{exact:true});await expect(chat).toContainText('3 recorded compactions');await expect(chat).toContainText('900 tokens');await expect(chat).toContainText('incl. 2 subagents');await expect(chat).toContainText('$8.42');await expect(chat.locator('select')).toHaveCount(0);
  await chat.getByRole('button',{name:'Chat total cost',exact:true}).click();await expect(page.getByRole('dialog',{name:'Chat total cost',exact:true})).toContainText('gpt-6-astra');await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'Chat total cost',exact:true})).toHaveCount(0);
  await page.screenshot({animations:'disabled',path:'test-results/screenshots/19-chat-usage.png'});
  await sidebar.click();const popover=page.getByRole('dialog',{name:'Usage cost',exact:true});await expect(popover).toBeVisible();await expect(popover).toContainText('gpt-6-astra');await expect(popover).not.toContainText('tokens');
  await popover.getByRole('button',{name:'Last week',exact:true}).click();await expect(popover.locator('.cost-popover-total')).toContainText('$100.00');await expect(sidebar).toContainText('$24.68');
  await page.screenshot({animations:'disabled',path:'test-results/screenshots/20-cost-popover.png'});
  await popover.getByRole('button',{name:'View detailed usage'}).click();await expect(page.locator('.cost-total')).toContainText('$24.68');await expect(page.locator('.cost-total')).toContainText('partial coverage');
  await page.getByRole('button',{name:'Last month',exact:true}).click();await expect(page.locator('.cost-total')).toContainText('$200.00');await expect(page.locator('.usage-panel')).toContainText('Rolling 30 days');await expect(page.locator('.usage-panel')).not.toContainText('tokens');
  await page.getByLabel('Group usage by').selectOption('model');await expect(page.locator('.cost-group')).toHaveCount(1);await expect(page.locator('.cost-group')).toContainText('gpt-6-astra');
  await page.getByLabel('Group usage by').selectOption('day');await expect(page.locator('.cost-group')).toContainText('2026-09-17');await expect(page.locator('.cost-unavailable')).toContainText('SSH connection timed out');
  const bounds=await page.getByRole('dialog',{name:'Preferences',exact:true}).boundingBox();const viewport=page.viewportSize()??await page.evaluate(()=>({width:innerWidth,height:innerHeight}));expect(bounds!.height).toBeLessThan(viewport.height);expect(bounds!.width).toBeLessThan(viewport.width);
  await page.screenshot({path:'test-results/screenshots/18-usage.png'});
 }finally{await app.close();}
});

test('terminal scrollback and attachment survive switching tabs and splits',async()=>{
 const data=await fixture(true);const app=await data.launch();const page=await app.firstWindow();
 const {Transport}=await import('../src/engine/transport');const transport=new Transport();const names:string[]=[];
 try {
  await expect(page.getByRole('button',{name:'New chat in Workspace test'})).toBeVisible();
  for(const i of [0,1]) {
   await app.evaluate(({BrowserWindow},id)=>BrowserWindow.getAllWindows()[0].webContents.send('harbor:open-session',id),`chat-${i}`);
   await page.getByRole('button',{name:'Reopen terminal',exact:true}).click();await expect(page.locator('.connection-label')).toHaveText('Connected');
   const session=(await page.evaluate(()=>window.harbor.snapshot())).sessions.find(s=>s.id===`chat-${i}`)!;names.push(session.tmuxName);
  }
  // Verify the actual xterm nodes survive tab changes and pane moves.
  await page.evaluate(()=>{const terminal=document.querySelector('.xterm')!;(window as any).secondTerminal=terminal;});
  await page.keyboard.press('Meta+1');await page.locator('.xterm-helper-textarea').focus();
  await app.evaluate(({BrowserWindow})=>{const text=Array.from({length:300},(_,i)=>`SCROLL_LINE_${i+1}\r\n`).join('');BrowserWindow.getAllWindows()[0].webContents.send('harbor:terminal',{id:'chat-0',type:'data',data:Buffer.from(text).toString('base64')});});
  await expect(page.locator('.xterm-rows')).toContainText('SCROLL_LINE_300');
  const surface=page.locator('.xterm-screen');await surface.hover();await page.mouse.wheel(0,-1800);

  await expect(page.locator('.xterm-rows')).not.toContainText('SCROLL_LINE_300');
  const before=await page.locator('.xterm-rows').innerText();await page.evaluate(()=>{(window as any).firstTerminal=document.querySelector('.xterm');});
  await page.keyboard.press('Meta+2');expect(await page.evaluate(()=>document.querySelector('.xterm')===(window as any).secondTerminal)).toBe(true);
  await page.keyboard.press('Meta+1');expect(await page.evaluate(()=>document.querySelector('.xterm')===(window as any).firstTerminal)).toBe(true);
  await expect(page.locator('.xterm-rows')).toHaveText(before,{useInnerText:true});
  await split(page,'chat-1','chat-0','right');expect(await page.evaluate(()=>document.querySelector('[data-session-id="chat-0"] .xterm')===(window as any).firstTerminal)).toBe(true);
  await expect(page.locator('[data-session-id="chat-0"] .xterm-rows')).not.toContainText('SCROLL_LINE_300');
  await page.locator('[data-session-id="chat-0"] .terminal-surface').click();await expect(page.locator('.tab.active')).toHaveAttribute('data-tab-id','chat-0');
  await page.locator('[data-session-id="chat-1"] .terminal-surface').click();await expect(page.locator('.tab.active')).toHaveAttribute('data-tab-id','chat-1');
 }finally{await app.close();for(const name of names)await transport.run('local',transport.setup()+transport.tmux(['kill-session','-t',`=${name}`])).catch(()=>{});}
});

test('closed chat filter persists and launch commands can be inspected without starting a chat',async()=>{
 const data=await fixture();const app=await data.launch();const page=await app.firstWindow();
 try {
  await expect(page.locator('.sidebar .chat-row')).toHaveCount(5);
  await page.locator('.sidebar .chat-row').first().click();
  await page.getByRole('switch',{name:'Hide all closed chats'}).check();
  await expect(page.locator('.sidebar .chat-row')).toHaveCount(0);
  await expect(page.locator('.tab.active')).toHaveAttribute('data-tab-id','chat-0');
  await page.reload();await expect(page.getByRole('switch',{name:'Hide all closed chats'})).toBeChecked();await expect(page.locator('.sidebar .chat-row')).toHaveCount(0);
  await page.getByRole('switch',{name:'Hide all closed chats'}).uncheck();await expect(page.locator('.sidebar .chat-row')).toHaveCount(5);
  await page.getByRole('button',{name:'Chat actions'}).click();await page.getByRole('menuitem',{name:'View launch command…'}).click();
  await expect(page.getByRole('dialog',{name:'Launch command',exact:true})).toContainText('not recorded');await page.keyboard.press('Escape');
  await page.locator('.sidebar .chat-row').nth(1).click();
  await page.getByRole('button',{name:'Chat actions'}).click();await page.getByRole('menuitem',{name:'View launch command…'}).click();
  await expect(page.getByLabel('Original launch command',{exact:true})).toHaveValue('codex --sandbox read-only');await expect(page.getByLabel('Latest launch command',{exact:true})).toHaveValue("codex resume 'example-id'");
  await page.getByRole('button',{name:'Copy original launch command'}).click();await expect(page.getByRole('status')).toHaveText('Command copied.');
  expect(await app.evaluate(({clipboard})=>clipboard.readText())).toBe('codex --sandbox read-only');
  await page.screenshot({path:'test-results/screenshots/21-launch-command.png'});
 }finally{await app.close();}
});

test('control letters reach the terminal while Command shortcuts and Control-Tab stay in Harbor',async()=>{
 const data=await fixture();const app=await data.launch();const page=await app.firstWindow();
 try {
  await expect(page.locator('.sidebar .chat-row')).toHaveCount(5);
  const snapshot=await page.evaluate(()=>window.harbor.snapshot());
  snapshot.sessions.slice(0,2).forEach(session=>{session.status='running';});
  await app.evaluate(({ipcMain,BrowserWindow},snapshot)=>{
   (globalThis as any).shortcutInputs=[];(globalThis as any).shortcutActions=[];
   ipcMain.removeHandler('harbor:snapshot');ipcMain.handle('harbor:snapshot',()=>snapshot);
   ipcMain.removeHandler('harbor:importHistory');ipcMain.handle('harbor:importHistory',()=>{});
   for(const channel of ['attach','input','detach','resize','terminate','refresh']){
    ipcMain.removeHandler('harbor:'+channel);
    ipcMain.handle('harbor:'+channel,(_event,_id,text)=>{
     if(channel==='input')(globalThis as any).shortcutInputs.push(text);
     if(channel==='terminate'||channel==='refresh')(globalThis as any).shortcutActions.push(channel);
    });
   }
   const contents=BrowserWindow.getAllWindows()[0].webContents;
   const send=contents.send.bind(contents);
   contents.send=(channel,...args)=>send(channel,...(channel==='harbor:snapshot-changed'?[snapshot]:args));
   contents.send('harbor:snapshot-changed',snapshot);
  },snapshot);
  for(const index of [0,1])await page.locator('.sidebar .chat-row').nth(index).click();
  await expect(page.locator('.tab.active')).toHaveAttribute('data-tab-id','chat-1');
  await page.locator('.workspace-pane .xterm-helper-textarea').focus();
  for(const key of ['t','n','k','f','w','r'])await page.keyboard.press('Control+'+key);
  await expect.poll(()=>app.evaluate(()=>(globalThis as any).shortcutInputs)).toEqual(['\x14','\x0e','\x0b','\x06','\x17','\x12']);
  expect(await app.evaluate(()=>(globalThis as any).shortcutActions)).toEqual([]);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.workspace-pane .xterm-helper-textarea')).toBeFocused();
  await page.keyboard.press('Control+Shift+Tab');await expect(page.locator('.tab.active')).toHaveAttribute('data-tab-id','chat-0');
  await page.keyboard.press('Control+Tab');await expect(page.locator('.tab.active')).toHaveAttribute('data-tab-id','chat-1');
  await page.keyboard.press('Meta+t');await expect(page.getByRole('dialog',{name:'New chat',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Close dialog'}).click();
  await page.locator('.workspace-pane .xterm-helper-textarea').focus();
  await page.keyboard.press('Meta+r');await expect.poll(()=>app.evaluate(()=>(globalThis as any).shortcutActions)).toEqual(['refresh']);
  await expect(page.getByRole('button',{name:'Refresh all chats and status'})).toBeEnabled();
  await expect(page.locator('.workspace-pane .connection-label')).toHaveText('Connected');
  await page.locator('.workspace-pane .xterm-helper-textarea').focus();
  await page.keyboard.press('Meta+w');await expect.poll(()=>app.evaluate(()=>(globalThis as any).shortcutActions)).toEqual(['refresh','terminate']);
  expect(await app.evaluate(()=>(globalThis as any).shortcutInputs)).toEqual(['\x14','\x0e','\x0b','\x06','\x17','\x12']);
 }finally{await app.close();}
});

test('native file drops pass disk paths through preload and command arrows send one control per key',async()=>{
 const data=await fixture();const app=await data.launch();const page=await app.firstWindow();
 try {
  await expect(page.locator('.sidebar .chat-row')).toHaveCount(5);
  await app.evaluate(({ipcMain})=>{for(const channel of ['attach','input','detach','resize','dropFiles'])ipcMain.removeHandler('harbor:'+channel);ipcMain.handle('harbor:attach',()=>{});ipcMain.handle('harbor:detach',()=>{});ipcMain.handle('harbor:resize',()=>{});ipcMain.handle('harbor:input',(_event,id,text)=>{((globalThis as any).inputs??=[]).push({id,text});});ipcMain.handle('harbor:dropFiles',(_event,id,paths)=>{(globalThis as any).drop={id,paths};});});
  const snapshot=await page.evaluate(()=>window.harbor.snapshot());
  await app.evaluate(({BrowserWindow},snapshot)=>{snapshot.sessions[0].status='running';BrowserWindow.getAllWindows()[0].webContents.send('harbor:snapshot-changed',snapshot);},snapshot);
  await page.locator('.sidebar .chat-row').first().click();await expect(page.locator('.connection-label')).toHaveText('Connected');
  await page.keyboard.press('Meta+ArrowLeft');await page.keyboard.press('Meta+ArrowRight');
  expect(await app.evaluate(()=>(globalThis as any).inputs)).toEqual([{id:'chat-0',text:'\x01'},{id:'chat-0',text:'\x05'}]);
  const paths=[path.join(data.dir,"a file's name.txt"),path.join(data.dir,'日本語.png')];for(const file of paths)await writeFile(file,'test');
  await page.evaluate(()=>{const input=document.createElement('input');input.type='file';input.multiple=true;input.id='native-drop-fixture';document.body.append(input);});
  await page.locator('#native-drop-fixture').setInputFiles(paths);
  await page.evaluate(()=>{const input=document.querySelector<HTMLInputElement>('#native-drop-fixture')!;const transfer=new DataTransfer();for(const file of input.files!)transfer.items.add(file);const surface=document.querySelector('.terminal-surface')!;surface.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer}));surface.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));input.remove();});
  await expect.poll(()=>app.evaluate(()=>(globalThis as any).drop)).toEqual({id:'chat-0',paths});
  await expect(page.locator('.xterm-helper-textarea')).toBeFocused();await expect(page.getByRole('status')).toHaveCount(0);
 }finally{await app.close();}
});

test('agent status icons distinguish working, attention, completion and errors; closed filter is a sliding switch',async()=>{
 const data=await fixture();const app=await data.launch();const page=await app.firstWindow();
 try {
  await expect(page.locator('.sidebar .chat-row')).toHaveCount(5);
  const snapshot=await page.evaluate(()=>window.harbor.snapshot());
  const activities=['starting','working','attention','background','idle','error','closed','unknown','idle'];
  snapshot.sessions=snapshot.sessions.slice(0,9).map((s,i)=>({...s,status:i===6||i===8?'closed':i===7?'unreachable':'running',activity:activities[i] as any,completedAt:i===4?100:undefined,externalActive:i===8,hasMessages:true}));
  await app.evaluate(({BrowserWindow,ipcMain},snapshot)=>{
   ipcMain.removeHandler('harbor:snapshot');ipcMain.handle('harbor:snapshot',()=>snapshot);
   const contents=BrowserWindow.getAllWindows()[0].webContents;const send=contents.send.bind(contents);contents.send=(channel,...args)=>send(channel,...(channel==='harbor:snapshot-changed'?[snapshot]:args));contents.send('harbor:snapshot-changed',snapshot);
  },snapshot);
  await page.getByRole('button',{name:'Show more (4)',exact:true}).click();
  const labels=['Starting','Working','Needs input or approval','Waiting on background work','Turn finished — waiting for next prompt','Agent error','Closed','Status unavailable','Running elsewhere'];
  for(const label of labels)await expect(page.locator('.sidebar').getByRole('img',{name:label,exact:true})).toBeVisible();
  await expect(page.locator('.sidebar .chat-activity.working svg')).toHaveClass(/spin/);
  await page.screenshot({path:'test-results/screenshots/22-agent-statuses.png'});
  // Closed chats draw no glyph but keep an empty, labelled slot the same width as other status icons.
  const closedIcon=page.locator('.sidebar .chat-activity.closed');await expect(closedIcon).toHaveCount(1);await expect(closedIcon.locator('svg')).toHaveCount(0);
  await expect(closedIcon).toHaveAttribute('title','Closed');
  const iconBox=async(name:string)=>(await page.locator('.sidebar .chat-row').filter({hasText:new RegExp(`^${name}`)}).locator('.chat-activity').boundingBox())!;
  const closedBox=await iconBox('Chat 7'),idleBox=await iconBox('Chat 5');expect(closedBox.width).toBe(idleBox.width);expect(Math.abs(closedBox.x-idleBox.x)).toBeLessThan(1);
  await page.locator('.sidebar .chat-row').filter({hasText:/^Chat 7/}).click();await page.locator('.sidebar .chat-row').filter({hasText:/^Chat 6/}).click();
  await expect(page.locator('[data-tab-id="chat-6"] .chat-activity.closed')).toHaveCount(1);await expect(page.locator('[data-tab-id="chat-6"] .chat-activity svg')).toHaveCount(0);
  await expect(page.locator('[data-tab-id="chat-5"] .chat-activity.error svg')).toHaveCount(1);
  await page.screenshot({path:'test-results/screenshots/22b-closed-chat-no-icon.png'});
  await page.getByRole('button',{name:'Preferences',exact:true}).first().click();await page.getByRole('button',{name:'Icon guide',exact:true}).click();
  const closedGuide=page.locator('.icon-guide-row').filter({hasText:'Closed'});await expect(closedGuide.locator('svg')).toHaveCount(0);await expect(closedGuide).toContainText('No icon.');
  await expect(page.locator('.icon-guide-row svg')).toHaveCount(9);
  await page.screenshot({path:'test-results/screenshots/22c-icon-guide-closed.png'});
  await page.keyboard.press('Escape');await expect(page.locator('.icon-guide')).toHaveCount(0);
  const toggle=page.getByRole('switch',{name:'Hide all closed chats'});await toggle.focus();await page.keyboard.press('Space');await expect(toggle).toBeChecked();
  await expect(page.locator('.sidebar .chat-row')).toHaveCount(8);await expect(page.locator('.sidebar').getByRole('img',{name:'Running elsewhere',exact:true})).toBeVisible();
  await expect(page.locator('.toggle-track').first()).toHaveCSS('border-radius','12px');await expect(page.locator('.toggle-track > span').first()).toHaveCSS('transform','matrix(1, 0, 0, 1, 14, 0)');
  await page.screenshot({path:'test-results/screenshots/23-closed-chat-switch.png'});
 }finally{await app.close();}
});
