import { test, expect, _electron as electron, type Page } from '@playwright/test';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Transport } from '../src/engine/transport';
const launch=(dir:string)=>electron.launch({executablePath:process.env.HARBOR_TEST_APP,args:process.env.HARBOR_TEST_APP?[]:['.'],env:{...process.env,HARBOR_DATA_DIR:dir}});
async function addProject(page:Page,dir:string){await page.getByRole('button',{name:'Add project',exact:true}).first().click();await page.getByLabel('Project directory',{exact:true}).fill(dir);await page.getByLabel('Project name',{exact:true}).fill('UI project');await page.getByRole('dialog').getByRole('button',{name:'Add project',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);}

test('project UI: contextual new chat, rename, pin, close/resume, shortcut, sidebar, and restart',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'harbor-project-ui-'));let app=await launch(dir);let page=await app.firstWindow();const names=new Set<string>();const transport=new Transport();
 try{
  await mkdir('test-results/screenshots',{recursive:true});await addProject(page,dir);
  await page.getByRole('button',{name:'New chat in UI project',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('UI project');await page.getByRole('button',{name:'Terminal',exact:true}).click();await page.getByLabel('Chat name',{exact:true}).fill('Check shortcuts');await page.getByRole('button',{name:'Create chat',exact:true}).click();
  await expect(page.locator('.connection-label')).toHaveText('Connected');const session=(await page.evaluate(()=>window.harbor.snapshot())).sessions[0];names.add(session.tmuxName);
  // A packaged app can take several seconds to initialize the user's login shell.
  await expect.poll(async()=> (await transport.run('local',transport.setup()+transport.tmux(['display-message','-p','-t',session.paneId,'#{bracket_paste_flag}']))).trim(),{timeout:20000}).toBe('1');
  await page.locator('.xterm-helper-textarea').focus();await page.keyboard.type('DELETE_THIS_LINE');await page.keyboard.press('Meta+Backspace');await page.keyboard.type("printf 'SHORTCUT_%s\\n' OK");await page.keyboard.press('Enter');
  await expect.poll(()=>transport.run('local',transport.setup()+transport.tmux(['capture-pane','-p','-t',session.paneId]))).toContain('SHORTCUT_OK');
  const bounds=await page.locator('.terminal-pane').boundingBox();expect(bounds!.y).toBeLessThan(46);
  await page.keyboard.press('Meta+b');await page.mouse.move(700,400);expect((await page.locator('.terminal-pane').boundingBox())!.x).toBe(112);await page.locator('.sidebar-rail').hover({position:{x:40,y:200}});await expect(page.locator('.sidebar-dock')).toHaveClass(/is-peeking/);expect((await page.locator('.terminal-pane').boundingBox())!.x).toBe(112);
  // The title-bar strip under the peeking sidebar must not be a drag region, and a brief exit (as macOS drag regions cause) must not hide it.
  const appRegion=(selector:string)=>page.locator(selector).first().evaluate(e=>getComputedStyle(e).getPropertyValue('-webkit-app-region'));expect(await appRegion('.sidebar .traffic-spacer')).toBe('no-drag');expect(await appRegion('.session-toolbar')).toBe('no-drag');
  await page.mouse.move(700,20);await page.waitForTimeout(120);await page.getByRole('button',{name:'Pin sidebar open'}).hover();await page.waitForTimeout(400);await expect(page.locator('.sidebar-dock')).toHaveClass(/is-peeking/);
  await page.mouse.move(700,400);await expect(page.locator('.sidebar-dock')).not.toHaveClass(/is-peeking/);expect(await appRegion('.session-toolbar')).toBe('drag');
  // Moving straight onto the rail's Expand button restores the sidebar without the peek covering it.
  const expand=page.getByRole('button',{name:'Expand sidebar',exact:true});await expand.hover();await page.waitForTimeout(300);await expect(page.locator('.sidebar-dock')).not.toHaveClass(/is-peeking/);await expand.click();await expect(page.locator('.sidebar-dock')).not.toHaveClass(/is-collapsed/);
  await page.keyboard.press('Meta+b');await page.locator('.sidebar-rail').hover({position:{x:40,y:200}});await expect(page.locator('.sidebar-dock')).toHaveClass(/is-peeking/);await page.getByRole('button',{name:'Pin sidebar open'}).click();
  await page.getByRole('button',{name:'Chat actions',exact:true}).click();await page.getByRole('menuitem',{name:'Rename chat…'}).click();await page.getByLabel('Name',{exact:true}).fill('A better name');await page.getByRole('button',{name:'Save name'}).click();await expect(page.locator('.sidebar .chat-row')).toHaveCount(1);await expect(page.locator('.sidebar .chat-row')).toContainText('A better name');await expect(page.locator('.sidebar .chat-row').getByRole('img')).toHaveCount(0);
  await page.getByRole('button',{name:'Chat actions',exact:true}).click();await page.getByRole('menuitem',{name:'Pin chat',exact:true}).click();expect((await page.evaluate(()=>window.harbor.snapshot())).sessions[0].pinned).toBe(true);
  await app.evaluate(({dialog})=>{dialog.showMessageBox=(async(...args:any[])=>{(globalThis as any).cancelledClose=args.at(-1);return {response:0,checkboxChecked:false};}) as any;});await page.keyboard.press('Meta+w');await expect.poll(()=>app.evaluate(()=>{const o=(globalThis as any).cancelledClose;return o&&{defaultId:o.defaultId,cancelId:o.cancelId,buttons:o.buttons};})).toEqual({defaultId:1,cancelId:0,buttons:['Cancel','Close chat']});await expect(page.locator('.connection-label')).toHaveText('Connected');await expect(page.getByRole('button',{name:'Close chat A better name',exact:true})).toBeEnabled();await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});});await page.getByRole('button',{name:'Close chat A better name',exact:true}).click();await expect(page.locator('.sidebar .chat-row')).toHaveCount(0);await expect.poll(()=>page.evaluate(async()=>(await window.harbor.snapshot()).sessions[0].status)).toBe('closed');
  expect(await transport.run('local',transport.setup()+transport.tmux(['has-session','-t',`=${session.tmuxName}`])).then(()=>true,()=>false)).toBe(false);
  await app.evaluate(({BrowserWindow},id)=>BrowserWindow.getAllWindows()[0].webContents.send('harbor:open-session',id),session.id);await page.getByRole('button',{name:'Reopen terminal',exact:true}).click();await expect(page.locator('.connection-label')).toHaveText('Connected');const resumed=(await page.evaluate(()=>window.harbor.snapshot())).sessions[0];names.add(resumed.tmuxName);expect(resumed.tmuxName).not.toBe(session.tmuxName);
  await page.keyboard.press('Meta+n');await expect(page.getByRole('dialog',{name:'New chat',exact:true})).toContainText('UI project');await page.getByRole('button',{name:'Close dialog'}).click();
  await page.screenshot({animations:'disabled',path:'test-results/screenshots/10-projects.png'});
  const process=app.process();await app.evaluate(({app})=>{setTimeout(()=>app.quit(),0);});await expect.poll(()=>process.exitCode).toBe(0);app=await launch(dir);page=await app.firstWindow();await expect(page.locator('.connection-label')).toHaveText('Connected');await expect(page.locator('.sidebar .chat-row')).toHaveCount(1);await expect(page.locator('.sidebar .chat-row').getByRole('img')).toHaveCount(0);
 }finally{try{for(const s of (await page.evaluate(()=>window.harbor.snapshot())).sessions)names.add(s.tmuxName);}catch{}await app.close();for(const name of names)await transport.run('local',transport.setup()+transport.tmux(['kill-session','-t',`=${name}`])).catch(()=>{});}
});
test('settings save remotes, notifications, hover settings as you go, and show agent update results',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'harbor-preferences-ui-'));const app=await launch(dir);const page=await app.firstWindow();
 const nav=(name:string)=>page.getByRole('navigation',{name:'Settings categories'}).getByRole('button',{name,exact:true});
 try{
  await page.getByRole('button',{name:'Settings',exact:true}).click();await expect(page.getByLabel('Search settings')).toBeFocused();
  await nav('Remotes').click();await page.getByRole('button',{name:'Import from SSH config'}).click();const candidates=await page.evaluate(()=>window.harbor.sshCandidates());const sshAlias=process.env.HARBOR_TEST_SSH;if(sshAlias&&candidates.some(h=>h.id===sshAlias)){await page.getByRole('checkbox',{name:sshAlias,exact:true}).check();await page.getByRole('button',{name:'Import selected (1)',exact:true}).click();await nav('Remotes').click();}else await page.getByRole('button',{name:'Back to remotes'}).click();
  await page.getByRole('button',{name:'Add manually'}).click();await page.getByLabel('Display name',{exact:true}).fill('Hidden test host');await page.getByLabel('SSH alias or address',{exact:true}).fill('example.invalid');await page.getByRole('checkbox',{name:'Show in launcher'}).uncheck();await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.getByRole('region',{name:'Unsaved changes'})).toHaveCount(0);
  await nav('Notifications').click();await page.getByRole('checkbox',{name:'Enable desktop notifications'}).check();await page.getByRole('checkbox',{name:'Play a sound'}).uncheck();await nav('General').click();await page.getByRole('checkbox',{name:'Expand sidebar on hover'}).uncheck();
  await expect.poll(async()=>{const p=(await page.evaluate(()=>window.harbor.snapshot())).preferences;return [p.notifications.enabled,p.notifications.sound,p.sidebar.expandOnHover,p.hosts.find(h=>h.label==='Hidden test host')?.enabled];}).toEqual([true,false,false,false]);
  await nav('Updates').click();await page.getByRole('button',{name:'Check for updates'}).click();await expect(page.locator('.updates-table')).toBeVisible({timeout:40000});await expect(page.locator('.updates-table')).toContainText('This Mac');await expect(page.locator('.updates-table')).not.toContainText('Hidden test host');await page.screenshot({animations:'disabled',path:'test-results/screenshots/11-agent-updates.png'});
 }finally{await app.close();}
});

