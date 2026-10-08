import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HarborEngine } from '../src/engine/engine';
import { Transport } from '../src/engine/transport';
import type { Session } from '../src/shared/types';
import { defaultTerminalName, needsTerminalNumber, nextTerminalNumber, terminalCommand } from '../src/shared/terminalName';

const term=(id:string,name:string,extra:Partial<Session>={}):Session=>({id,tmuxName:`harbor-${id}`,paneId:'%0',name,host:'local',cwd:'~',launcher:'shell',command:'',group:'',tags:[],pinned:false,archived:false,createdAt:'',updatedAt:'',status:'running',projectId:'p',nameSource:'auto',...extra});

test('a new terminal takes the lowest number no other open terminal of its project shows',()=>{
 assert.equal(nextTerminalNumber([],'p'),1);
 assert.equal(nextTerminalNumber([term('a','Terminal 1'),term('b','Terminal 3')],'p'),2);
 // Closed terminals, other projects and agent chats free or never hold a number; a renamed "Terminal 1" still holds it.
 assert.equal(nextTerminalNumber([term('a','Terminal 1',{status:'closed'}),term('b','Terminal 1',{projectId:'q'}),term('c','Terminal 1',{launcher:'codex'})],'p'),1);
 assert.equal(nextTerminalNumber([term('a','Terminal 1',{nameSource:'manual'})],'p'),2);
 assert.equal(nextTerminalNumber([term('a','Terminal 1')],'p','a'),1);
});

test('default names, including the old "New terminal", are told apart from names the user chose',()=>{
 assert.equal(defaultTerminalName(term('a','Terminal 2')),true);
 assert.equal(defaultTerminalName(term('a','New terminal')),true);
 assert.equal(defaultTerminalName(term('a','Terminal 2',{nameSource:'manual'})),false);
 assert.equal(defaultTerminalName(term('a','Build')),false);
 assert.equal(defaultTerminalName(term('a','Terminal 2',{launcher:'codex'})),false);
 // A reopened terminal is renumbered only when its number was taken meanwhile or it still has the old default.
 assert.equal(needsTerminalNumber([term('a','Terminal 1'),term('b','Terminal 2')],term('a','Terminal 1')),false);
 assert.equal(needsTerminalNumber([term('a','Terminal 1'),term('b','Terminal 1')],term('a','Terminal 1')),true);
 assert.equal(needsTerminalNumber([term('a','New terminal')],term('a','New terminal')),true);
 assert.equal(needsTerminalNumber([term('a','Build',{nameSource:'manual'}),term('b','Build',{nameSource:'manual'})],term('a','Build',{nameSource:'manual'})),false);
});

test('the running command comes from the status poll only while the terminal runs',()=>{
 assert.equal(terminalCommand(term('a','Terminal 1',{detail:'python3'})),'python3');
 assert.equal(terminalCommand(term('a','Terminal 1',{detail:'-zsh'})),'zsh');
 assert.equal(terminalCommand(term('a','Terminal 1',{detail:'/usr/bin/htop'})),'htop');
 assert.equal(terminalCommand(term('a','Terminal 1',{status:'unreachable',detail:'ssh: connect to host devbox port 22: Operation timed out'})),undefined);
 assert.equal(terminalCommand(term('a','Terminal 1',{status:'closed',detail:'Process exited with code 0. Scrollback is still available.'})),undefined);
 assert.equal(terminalCommand(term('a','Terminal 1',{status:'checking',detail:'zsh'})),undefined);
 assert.equal(terminalCommand(term('a','Agent',{launcher:'codex',detail:'node'})),undefined);
});

test('open terminals saved as "New terminal" are numbered on load, oldest first, around numbers already taken',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'harbor-terminal-names-'));
 const project={id:'p',name:'P',cwd:'~',hostLabel:'This Mac',connection:'local',createdAt:''};
 const sessions=[term('c','New terminal',{tmuxName:'harbor-c',createdAt:'3'}),term('a','New terminal',{tmuxName:'harbor-a',createdAt:'1'}),term('b','Terminal 1',{tmuxName:'harbor-b',createdAt:'2'}),
  term('d','New terminal',{tmuxName:'harbor-d',status:'closed'}),term('e','New terminal',{tmuxName:'harbor-e',nameSource:'manual'})];
 await writeFile(path.join(dir,'sessions.json'),JSON.stringify({version:2,projects:[project],sessions}));
 const engine=new HarborEngine(dir,new Transport(`harbor-names-${process.pid}`));
 try {
  const names=Object.fromEntries((await engine.init(false)).sessions.map(s=>[s.id,s.name]));
  assert.deepEqual(names,{a:'Terminal 2',b:'Terminal 1',c:'Terminal 3',d:'New terminal',e:'New terminal'});
  assert.equal(JSON.parse(await readFile(path.join(dir,'sessions.json'),'utf8')).sessions.find((s:Session)=>s.id==='a').name,'Terminal 2');
 } finally { await engine.dispose(); }
});
