import { test, expect, _electron as electron, type Page } from '@playwright/test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Transport } from '../src/engine/transport';

// A private tmux server per run: never the user's `-L harbor` chats.
const socket=`harbor-e2e-${randomBytes(4).toString('hex')}`;const transport=new Transport(socket);
const launch=(dir:string)=>electron.launch({executablePath:process.env.HARBOR_TEST_APP,args:process.env.HARBOR_TEST_APP?[]:['.'],env:{...process.env,HARBOR_DATA_DIR:dir,HARBOR_TMUX_SOCKET:socket}});

// A stand-in full-screen agent: alternate screen plus SGR mouse tracking, counting wheel reports and arrow keys.
const tui=`import os,sys,tty,re
out=sys.argv[1];tty.setraw(0);os.write(1,b'\\x1b[?1049h\\x1b[?1000h\\x1b[?1006hTUI READY\\r\\n')
buf=b''
while True:
  buf+=os.read(0,4096);up=len(re.findall(rb'\\x1b\\[<64;\\d+;\\d+M',buf));down=len(re.findall(rb'\\x1b\\[<65;\\d+;\\d+M',buf));arrows=len(re.findall(rb'\\x1b[[O][AB]',buf))
  open(out,'w').write(f'{up} {down} {arrows}')
`;
const counts=async(file:string)=>(await readFile(file,'utf8').catch(()=>'0 0 0')).split(' ').map(Number);
const cellHeight=(page:Page)=>page.evaluate(()=>{const s=document.querySelector('.xterm-screen')!.getBoundingClientRect();const rows=document.querySelectorAll('.xterm-rows > div').length;return s.height/rows;});
async function scroll(page:Page,deltaY:number,times:number){const box=(await page.locator('.xterm-screen').boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);for(let i=0;i<times;i++){await page.mouse.wheel(0,deltaY);}}

test('wheel motion reaches a full-screen TUI one report per row, also after reattaching',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'harbor-wheel-'));const script=path.join(dir,'tui.py');const out=path.join(dir,'wheel.txt');await writeFile(script,tui);
 let app=await launch(dir);let page=await app.firstWindow();
 try{
  await page.evaluate(input=>window.harbor.addProject(input),{name:'Wheel',host:'local',cwd:dir});
  await page.getByRole('button',{name:'New chat in Wheel',exact:true}).click();await page.getByRole('button',{name:'Terminal',exact:true}).click();
  await page.getByRole('button',{name:'Create chat',exact:true}).click();await expect(page.locator('.connection-label')).toHaveText('Connected',{timeout:30000});
  const session=(await page.evaluate(()=>window.harbor.snapshot())).sessions[0];
  await expect.poll(async()=>(await transport.run('local',transport.setup()+transport.tmux(['display-message','-p','-t',session.paneId,'#{bracket_paste_flag}']))).trim(),{timeout:20000}).toBe('1');
  await page.locator('.xterm-helper-textarea').focus();await page.keyboard.type(`python3 ${script} ${out}`);await page.keyboard.press('Enter');
  await expect(page.locator('.xterm-rows')).toContainText('TUI READY',{timeout:10000});
  // Trackpad-sized deltas: xterm.js alone would send at most one damped report per event.
  const cell=await cellHeight(page);await scroll(page,-cell*1.5,10);
  await expect.poll(()=>counts(out)).toEqual([15,0,0]);
  await scroll(page,cell*4,3);
  await expect.poll(()=>counts(out)).toEqual([15,12,0]);
  // A fresh window attaches to the running TUI: tmux's mouse modes must be replayed, or the wheel turns into arrow keys.
  await app.close();app=await launch(dir);page=await app.firstWindow();
  await page.getByRole('tab').first().click().catch(()=>{});
  await expect(page.locator('.connection-label').first()).toHaveText('Connected',{timeout:30000});await expect(page.locator('.xterm-rows')).toContainText('TUI READY',{timeout:10000});
  await scroll(page,-cell*2,2);
  await expect.poll(()=>counts(out)).toEqual([19,12,0]);
 }finally{await app.close().catch(()=>{});await transport.run('local',transport.tmux(['kill-server'])).catch(()=>{});}
});
