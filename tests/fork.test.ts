import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { HarborEngine } from '../src/engine/engine';
import { AgentBridge } from '../src/engine/bridge';
import { Transport, quote } from '../src/engine/transport';
import { forkBlocker, forkName, placeFork } from '../src/shared/fork';
import { dropPane, leaf, paneIds } from '../src/shared/panes';
import type { Connection, Session } from '../src/shared/types';

const SOURCE='11111111-2222-3333-4444-555555555555';
async function fakeEngine() {
 const dir=await mkdtemp(path.join(tmpdir(),'harbor-fork-'));const transport=new Transport('harbor-fork-unit');const calls:{host:Connection;script:string}[]=[];
 transport.run=async(host,script)=>{calls.push({host,script});return script.includes('new-session')?`HARBOR_PANE=%${calls.length}\n`:'';};
 const engine=new HarborEngine(dir,transport);await engine.init(false);
 (engine as any).bridge={ensure:async()=>'/tmp/bridge.py',metadata:async()=>({}),available:async()=>true};
 return {engine,calls,sessions:()=>(engine as any).sessions as Session[]};
}

test('fork eligibility explains missing, starting, empty and invalid conversations',()=>{
 const base={launcher:'claude',conversationId:SOURCE,resumable:true,hasMessages:true,status:'running',activity:'idle'} as const;
 assert.equal(forkBlocker(base),undefined);assert.equal(forkBlocker({...base,resumable:undefined,hasMessages:undefined,status:'closed',activity:'closed'}),undefined);
 assert.match(forkBlocker({...base,launcher:'shell'})!,/Only Codex and Claude Code/);
 assert.match(forkBlocker({...base,conversationId:undefined,activity:'starting'})!,/still starting/);
 assert.match(forkBlocker({...base,resumable:false,activity:'starting'})!,/still starting/);
 assert.match(forkBlocker({...base,conversationId:undefined,status:'closed',activity:'closed'})!,/no saved conversation/);
 assert.match(forkBlocker({...base,hasMessages:false})!,/no saved conversation/);
 assert.match(forkBlocker({...base,conversationId:'../../etc'})!,/invalid/);
 assert.equal(forkName('Fix SSH reattach'),'Fix SSH reattach (fork)');assert.equal(forkName('x'.repeat(100)).length,100);
});

test('a fork opens after its original tab and splits in to its right only when the original is on screen',()=>{
 const layout=dropPane(leaf('a'),'a','b','bottom');
 const placed=placeFork(['a','b','c'],layout,'a','f');assert.deepEqual(placed.tabs,['a','f','b','c']);assert.deepEqual(paneIds(placed.layout!),['a','f','b']);
 const split=placed.layout!;assert.ok(split.kind==='split'&&split.first.kind==='split'&&split.first.axis==='horizontal');
 const hidden=placeFork(['a','b'],leaf('b'),'a','f');assert.deepEqual(hidden.tabs,['a','f','b']);assert.equal(hidden.layout,undefined);
 assert.deepEqual(placeFork(['b'],null,'a','f').tabs,['b','f']);assert.deepEqual(placeFork(['a','f','b'],leaf('a'),'a','f').tabs,['a','f','b']);
});

test('forking launches a new chat from the original conversation, in its folder, host, launcher and mode',async()=>{
 const {engine,calls,sessions}=await fakeEngine();
 const original=await engine.create({name:'Design review',host:'local',cwd:'/tmp/harbor-fork-project',launcher:'claude',permissionMode:'full-access',tags:['ui']});
 await assert.rejects(engine.fork(original.id),/still starting/);
 Object.assign(sessions()[0],{conversationId:SOURCE,resumable:true,hasMessages:true,activity:'idle',cwd:'/tmp/harbor-fork-project/sub dir'});
 const fork=await engine.fork(original.id);const script=calls.at(-1)!.script;
 assert.notEqual(fork.id,original.id);assert.equal(fork.name,'Design review (fork)');assert.equal(fork.nameSource,'manual');
 assert.equal(fork.launcher,'claude');assert.equal(fork.permissionMode,'full-access');assert.equal(fork.projectId,original.projectId);assert.equal(fork.cwd,'/tmp/harbor-fork-project/sub dir');assert.deepEqual(fork.tags,['ui']);
 assert.equal(fork.forkedFrom,SOURCE);assert.equal(fork.conversationId,undefined);assert.equal(fork.resumable,false);assert.equal(fork.hasMessages,true);assert.equal(fork.activity,'starting');
 assert.match(script,new RegExp(`--fork [^ ]*${SOURCE}`));assert.match(script,/run claude/);assert.match(script,/full-access/);assert.match(script,/sub dir/);assert.doesNotMatch(script,/--resume/);
 const source=engine.snapshot().sessions.find(s=>s.id===original.id)!;assert.equal(source.conversationId,SOURCE);assert.equal(source.name,'Design review');assert.equal(source.tmuxName,original.tmuxName);
 // A fork that never saved its own conversation forks again on resume instead of starting empty.
 await engine.terminate(fork.id);calls.length=0;await engine.resume(fork.id);
 assert.ok(calls.some(c=>c.script.includes('new-session')&&c.script.includes('--fork')&&c.script.includes(SOURCE)&&!c.script.includes('--resume')));
 // Once it has its own conversation, it resumes that one.
 Object.assign(sessions().find(s=>s.id===fork.id)!,{conversationId:'99999999-2222-3333-4444-555555555555',resumable:true});
 await engine.terminate(fork.id);calls.length=0;await engine.resume(fork.id);
 const resumed=calls.find(c=>c.script.includes('new-session'))!.script;assert.match(resumed,/--resume/);assert.doesNotMatch(resumed,/--fork/);
 await engine.dispose();
});

