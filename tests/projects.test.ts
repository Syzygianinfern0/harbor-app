import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HarborEngine } from '../src/engine/engine';
import { Transport } from '../src/engine/transport';
import { compareVersions } from '../src/engine/updates';

test('projects retain their directory; closing stops tmux and reopening creates a new incarnation',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'harbor-project-'));const transport=new Transport('harbor-project-'+Date.now());const engine=new HarborEngine(dir,transport);await engine.init(false);
 t.after(async()=>{await engine.dispose();await transport.run('local',transport.setup()+transport.tmux(['kill-server'])).catch(()=>{});});
 const project=await engine.addProject({name:'Project',host:'local',cwd:dir});
 const chat=await engine.create({name:'Terminal',host:'local',cwd:'~',launcher:'shell',projectId:project.id});assert.equal(chat.cwd,project.cwd);
 await engine.terminate(chat.id);assert.equal(engine.snapshot().sessions[0].status,'closed');assert.equal(engine.snapshot().sessions[0].archived,false);
 await assert.rejects(transport.run('local',transport.setup()+transport.tmux(['has-session','-t',`=${chat.tmuxName}`])));
 const resumed=await engine.resume(chat.id);assert.equal(resumed.id,chat.id);assert.notEqual(resumed.tmuxName,chat.tmuxName);assert.notEqual(resumed.generation,chat.generation);
 await engine.update(chat.id,{name:'Renamed chat',pinned:true});await engine.updateProject(project.id,'Renamed project');
 const stored=JSON.parse(await readFile(path.join(dir,'sessions.json'),'utf8'));assert.equal(stored.version,2);assert.equal(stored.projects[0].name,'Renamed project');assert.equal(stored.sessions[0].nameSource,'manual');
});
test('legacy index migrates without changing existing tmux identity',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'harbor-migration-'));const session={id:'legacy',name:'Old chat',host:'local',cwd:'~',tmuxName:'harbor-aaaa',paneId:'%1',launcher:'shell',group:'Old group',tags:[],pinned:false,archived:false,createdAt:new Date().toISOString()};
 await writeFile(path.join(dir,'sessions.json'),JSON.stringify({version:1,sessions:[session,{...session,id:'default',tmuxName:'harbor-bbbb',paneId:'%2',name:'Codex · This Mac',launcher:'codex'}]}));const engine=new HarborEngine(dir);await engine.init(false);
 assert.equal(engine.snapshot().projects.length,1);assert.equal(engine.snapshot().sessions[0].tmuxName,session.tmuxName);assert.ok(engine.snapshot().sessions[0].projectId);assert.equal(engine.snapshot().sessions[0].name,'Old chat');assert.equal(engine.snapshot().sessions[1].name,'Untitled chat');await engine.dispose();
});
test('history deduplicates by exact conversation and connection; custom names survive refresh',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'harbor-history-'));const transport=new Transport();transport.run=async()=>dir;
 const engine=new HarborEngine(dir,transport);await engine.init(false);const id='11111111-1111-4111-8111-111111111111';
 (engine as any).bridge={history:async()=>({conversations:[{conversationId:id,launcher:'codex',name:'Agent generated title',cwd:dir,createdAt:100,updatedAt:200,externalActive:true}],errors:[]})};
 const project=await engine.addProject({name:'Imported',host:'local',cwd:dir});await engine.importHistory(project.id);assert.equal(engine.snapshot().sessions.length,1);
 const chat=engine.snapshot().sessions[0];assert.equal(chat.status,'closed');assert.equal(chat.conversationId,id);assert.equal(chat.externalActive,true);
 await engine.update(chat.id,{name:'My title'});await engine.importHistory(project.id);assert.equal(engine.snapshot().sessions[0].name,'My title');await engine.dispose();
});
test('agent completion and attention events are deduplicated; manual titles override automatic titles',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'harbor-events-'));const transport=new Transport();let chat:any;
 transport.run=async(_host,command)=>command.includes('new-session')?'HARBOR_PANE=%1\n':command.includes('list-panes')?`HARBOR_STATUS=${chat.tmuxName}|%1|0|python3|\n`:'';
 const engine=new HarborEngine(dir,transport);await engine.init(false);let meta:any={};(engine as any).bridge={ensure:async()=>'/tmp/bridge.py',metadata:async()=>({[chat.id]:meta})};
 chat=await engine.create({name:'New chat',host:'local',cwd:'~',launcher:'codex'});const events:any[]=[];engine.on('attention',event=>events.push(event));
 meta={generation:chat.generation,activity:'idle',updatedAt:1,name:'Automatic title'};await engine.refresh();assert.equal(engine.snapshot().sessions[0].name,'Automatic title');
 meta={...meta,updatedAt:2,completedAt:2};await engine.refresh();await engine.refresh();assert.equal(events.length,1);assert.equal(events[0].completed,true);
 await engine.update(chat.id,{name:'My name'});meta={...meta,activity:'attention',updatedAt:3,attentionAt:3};await engine.refresh();assert.equal(events.length,2);assert.equal(events[1].completed,false);assert.equal(engine.snapshot().sessions[0].name,'My name');await engine.dispose();
});
test('version comparisons use numeric components and preserve unknown results',()=>{
 assert.equal(compareVersions('0.154.0','0.155.0'),'available');assert.equal(compareVersions('2.1.263','2.1.99'),'current');assert.equal(compareVersions('unknown','1.2.3'),'unknown');
});

