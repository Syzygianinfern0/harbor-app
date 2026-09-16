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
  await expect.poll(async()=> (await transport.run('local',transport.setup()+transport.tmux(['display-message','-p','-t',session.paneId,'#{bracket_paste_flag}']))).trim()).toBe('1');
  await page.locator('.xterm-helper-textarea').focus();await page.keyboard.type('DELETE_THIS_LINE');await page.keyboard.press('Meta+Backspace');await page.keyboard.type("printf 'SHORTCUT_%s\\n' OK");await page.keyboard.press('Enter');
  await expect.poll(()=>transport.run('local',transport.setup()+transport.tmux(['capture-pane','-p','-t',session.paneId]))).toContain('SHORTCUT_OK');
  const bounds=await page.locator('.terminal-pane').boundingBox();expect(bounds!.y).toBeLessThan(46);
  await page.keyboard.press('Meta+b');await page.mouse.move(700,400);expect((await page.locator('.terminal-pane').boundingBox())!.x).toBe(80);await page.locator('.sidebar-rail').hover({position:{x:40,y:200}});await expect(page.locator('.sidebar-dock')).toHaveClass(/is-peeking/);expect((await page.locator('.terminal-pane').boundingBox())!.x).toBe(80);await page.getByRole('button',{name:'Pin sidebar open'}).click();
  await page.locator('.sidebar .chat-row').click({button:'right'});await page.getByRole('menuitem',{name:'Rename chat…'}).click();await page.getByLabel('Name',{exact:true}).fill('A better name');await page.getByRole('button',{name:'Save name'}).click();await expect(page.locator('.sidebar .chat-title')).toHaveText('A better name');
  await page.locator('.sidebar .chat-row').click({button:'right'});await page.getByRole('menuitem',{name:'Pin chat',exact:true}).click();expect((await page.evaluate(()=>window.harbor.snapshot())).sessions[0].pinned).toBe(true);
  await page.locator('.sidebar .chat-row').click({button:'right'});await page.getByRole('menuitem',{name:'Close chat',exact:true}).click();await expect(page.locator('.sidebar .chat-row')).toHaveClass(/closed-chat/);await expect.poll(()=>page.evaluate(async()=>(await window.harbor.snapshot()).sessions[0].status)).toBe('closed');
  expect(await transport.run('local',transport.setup()+transport.tmux(['has-session','-t',`=${session.tmuxName}`])).then(()=>true,()=>false)).toBe(false);
  await page.locator('.sidebar .chat-row').click();await page.getByRole('button',{name:'Reopen terminal',exact:true}).click();await expect(page.locator('.connection-label')).toHaveText('Connected');const resumed=(await page.evaluate(()=>window.harbor.snapshot())).sessions[0];names.add(resumed.tmuxName);expect(resumed.tmuxName).not.toBe(session.tmuxName);
  await page.keyboard.press('Meta+n');await expect(page.getByRole('dialog',{name:'New chat',exact:true})).toContainText('UI project');await page.getByRole('button',{name:'Close dialog'}).click();
  await page.screenshot({animations:'disabled',path:'test-results/screenshots/10-projects.png'});
  const process=app.process();await app.evaluate(({app})=>{setTimeout(()=>app.quit(),0);});await expect.poll(()=>process.exitCode).toBe(0);app=await launch(dir);page=await app.firstWindow();await expect(page.locator('.connection-label')).toHaveText('Connected');await expect(page.locator('.sidebar .chat-title')).toHaveText('A better name');
 }finally{try{for(const s of (await page.evaluate(()=>window.harbor.snapshot())).sessions)names.add(s.tmuxName);}catch{}await app.close();for(const name of names)await transport.run('local',transport.setup()+transport.tmux(['kill-session','-t',`=${name}`])).catch(()=>{});}
});
test('preferences save selected hosts, notifications, hover settings, and show agent update results',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'harbor-preferences-ui-'));const app=await launch(dir);const page=await app.firstWindow();
 try{
  await page.getByRole('button',{name:'Preferences',exact:true}).click();await expect(page.getByRole('button',{name:'Close preferences'})).toBeFocused();
  await page.getByRole('button',{name:'Import from SSH config'}).click();const candidates=await page.evaluate(()=>window.harbor.sshCandidates());if(candidates.some(h=>h.id==='devbox')){await page.getByRole('checkbox',{name:'devbox',exact:true}).check();await page.getByRole('button',{name:'Import selected (1)',exact:true}).click();}else await page.getByRole('button',{name:'Back to hosts'}).click();
  await page.getByRole('button',{name:'Add manually'}).click();await page.getByLabel('Display name',{exact:true}).fill('Hidden test host');await page.getByLabel('SSH alias or address',{exact:true}).fill('example.invalid');await page.getByRole('checkbox',{name:'Show in launcher'}).uncheck();
  await page.getByRole('button',{name:'Notifications',exact:true}).click();await page.getByRole('checkbox',{name:'Enable desktop notifications'}).check();await page.getByRole('checkbox',{name:'Play a sound'}).uncheck();await page.getByRole('button',{name:'Sidebar',exact:true}).click();await page.getByRole('checkbox',{name:'Expand sidebar on hover'}).uncheck();await page.getByRole('button',{name:'Save preferences',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  const preferences=(await page.evaluate(()=>window.harbor.snapshot())).preferences;expect(preferences.notifications.enabled).toBe(true);expect(preferences.notifications.sound).toBe(false);expect(preferences.sidebar.expandOnHover).toBe(false);
  await page.getByRole('button',{name:'Preferences',exact:true}).click();await page.getByRole('button',{name:'Agent updates',exact:true}).click();await page.getByRole('button',{name:'Check for updates'}).click();await expect(page.locator('.updates-table')).toBeVisible({timeout:40000});await expect(page.locator('.updates-table')).toContainText('This Mac');await expect(page.locator('.updates-table')).not.toContainText('Hidden test host');await page.screenshot({animations:'disabled',path:'test-results/screenshots/11-agent-updates.png'});
 }finally{await app.close();}
});