test('fork refuses shells, missing conversations and chats that are changing state; SSH forks use the original connection',async()=>{
 const {engine,calls,sessions}=await fakeEngine();
 const shell=await engine.create({name:'New terminal',host:'local',cwd:'~',launcher:'shell'});await assert.rejects(engine.fork(shell.id),/Only Codex and Claude Code/);
 const codex=await engine.create({name:'Plain',host:'local',cwd:'~',launcher:'codex'});Object.assign(sessions().find(s=>s.id===codex.id)!,{status:'closed',activity:'closed'});
 await assert.rejects(engine.fork(codex.id),/no saved conversation yet/);
 await assert.rejects(engine.fork('missing'),/Session not found/);
 const remote={target:'gpu-box',hostname:'10.0.0.5',user:'me',port:22};const id=randomUUID();
 const project={id:'remote-project',name:'Remote',cwd:'/srv/app',hostId:'gpu-box',hostLabel:'GPU box',connection:remote,createdAt:new Date().toISOString()};(engine as any).projects.push(project);
 sessions().push({id,tmuxName:`harbor-${id}`,paneId:'%9',name:'Remote run',host:'gpu-box',hostId:'gpu-box',hostLabel:'GPU box',connection:remote,projectId:project.id,cwd:'/srv/app',launcher:'codex',command:'codex',group:'Remote',tags:[],pinned:false,archived:false,createdAt:'',updatedAt:'',status:'closed',activity:'closed',conversationId:SOURCE,resumable:true,permissionMode:'read-only'} as Session);
 (engine as any).operations.add(id);await assert.rejects(engine.fork(id),/changing state/);(engine as any).operations.delete(id);
 const fork=await engine.fork(id);const launch=calls.at(-1)!;
 assert.deepEqual(launch.host,remote);assert.deepEqual(fork.connection,remote);assert.equal(fork.hostId,'gpu-box');assert.equal(fork.projectId,project.id);assert.equal(fork.permissionMode,'read-only');
 assert.match(launch.script,/run codex/);assert.ok(launch.script.includes(SOURCE));assert.match(launch.script,/--fork/);
 await engine.dispose();
});

