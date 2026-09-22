import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Transport, quote } from '../src/engine/transport';

for(const host of ['local',...(process.env.HARBOR_TEST_SSH?[process.env.HARBOR_TEST_SSH]:[])])for(const launcher of ['codex','claude'] as const){
 test(`${launcher} on ${host}: real colors, delete line, automatic title, exact resume, and external history`,async()=>{
  test.skip(!process.env.HARBOR_TEST_AGENTS,'Set HARBOR_TEST_AGENTS=1 for real CLI integration tests.');test.setTimeout(150000);
  const dir=await mkdtemp(path.join(tmpdir(),'harbor-chat-agent-'));const transport=new Transport();let app=await electron.launch({executablePath:process.env.HARBOR_TEST_APP,args:process.env.HARBOR_TEST_APP?[]:['.'],env:{...process.env,HARBOR_DATA_DIR:dir,NO_COLOR:'1'}});let page=await app.firstWindow();await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});});let sessionId:string|undefined;const names=new Set<string>();
  const cwd=host==='local'?dir:`~/harbor-smoke-test-20260916/project-${randomUUID()}`;
  if(host!=='local')await transport.run(host,transport.setup()+`mkdir -p "$HOME"/${quote(cwd.slice(2))}`);
  try{
   if(host!=='local')await page.evaluate(async host=>{const p=(await window.harbor.snapshot()).preferences;p.hosts.push({id:host,label:host,source:'manual',enabled:true,defaultDirectory:'~',connection:{target:host}});await window.harbor.savePreferences(p);},host);
   const project=await page.evaluate(input=>window.harbor.addProject(input),{name:'Agent integration',host,cwd});
   await page.getByRole('button',{name:'New chat in Agent integration',exact:true}).click();await page.getByRole('button',{name:launcher==='codex'?'Codex':'Claude Code',exact:true}).click();await page.getByLabel('Permission mode',{exact:true}).selectOption('full-access');await page.getByRole('button',{name:'Create chat',exact:true}).click();await expect(page.locator('.connection-label')).toHaveText('Connected',{timeout:30000});
   let session=(await page.evaluate(()=>window.harbor.snapshot())).sessions[0];sessionId=session.id;names.add(session.tmuxName);expect(session.permissionMode).toBe('full-access');
   const capture=()=>transport.run(host,transport.setup()+transport.tmux(['capture-pane','-p','-e','-t',session.paneId]));
   await expect.poll(capture,{timeout:30000}).toMatch(launcher==='codex'?/OpenAI Codex|Welcome to Codex|Update available!/:/Claude Code|Accessing workspace/);
   let screen=await capture();
   if(screen.includes('Update available!')){await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');}
   if(launcher==='claude'){await expect.poll(capture,{timeout:20000}).toMatch(/Yes, I trust this folder|bypass permissions on/);screen=await capture();}
   if(launcher==='claude'&&screen.includes('Yes, I trust this folder')){
    // Only the fresh, empty test directory is trusted; never change the user's other workspaces.
    await page.locator('.xterm-helper-textarea').focus();
    const clean=screen.replace(/\x1b\[[0-9;]*m/g,'');const selected=clean.split('\n').find(line=>/[❯›>]/.test(line)&&/Yes|No/.test(line));
    if(!selected?.includes('Yes'))await page.keyboard.press('ArrowDown');await expect.poll(async()=>(await capture()).replace(/\x1b\[[0-9;]*m/g,'')).toMatch(/[❯›>] Yes, I trust this folder/);await page.keyboard.press('Enter');
   }
   await expect.poll(async()=>{await page.evaluate(()=>window.harbor.refresh());return (await page.evaluate(()=>window.harbor.snapshot())).sessions[0].activity;},{timeout:30000}).toBe('idle');
   await page.locator('.xterm-helper-textarea').focus();await page.keyboard.type('DELETE_ME_WITH_COMMAND_BACKSPACE',{delay:20});await page.keyboard.press('Meta+Backspace');await expect.poll(capture).not.toContain('DELETE_ME_WITH_COMMAND_BACKSPACE');
   await page.keyboard.type('Reply only HARBOR_PROJECT_OK. Do not use tools or modify files.',{delay:20});
   await expect.poll(capture).toContain('HARBOR_PROJECT_OK');await page.keyboard.press('Enter');
   // Agent paste heuristics can defer Enter immediately after a typed burst.
   await expect.poll(async()=>{await page.evaluate(()=>window.harbor.refresh());return (await page.evaluate(()=>window.harbor.snapshot())).sessions[0].activity;},{timeout:45000}).toMatch(/working|idle/);
   await expect.poll(async()=>{
    const out=await capture();return (out.match(/HARBOR_PROJECT_OK/g)||[]).length;
   },{timeout:60000}).toBeGreaterThanOrEqual(2);
   await expect.poll(async()=>{await page.evaluate(()=>window.harbor.refresh());return (await page.evaluate(()=>window.harbor.snapshot())).sessions[0].name;},{timeout:30000}).not.toBe('New chat');
   session=(await page.evaluate(()=>window.harbor.snapshot())).sessions[0];expect(session.conversationId).toMatch(/^[a-f0-9-]{36}$/);const identity=session.conversationId;const name=session.name;
   screen=await capture();expect(/\x1b\[(?:38;[25];|3[1-6]m)/.test(screen)).toBeTruthy();await mkdir('test-results/screenshots',{recursive:true});await page.screenshot({animations:'disabled',path:`test-results/screenshots/project-${launcher}-${host}.png`});
   await page.evaluate(id=>window.harbor.terminate(id),session.id);await expect(page.locator('.closed-chat-panel')).toBeVisible();await page.getByRole('button',{name:'Resume chat',exact:true}).click();await expect(page.locator('.connection-label')).toHaveText('Connected',{timeout:30000});
   const previous=session;session=(await page.evaluate(()=>window.harbor.snapshot())).sessions[0];names.add(session.tmuxName);expect(session.tmuxName).not.toBe(previous.tmuxName);expect(session.conversationId).toBe(identity);await expect.poll(capture,{timeout:30000}).toContain('HARBOR_PROJECT_OK');
   await page.screenshot({animations:'disabled',path:`test-results/screenshots/project-${launcher}-${host}-resumed.png`});
   await page.evaluate(id=>window.harbor.terminate(id),session.id);await app.close();
   // A fresh Harbor index must discover and resume history made outside that index.
   const importedDir=await mkdtemp(path.join(tmpdir(),'harbor-import-ui-'));app=await electron.launch({executablePath:process.env.HARBOR_TEST_APP,args:process.env.HARBOR_TEST_APP?[]:['.'],env:{...process.env,HARBOR_DATA_DIR:importedDir}});page=await app.firstWindow();await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});});
   if(host!=='local')await page.evaluate(async host=>{const p=(await window.harbor.snapshot()).preferences;p.hosts.push({id:host,label:host,source:'manual',enabled:true,defaultDirectory:'~',connection:{target:host}});await window.harbor.savePreferences(p);},host);
   await page.evaluate(input=>window.harbor.addProject(input),{name:'Imported project',host,cwd});const imported=(await page.evaluate(()=>window.harbor.snapshot())).sessions.find(s=>s.conversationId===identity)!;expect(imported).toBeTruthy();expect(imported.name.length).toBeGreaterThan(0);expect(imported.name).not.toBe('New chat');expect(imported.imported).toBe(true);
   await expect.poll(async()=>{await page.evaluate(id=>window.harbor.importHistory(id),imported.projectId!);return (await page.evaluate(()=>window.harbor.snapshot())).sessions.find(s=>s.id===imported.id)?.externalActive;},{timeout:20000}).toBe(false);
   await page.locator('.sidebar .chat-row').filter({hasText:imported.name}).first().click();await page.getByRole('button',{name:'Resume chat',exact:true}).click();await expect(page.locator('.connection-label')).toHaveText('Connected',{timeout:30000});session=(await page.evaluate(()=>window.harbor.snapshot())).sessions.find(s=>s.id===imported.id)!;sessionId=session.id;names.add(session.tmuxName);await expect.poll(capture,{timeout:30000}).toContain('HARBOR_PROJECT_OK');
  }finally{
   try{if(sessionId)await page.evaluate(id=>window.harbor.terminate(id),sessionId);}catch{}await app.close().catch(()=>{});
   for(const name of names)await transport.run(host,transport.setup()+transport.tmux(['kill-session','-t',`=${name}`])).catch(()=>{});
  }
 });
}
