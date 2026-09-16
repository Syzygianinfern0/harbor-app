import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HarborEngine } from '../src/engine/engine';
import { AgentBridge } from '../src/engine/bridge';
import { Transport, quote } from '../src/engine/transport';
async function until<T>(read:()=>Promise<T>,accept:(v:T)=>boolean,timeout=60000):Promise<T>{const end=Date.now()+timeout;while(Date.now()<end){const value=await read();if(accept(value))return value;await new Promise(r=>setTimeout(r,250));}throw new Error('Timed out waiting for the external CLI');}
for(const launcher of ['codex','claude'] as const)test(`imports a chat created by standalone ${launcher}, blocks an active writer, and resumes the exact history`,{skip:!process.env.HARBOR_TEST_AGENTS,timeout:120000},async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'harbor-outside-'+launcher+'-'));const data=await mkdtemp(path.join(tmpdir(),'harbor-outside-index-'));const transport=new Transport('harbor-outside-'+launcher+'-'+Date.now());const bridge=new AgentBridge(transport);const engine=new HarborEngine(data,transport);await engine.init(false);
 t.after(async()=>{for(const s of engine.snapshot().sessions)await engine.terminate(s.id).catch(()=>{});await engine.dispose();await transport.run('local',transport.setup()+transport.tmux(['kill-server'])).catch(()=>{});});
 // The source conversation runs the unmodified standalone CLI, without Harbor's wrapper or hooks.
 await transport.run('local',transport.setup()+`cd ${quote(dir)}\n${transport.tmux(['new-session','-d','-s','outside','-x','120','-y','35',`exec ${launcher}`])}`);
 const capture=()=>transport.run('local',transport.setup()+transport.tmux(['capture-pane','-p','-t','outside']));
 let screen=await until(capture,v=>/OpenAI Codex|Claude Code|Accessing workspace|Update available!|Do you trust the contents/.test(v));
 if(screen.includes('Do you trust the contents'))await transport.run('local',transport.setup()+transport.tmux(['send-keys','-t','outside','Enter']));
 if(screen.includes('Update available!'))await transport.run('local',transport.setup()+transport.tmux(['send-keys','-t','outside','Down','Enter']));
 if(launcher==='claude'&&screen.includes('Yes, I trust this folder')){
  const selected=screen.split('\n').find(line=>/[❯›>]/.test(line)&&/Yes|No/.test(line));await transport.run('local',transport.setup()+transport.tmux(['send-keys','-t','outside',...(selected?.includes('Yes')?[]:['Down']),'Enter']));
 }
 await until(capture,v=>launcher==='codex'?/Ask Codex|Ready/.test(v):!/Accessing workspace/.test(v)&&/Claude Code/.test(v));
 await transport.run('local',transport.setup()+transport.tmux(['send-keys','-t','outside','-l','Reply only HARBOR_EXTERNAL_OK. Do not use tools or modify files.']));await new Promise(r=>setTimeout(r,500));await transport.run('local',transport.setup()+transport.tmux(['send-keys','-t','outside','Enter']));
 if(launcher==='codex'){await new Promise(r=>setTimeout(r,700));await transport.run('local',transport.setup()+transport.tmux(['send-keys','-t','outside','Enter']));}
 await until(capture,v=>(v.match(/HARBOR_EXTERNAL_OK/g)||[]).length>=2);
 const history=await until(()=>bridge.history('local',dir),v=>v.conversations.some(c=>c.launcher===launcher));const original=history.conversations.find(c=>c.launcher===launcher)!;
 assert.equal(original.externalActive,true);
 const project=await engine.addProject({name:'External project',host:'local',cwd:dir});const imported=engine.snapshot().sessions.find(s=>s.conversationId===original.conversationId)!;assert.ok(imported);assert.equal(imported.imported,true);
 await assert.rejects(engine.resume(imported.id),/active writer/);
 await transport.run('local',transport.setup()+transport.tmux(['kill-session','-t','outside']));await until(()=>bridge.available('local',launcher,original.conversationId),v=>v);
 await engine.importHistory(project.id);const resumed=await engine.resume(imported.id);assert.equal(resumed.conversationId,original.conversationId);
 await until(()=>transport.run('local',transport.setup()+transport.tmux(['capture-pane','-p','-t',resumed.paneId])),v=>v.includes('HARBOR_EXTERNAL_OK'));
});
for(const launcher of ['codex','claude'] as const)test(`an empty ${launcher} chat can be closed and opened again`,{skip:!process.env.HARBOR_TEST_AGENTS,timeout:45000},async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'harbor-empty-'+launcher+'-'));const transport=new Transport('harbor-empty-'+launcher+'-'+Date.now());const engine=new HarborEngine(dir,transport);await engine.init(false);
 t.after(async()=>{for(const s of engine.snapshot().sessions)await engine.terminate(s.id).catch(()=>{});await engine.dispose();await transport.run('local',transport.setup()+transport.tmux(['kill-server'])).catch(()=>{});});
 const session=await engine.create({name:'New chat',host:'local',cwd:dir,launcher});
 await until(async()=>{await engine.refresh();return engine.snapshot().sessions[0];},s=>!!s.conversationId,20000);
 await engine.terminate(session.id);const resumed=await engine.resume(session.id);assert.notEqual(resumed.tmuxName,session.tmuxName);
 await until(()=>transport.run('local',transport.setup()+transport.tmux(['capture-pane','-p','-t',resumed.paneId])),v=>launcher==='codex'?/OpenAI Codex|Welcome to Codex/.test(v):/Claude Code|Accessing workspace/.test(v),20000);
});