// Real CLIs, private tmux socket, throwaway folder: the fork answers from the original's history under its own conversation ID.
for(const launcher of ['claude','codex'] as const)test(`real ${launcher}: a fork resumes the history under a new conversation and leaves the original untouched`,{skip:!process.env.HARBOR_TEST_AGENTS,timeout:240000},async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'harbor-fork-real-'+launcher+'-'));const data=await mkdtemp(path.join(tmpdir(),'harbor-fork-index-'));
 const transport=new Transport('harbor-fork-'+launcher+'-'+Date.now());const bridge=new AgentBridge(transport);const engine=new HarborEngine(data,transport);await engine.init(false);
 const word='zebra'+Math.random().toString(36).slice(2,8);const conversations=new Set<string>();
 t.after(async()=>{
  for(const s of engine.snapshot().sessions){await engine.terminate(s.id).catch(()=>{});if(s.conversationId)conversations.add(s.conversationId);}
  await engine.dispose();await transport.run('local',transport.setup()+transport.tmux(['kill-server'])).catch(()=>{});
  // Remove only this test's throwaway conversations.
  if(launcher==='codex')for(const id of [...conversations].reverse())await transport.run('local',transport.setup()+`codex delete --force ${quote(id)} </dev/null`).catch(()=>{}); // Forks first: Codex refuses to delete a fork's source.
  else await rm(path.join(homedir(),'.claude/projects',(await transport.run('local',`cd ${quote(dir)} && pwd -P`)).trim().replace(/[^a-zA-Z0-9]/g,'-')),{recursive:true,force:true});
  await rm(dir,{recursive:true,force:true});await rm(data,{recursive:true,force:true});
 });
 const until=async<T>(read:()=>Promise<T>,accept:(v:T)=>boolean,label:string,timeout=90000):Promise<T>=>{const end=Date.now()+timeout;let value!:T;while(Date.now()<end){value=await read();if(accept(value))return value;await new Promise(r=>setTimeout(r,500));}throw new Error(`Timed out: ${label}\n${typeof value==='string'?value:JSON.stringify(value)}`);};
 const capture=(pane:string)=>transport.run('local',transport.setup()+transport.tmux(['capture-pane','-p','-J','-S','-200','-t',pane]));
 const keys=(pane:string,...args:string[])=>transport.run('local',transport.setup()+transport.tmux(['send-keys','-t',pane,...args]));
 const ready=async(pane:string)=>{
  for(let i=0;i<4;i++){const screen=await until(()=>capture(pane),v=>/Ask Codex|Ready|Do you trust|Update available!|Yes, I trust this folder|for shortcuts|mode on|❯ |context left|% left/.test(v),'agent screen');
   if(/Update available!/.test(screen)){await keys(pane,'Down','Enter');continue;}
   if(/Do you trust|Yes, I trust this folder/.test(screen)){const line=screen.split('\n').find(l=>/[❯›>]/.test(l)&&/Yes|No/.test(l));await keys(pane,...(line&&!line.includes('Yes')?['Down']:[]),'Enter');await new Promise(r=>setTimeout(r,1500));continue;}
   return;}
 };
 const say=async(pane:string,text:string)=>{await keys(pane,'-l',text);await new Promise(r=>setTimeout(r,600));await keys(pane,'Enter');if(launcher==='codex'){await new Promise(r=>setTimeout(r,800));await keys(pane,'Enter');}};
 const state=async(id:string)=>{await engine.refresh();return engine.snapshot().sessions.find(s=>s.id===id)!;};
 const original=await engine.create({name:'Fork source',host:'local',cwd:dir,launcher});
 await ready(original.paneId);await new Promise(r=>setTimeout(r,1500));
 await say(original.paneId,`Remember this code word: ${word.toUpperCase()}. Reply only with OK. Do not use tools.`);
 const saved=await until(()=>state(original.id),s=>!forkBlocker(s)&&s.activity==='idle','original saved and idle',120000);conversations.add(saved.conversationId!);
 const fork=await engine.fork(original.id);assert.equal(fork.name,'Fork source (fork)');assert.equal(fork.cwd,dir);
 await ready(fork.paneId);
 const forked=await until(()=>state(fork.id),s=>!!s.conversationId&&s.activity!=='starting','fork conversation id',60000);conversations.add(forked.conversationId!);
 assert.notEqual(forked.conversationId,saved.conversationId);assert.equal(forked.forkedFrom,saved.conversationId);
 await new Promise(r=>setTimeout(r,1500));await say(fork.paneId,'What was the code word? Reply with it in lowercase only, nothing else. Do not use tools.');
 await until(()=>capture(fork.paneId),v=>v.includes(word),'fork answers from history',120000);
 const done=await until(()=>state(fork.id),s=>s.resumable===true&&s.hasMessages===true,'fork saved',60000);assert.equal(done.conversationId,forked.conversationId);
 // The original's saved conversation has no trace of the fork's turn.
 const [source,copy]=await Promise.all([bridge.preview('local',launcher,dir,saved.conversationId!),bridge.preview('local',launcher,dir,forked.conversationId!)]);
 assert.ok(source.messages.some(m=>m.text.includes(word.toUpperCase())),JSON.stringify(source));assert.ok(!source.messages.some(m=>m.text.includes('What was the code word')),JSON.stringify(source));
 assert.ok(copy.messages.some(m=>m.text.includes('What was the code word')),JSON.stringify(copy));
 const after=engine.snapshot().sessions.find(s=>s.id===original.id)!;assert.equal(after.conversationId,saved.conversationId);assert.equal(after.status,'running');
});