test('project order and visibility persist; deletion keeps sessions without recreating projects on restart',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'harbor-manage-'));const createdAt=new Date().toISOString();
 const projects=['a','b'].map(id=>({id,name:id,cwd:dir+'/'+id,hostLabel:'This Mac',connection:'local',createdAt}));
 const session={id:'chat',name:'Saved',host:'local',cwd:projects[0].cwd,tmuxName:'harbor-aaaa',paneId:'%1',launcher:'codex',group:'',tags:[],pinned:false,archived:false,createdAt,status:'closed',projectId:'a'};
 await writeFile(path.join(dir,'sessions.json'),JSON.stringify({version:2,projects,sessions:[session]}));
 let engine=new HarborEngine(dir);await engine.init(false);
 await engine.manageProjects([{id:'b',hidden:true},{id:'a',hidden:false}]);assert.deepEqual(engine.snapshot().projects.map(p=>[p.id,p.hidden]),[['b',true],['a',false]]);
 await engine.manageProjects([{id:'b',hidden:true}]);assert.equal(engine.snapshot().sessions.length,1);await engine.dispose();
 engine=new HarborEngine(dir);await engine.init(false);assert.deepEqual(engine.snapshot().projects.map(p=>p.id),['b']);assert.equal(engine.snapshot().sessions[0].projectRemoved,true);await engine.dispose();
});

test('usage reads each configured connection once and preserves other hosts when SSH fails',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'harbor-usage-'));const engine=new HarborEngine(dir);await engine.init(false);t.after(()=>engine.dispose());
 const preferences=engine.snapshot().preferences;
 await engine.savePreferences({...preferences,hosts:[...preferences.hosts,{id:'remote',label:'Research server',source:'manual',enabled:true,defaultDirectory:'~',connection:{target:'server'}}]});
 const calls:unknown[]=[];
 (engine as any).bridge={usage:async(connection:unknown)=>{calls.push(connection);await new Promise(resolve=>setTimeout(resolve,10));if(connection!=='local')throw new Error('SSH unavailable');return {agents:[]};}};
 const [first,second]=await Promise.all([engine.usage(),engine.usage()]);assert.deepEqual(first,second);assert.equal(calls.length,2);assert.equal(first[0].error,undefined);assert.equal(first[1].error,'SSH unavailable');
 await engine.usage();assert.equal(calls.length,4);
});
