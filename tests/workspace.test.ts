import test from 'node:test';
import assert from 'node:assert/strict';
import { dropPane, leaf, paneIds, removePane, replacePane, resizePane, restorePanes, reorderTabs } from '../src/shared/panes';
import { tabShortcut } from '../src/shared/shortcuts';
import { validatePreferences, defaultPreferences } from '../src/engine/preferences';
import { validateCreate, HarborEngine } from '../src/engine/engine';
import { Transport } from '../src/engine/transport';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('nested panes split in every direction, move without duplication, resize and collapse',()=>{
 let tree=leaf('a');tree=dropPane(tree,'a','b','right')!;tree=dropPane(tree,'b','c','bottom')!;tree=dropPane(tree,'c','d','left')!;
 assert.deepEqual(paneIds(tree),['a','b','d','c']);
 tree=dropPane(tree,'a','c','top')!;assert.deepEqual(paneIds(tree),['c','a','b','d']);
 if(tree.kind!=='split')throw Error('Expected split');
 tree=resizePane(tree,tree.id,.68);assert.equal(tree.kind==='split'&&tree.ratio,.68);
 tree=removePane(tree,'c')!;tree=removePane(tree,'b')!;tree=removePane(tree,'d')!;assert.deepEqual(tree,leaf('a'));
 assert.deepEqual(replacePane(tree,'a','z'),leaf('z'));
 assert.deepEqual(restorePanes(dropPane(tree,'a','b','right'),['b']),leaf('b'));
});
test('tab reorder handles before and after without losing tab identity',()=>{
 assert.deepEqual(reorderTabs(['a','b','c'],'a','c',true),['b','c','a']);
 assert.deepEqual(reorderTabs(['a','b','c'],'c','a',false),['c','a','b']);
});
test('browser shortcuts avoid ordinary terminal key combinations',()=>{
 const key={key:'1',metaKey:true,ctrlKey:false,shiftKey:false,altKey:false};
 assert.equal(tabShortcut(key),1);assert.equal(tabShortcut({...key,key:'9'}),9);
 assert.equal(tabShortcut({...key,key:'Tab',metaKey:false,ctrlKey:true}),'next');
 assert.equal(tabShortcut({...key,key:'Tab',metaKey:false,ctrlKey:true,shiftKey:true}),'previous');
 assert.equal(tabShortcut({...key,key:'{',shiftKey:true}),'previous');
 assert.equal(tabShortcut({...key,metaKey:false}),undefined);
});
test('agent defaults migrate and modes reject incompatible or arbitrary flags',()=>{
 const old:any=defaultPreferences();delete old.agents;assert.deepEqual(validatePreferences(old).agents,{codex:'standard',claude:'standard'});
 const prefs=defaultPreferences();prefs.agents.codex='full-access';assert.equal(validatePreferences(prefs).agents.codex,'full-access');
 assert.throws(()=>validatePreferences({...prefs,agents:{codex:'plan',claude:'standard'}}),/permission mode/);
 assert.throws(()=>validateCreate({name:'Test',host:'local',cwd:'~',launcher:'shell',permissionMode:'full-access'}),/permission mode/);
});
test('new chats apply defaults and resumed chats retain their explicitly chosen mode',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'harbor-mode-'));const transport=new Transport();const scripts:string[]=[];
 transport.run=async(_host,script)=>{scripts.push(script);return script.includes('new-session')?'HARBOR_PANE=%1\n':'';};
 const engine=new HarborEngine(dir,transport);await engine.init(false);
 (engine as any).bridge={ensure:async()=>'/tmp/bridge.py',metadata:async()=>({})};
 const prefs=defaultPreferences();prefs.agents.codex='read-only';await engine.savePreferences(prefs);
 const chat=await engine.create({name:'New chat',host:'local',cwd:'~',launcher:'codex',permissionMode:'full-access'});
 assert.equal(chat.permissionMode,'full-access');assert.equal(chat.hasMessages,false);assert.match(scripts.at(-1)!,/--permission-mode.*full-access/);
 await engine.terminate(chat.id);prefs.agents.codex='standard';await engine.savePreferences(prefs);
 const original=chat.originalLaunchCommand;assert.ok(original);
 const resumed=await engine.resume(chat.id);assert.equal(resumed.originalLaunchCommand,original);assert.notEqual(resumed.latestLaunchCommand,original);assert.equal(resumed.permissionMode,'full-access');assert.match(scripts.at(-1)!,/--permission-mode.*full-access/);
 const next=await engine.create({name:'New chat',host:'local',cwd:'~',launcher:'codex'});assert.equal(next.permissionMode,'standard');
 await engine.dispose();
});