test('project hierarchy, pagination, remote badges, and verified update feedback',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'harbor-hierarchy-'));
 const {writeFile}=await import('node:fs/promises');
 const createdAt=new Date().toISOString();
 const project={id:'fixture',name:'Video research',cwd:dir,hostId:'local',hostLabel:'This Mac',connection:'local',createdAt};
 const remote={...project,id:'remote',name:'Remote experiments',hostLabel:'devbox',connection:{target:'example.invalid'}};
 const sessions=Array.from({length:12},(_,i)=>({id:`chat-${i}`,tmuxName:`harbor-aaaa${i}`,paneId:`%${i}`,name:`Research conversation ${i+1}`,host:'local',cwd:dir,launcher:'codex',group:'',tags:[],pinned:false,archived:false,createdAt,updatedAt:new Date(Date.now()-i*1000).toISOString(),status:'closed',projectId:project.id}));
 await writeFile(path.join(dir,'sessions.json'),JSON.stringify({version:2,projects:[project,remote],sessions}));
 const app=await launch(dir);const page=await app.firstWindow();
 try {
  await expect(page.locator('.sidebar .chat-row')).toHaveCount(5);
  const heading=await page.locator('.project-name').first().boundingBox();const chat=await page.locator('.sidebar .chat-row').first().boundingBox();expect(chat!.x).toBeGreaterThan(heading!.x+10);
  await expect(page.locator('.project-host')).toHaveCount(1);await expect(page.locator('.project-host')).toContainText('devbox');await expect(page.locator('.host-dot')).toHaveClass(/unreachable/,{timeout:20000});
  await page.getByRole('button',{name:'Show more (7)',exact:true}).click();await expect(page.locator('.sidebar .chat-row')).toHaveCount(10);
  await page.getByRole('button',{name:'Show more (2)',exact:true}).click();await expect(page.locator('.sidebar .chat-row')).toHaveCount(12);
  await page.getByRole('button',{name:'Show fewer',exact:true}).click();await expect(page.locator('.sidebar .chat-row')).toHaveCount(5);
  await page.getByLabel('Search chats').fill('conversation 12');await expect(page.locator('.sidebar .chat-row')).toHaveCount(1);await expect(page.locator('.sidebar .chat-row')).toContainText('conversation 12');await page.getByLabel('Search chats').fill('');
  await mkdir('test-results/screenshots',{recursive:true});await page.screenshot({path:'test-results/screenshots/12-project-hierarchy.png'});
  await app.evaluate(({ipcMain})=>{
   const rows=[{hostId:'local',hostLabel:'This Mac',agent:'codex',installed:'1.0.0',latest:'1.1.0',status:'available',checkedAt:new Date().toISOString()},{hostId:'remote',hostLabel:'devbox',agent:'claude',installed:'2.0.0',latest:'2.1.0',status:'available',checkedAt:new Date().toISOString()}];
   ipcMain.removeHandler('harbor:checkUpdates');ipcMain.handle('harbor:checkUpdates',()=>rows);
   ipcMain.removeHandler('harbor:updateAgent');ipcMain.handle('harbor:updateAgent',(_event,hostId)=>{if(hostId==='remote')throw new Error('SSH connection lost');return {update:{...rows[0],installed:'1.1.0',status:'current'},output:'Updated successfully'};});
  });
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Updates',exact:true}).click();await page.getByRole('button',{name:'Check for updates',exact:true}).click();await expect(page.locator('.update-host')).toHaveCount(2);
  await page.getByRole('button',{name:'Update Codex',exact:true}).click();await expect(page.getByRole('status')).toContainText('Verified: 1.1.0');
  await page.getByRole('button',{name:'Update Claude Code',exact:true}).click();await expect(page.locator('.update-result').last()).toContainText('SSH connection lost');
  await page.screenshot({path:'test-results/screenshots/13-update-feedback.png'});
 }finally{await app.close();}
});
