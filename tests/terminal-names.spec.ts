import { test, expect, _electron as electron, type Page } from '@playwright/test';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Transport } from '../src/engine/transport';

// Real terminals on a private tmux server per run: never the user's `-L harbor` chats.
const socket=`harbor-names-${randomBytes(4).toString('hex')}`;const transport=new Transport(socket);
const row=(page:Page,name:string)=>page.locator('.sidebar .chat-row',{hasText:name});
const tabName=(page:Page,id:string)=>page.locator(`[data-tab-id="${id}"] .tab-name`);
async function newTerminal(page:Page){
  const before=new Set((await page.evaluate(()=>window.harbor.snapshot())).sessions.map(s=>s.id));
  await page.getByRole('button',{name:'New chat in Names',exact:true}).click();await page.getByRole('button',{name:'Terminal',exact:true}).click();
  await page.getByRole('button',{name:'Create chat',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(async()=>(await page.evaluate(()=>window.harbor.snapshot())).sessions.filter(s=>!before.has(s.id)).length).toBe(1);
  return (await page.evaluate(()=>window.harbor.snapshot())).sessions.find(s=>!before.has(s.id))!;
}

test('terminals are numbered per project, show their running command, and keep a rename',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'harbor-terminal-names-'));
  const app=await electron.launch({executablePath:process.env.HARBOR_TEST_APP,args:process.env.HARBOR_TEST_APP?[]:['.'],env:{...process.env,HARBOR_DATA_DIR:dir,HARBOR_TMUX_SOCKET:socket}});
  const page=await app.firstWindow();
  try {
    await mkdir('test-results/screenshots',{recursive:true});
    await page.evaluate(input=>window.harbor.addProject(input),{name:'Names',host:'local',cwd:dir});
    const one=await newTerminal(page);const two=await newTerminal(page);
    expect([one.name,two.name]).toEqual(['Terminal 1','Terminal 2']);
    await expect(tabName(page,one.id)).toHaveText(/^Terminal 1/);await expect(tabName(page,two.id)).toHaveText(/^Terminal 2/);

    // Once the shell is up, the status poll reports it as the foreground command.
    await expect(row(page,'Terminal 2')).toContainText(/Terminal 2 · \S+/,{timeout:20000});
    await page.locator(`[data-tab-id="${one.id}"] > button`).first().click();
    await expect.poll(async()=>(await transport.run('local',transport.setup()+transport.tmux(['display-message','-p','-t',one.paneId,'#{pane_current_command}']))).trim(),{timeout:20000}).not.toBe('');
    await page.locator('.xterm-helper-textarea').first().focus();await page.keyboard.type('sleep 30');await page.keyboard.press('Enter');
    await expect(row(page,'Terminal 1').locator('.terminal-command')).toHaveText(' · sleep',{timeout:10000});
    await expect(tabName(page,one.id)).toHaveText('Terminal 1 · sleep');
    await page.screenshot({path:'test-results/screenshots/81-terminal-names-command.png'});
    // Back at the prompt, the command is the shell again.
    await page.keyboard.press('Control+c');
    await expect(row(page,'Terminal 1').locator('.terminal-command')).not.toHaveText(' · sleep',{timeout:10000});

    // Closing Terminal 1 frees its number: Terminal 2 keeps its name and the next terminal is Terminal 1 again.
    await app.evaluate(({dialog})=>{dialog.showMessageBox=(async()=>({response:1,checkboxChecked:false})) as any;});
    await page.locator(`[data-tab-id="${one.id}"] .tab-close`).click();
    await expect(page.locator(`[data-tab-id="${one.id}"]`)).toHaveCount(0);
    const three=await newTerminal(page);expect(three.name).toBe('Terminal 1');
    await expect(tabName(page,two.id)).toHaveText(/^Terminal 2/);
    const four=await newTerminal(page);expect(four.name).toBe('Terminal 3');

    // A rename replaces the default name; the running command still shows beside it.
    await row(page,'Terminal 2').click({button:'right'});await page.getByRole('menuitem',{name:'Rename chat…'}).click();
    await page.getByRole('dialog').getByLabel('Name').fill('Build');await page.getByRole('dialog').getByLabel('Name').press('Enter');
    await expect(tabName(page,two.id)).toHaveText(/^Build · \S+$/);
    await expect(row(page,'Build')).toHaveCount(1);
    // The rename frees its number for the next terminal.
    expect((await newTerminal(page)).name).toBe('Terminal 2');
    await page.screenshot({path:'test-results/screenshots/82-terminal-names-renamed.png'});
  } finally { await app.close().catch(()=>{});await transport.run('local',transport.tmux(['kill-server'])).catch(()=>{}); }
});