test('folder uploads recreate the folder tree, including hidden files and odd names',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'harbor-folder-'));const source=path.join(dir,"src ' $(x)");const target=path.join(dir,'target');
 await mkdir(path.join(source,'nested dir'),{recursive:true});await mkdir(target);
 await writeFile(path.join(source,'.hidden'),'hidden');await writeFile(path.join(source,'nested dir','-leading.txt'),'nested');
 await new Transport().uploadDirectory('local',source,target);
 assert.equal(await readFile(path.join(target,path.basename(source),'.hidden'),'utf8'),'hidden');
 assert.equal(await readFile(path.join(target,path.basename(source),'nested dir','-leading.txt'),'utf8'),'nested');
 assert.deepEqual((await readdir(path.join(target,path.basename(source)))).sort(),['.hidden','nested dir']);
 await assert.rejects(new Transport().uploadDirectory('local',path.join(dir,'missing'),target));
});

test('file drops quote local paths, stage remote files, and never paste after attachment changes',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'harbor-drops-'));const file=path.join(dir,"a ' $(echo injected).txt");await writeFile(file,'file contents');
 const transport=new Transport();const scripts:string[]=[];transport.run=async(_host,script)=>{scripts.push(script);return script.includes('new-session')?'HARBOR_PANE=%1\n':script.includes('mktemp')?'/remote/.local/share/harbor/drops/drop.abcdefgh\n':'';};
 const engine=new HarborEngine(dir,transport);await engine.init(false);
 const chat=await engine.create({name:'Drop test',host:'local',cwd:dir,launcher:'shell'});
 const client={detach(){}};(engine as any).clients.set(chat.id,client);let pasted='';engine.paste=async(_id,text)=>{pasted=text;};
 try {
  await engine.dropFiles(chat.id,[file]);assert.equal(pasted,"'"+file.replace(/'/g,"'\\''")+"' ");assert.equal(pasted.includes('\n'),false);
  await assert.rejects(engine.dropFiles(chat.id,['']),/usable file path/);await engine.dropFiles(chat.id,[dir]);assert.equal(pasted,"'"+dir+"' ");
  const live=(engine as any).sessions.find((s:any)=>s.id===chat.id);live.host='remote';const uploaded:string[][]=[];
  transport.uploadFile=async(host,source,destination)=>{uploaded.push([String(host),source,destination]);};
  await engine.dropFiles(chat.id,[file]);assert.equal(uploaded[0][0],'remote');assert.equal(uploaded[0][1],file);assert.match(pasted,/remote.*drop.abcdefgh\/0/);
  const folders:string[][]=[];transport.uploadDirectory=async(host,source,destination)=>{folders.push([String(host),source,destination]);};
  await engine.dropFiles(chat.id,[file,dir]);assert.deepEqual(folders,[['remote',dir,'/remote/.local/share/harbor/drops/drop.abcdefgh/1']]);assert.equal(pasted,`'/remote/.local/share/harbor/drops/drop.abcdefgh/0/${path.basename(file).replace(/'/g,"'\\''")}' '/remote/.local/share/harbor/drops/drop.abcdefgh/1/${path.basename(dir)}' `);
  transport.uploadFile=async()=>{throw new Error('upload failed');};pasted='';await assert.rejects(engine.dropFiles(chat.id,[file]),/upload failed/);assert.equal(pasted,'');assert.match(scripts.at(-1)!,/rm -rf/);
  transport.uploadFile=async()=>{(engine as any).clients.delete(chat.id);};await assert.rejects(engine.dropFiles(chat.id,[file]),/reconnected/);assert.equal(pasted,'');
 }finally{await engine.dispose();}
});

test('file transfer streams exact bytes and reports missing sources',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'harbor-upload-'));const source=path.join(dir,'source');const target=path.join(dir,"target's file");const bytes=Buffer.from(Array.from({length:65536},(_,i)=>i%256));await writeFile(source,bytes);
 const transport=new Transport();await transport.uploadFile('local',source,target);assert.deepEqual(await readFile(target),bytes);
 await assert.rejects(transport.uploadFile('local',path.join(dir,'missing'),target),/ENOENT/);
});

test('chat indicators distinguish completion and never show stale success on disconnected chats',async()=>{
 const {chatActivity}=await import('../src/shared/chatStatus');
 const session={status:'running',activity:'idle',completedAt:100} as any;
 assert.equal(chatActivity(session),'completed');
 assert.equal(chatActivity({...session,activity:'working'}),'working');
 assert.equal(chatActivity({...session,activity:'error'}),'error');
 for(const status of ['checking','missing','unreachable'])assert.equal(chatActivity({...session,status}),'unknown');
 assert.equal(chatActivity({...session,status:'closed'}),'closed');
 assert.equal(chatActivity({...session,status:'closed',externalActive:true}),'external');
 assert.equal(chatActivity({...session,completedAt:undefined}),'idle');
 assert.equal(chatActivity({...session,activity:'background'}),'background'); // an earlier turn's completion does not mask pending background work
});
