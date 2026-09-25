import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { Transport, quote } from '../src/engine/transport';

// A private tmux server per run: never the user's `-L harbor` chats.
const socket=`harbor-e2e-${randomBytes(4).toString('hex')}`;const transport=new Transport(socket);
const launch=(dir:string)=>electron.launch({executablePath:process.env.HARBOR_TEST_APP,args:process.env.HARBOR_TEST_APP?[]:['.'],env:{...process.env,HARBOR_DATA_DIR:dir,HARBOR_TMUX_SOCKET:socket}});
const clip=(app:ElectronApplication)=>app.evaluate(({clipboard})=>clipboard.readText());
const setClip=(app:ElectronApplication,text:string)=>app.evaluate(({clipboard},text)=>clipboard.writeText(text),text);
async function chat(page:Page,host:string,cwd:string,launcher:'Terminal'|'Claude Code'){
 if(host!=='local')await page.evaluate(async host=>{const p=(await window.harbor.snapshot()).preferences;p.hosts.push({id:host,label:host,source:'manual',enabled:true,defaultDirectory:'~',connection:{target:host}});await window.harbor.savePreferences(p);},host);
 await page.evaluate(input=>window.harbor.addProject(input),{name:'Clipboard',host,cwd});
 await page.getByRole('button',{name:'New chat in Clipboard',exact:true}).click();await page.getByRole('button',{name:launcher,exact:true}).click();
 if(launcher!=='Terminal')await page.getByLabel('Permission mode',{exact:true}).selectOption('full-access');
 await page.getByRole('button',{name:'Create chat',exact:true}).click();await expect(page.locator('.connection-label')).toHaveText('Connected',{timeout:30000});
 const session=(await page.evaluate(()=>window.harbor.snapshot())).sessions[0];
 return {session,capture:()=>transport.run(host,transport.setup()+transport.tmux(['capture-pane','-p','-t',session.paneId]))};
}

test('OSC 52 writes reach the Mac clipboard; queries and oversized writes do not',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'harbor-clipboard-'));const app=await launch(dir);const page=await app.firstWindow();const saved=await clip(app);
 try{
  const {session,capture}=await chat(page,'local',dir,'Terminal');
  await expect.poll(async()=>(await transport.run('local',transport.setup()+transport.tmux(['display-message','-p','-t',session.paneId,'#{bracket_paste_flag}']))).trim(),{timeout:20000}).toBe('1');
  await setClip(app,'HARBOR_CLIPBOARD_BEFORE');await page.locator('.xterm-helper-textarea').focus();
  // Queries are swallowed: nothing is typed back into the shell, and the clipboard is unchanged.
  await page.keyboard.type(`printf '\\033]52;c;?\\007'; printf 'QUERY_%s\\n' DONE`);await page.keyboard.press('Enter');
  await expect.poll(capture).toContain('QUERY_DONE');await page.waitForTimeout(300);expect(await clip(app)).toBe('HARBOR_CLIPBOARD_BEFORE');
  await page.keyboard.type(`head -c 200000 /dev/zero | tr '\\0' a | base64 | tr -d '\\n' | { printf '\\033]52;c;'; cat; printf '\\007'; }`);await page.keyboard.press('Enter');
  await expect(page.locator('.toast').filter({hasText:'too large'})).toBeVisible();expect(await clip(app)).toBe('HARBOR_CLIPBOARD_BEFORE');
  const text='Copied ✓ from Harbor\nsecond line';
  await page.keyboard.type(`printf '\\033]52;c;${Buffer.from(text).toString('base64')}\\007'`);await page.keyboard.press('Enter');
  await expect.poll(()=>clip(app)).toBe(text);
 }finally{await setClip(app,saved).catch(()=>{});await app.close().catch(()=>{});await transport.run('local',transport.tmux(['kill-server'])).catch(()=>{});}
});

// Claude Code /copy: pbcopy on this Mac, OSC 52 over SSH (tmux control mode passes the raw sequence through).
for(const host of ['local',...(process.env.HARBOR_TEST_SSH?[process.env.HARBOR_TEST_SSH]:[])])test(`Claude Code /copy on ${host} reaches the Mac clipboard`,async()=>{
 test.skip(!process.env.HARBOR_TEST_AGENTS,'Set HARBOR_TEST_AGENTS=1 for real CLI integration tests.');test.setTimeout(150000);
 const dir=await mkdtemp(path.join(tmpdir(),'harbor-clipboard-agent-'));const app=await launch(dir);const page=await app.firstWindow();const saved=await clip(app);
 await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});});
 const cwd=host==='local'?dir:`~/harbor-copytest-20260924/project-${randomUUID()}`;
 if(host!=='local')await transport.run(host,transport.setup()+`mkdir -p "$HOME"/${quote(cwd.slice(2))}`);
 try{
  const {capture}=await chat(page,host,cwd,'Claude Code');
  await expect.poll(capture,{timeout:30000}).toMatch(/Yes, I trust this folder|bypass permissions on/);
  await page.locator('.xterm-helper-textarea').focus();
  if((await capture()).includes('Yes, I trust this folder')){await page.keyboard.press('ArrowDown');await expect.poll(capture).toMatch(/[❯›>] (\d\. )?Yes, I trust this folder/);await page.keyboard.press('Enter');}
  await expect.poll(capture,{timeout:30000}).toContain('bypass permissions on');await setClip(app,'HARBOR_CLIPBOARD_BEFORE');
  const token=`COPY_${host.replace(/\W/g,'')}_${randomBytes(3).toString('hex')}`;
  await page.keyboard.type(`Reply with exactly ${token} and nothing else. Do not use tools.`,{delay:15});await expect.poll(capture).toContain(token);await page.keyboard.press('Enter');
  await expect.poll(async()=>((await capture()).match(new RegExp(token,'g'))||[]).length,{timeout:60000}).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(1500);await page.keyboard.type('/copy',{delay:40});await page.waitForTimeout(500);await page.keyboard.press('Enter');
  await expect.poll(capture,{timeout:15000}).toContain('Copied to clipboard');await expect.poll(()=>clip(app),{timeout:10000}).toBe(token);
 }finally{
  await setClip(app,saved).catch(()=>{});await app.close().catch(()=>{});await transport.run(host,transport.tmux(['kill-server'])).catch(()=>{});
  if(host!=='local')await transport.run(host,`rm -rf -- "$HOME"/${quote(cwd.slice(2))}`).catch(()=>{});
 }
});
