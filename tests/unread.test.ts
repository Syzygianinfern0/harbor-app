import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HarborEngine } from '../src/engine/engine';
import { Transport } from '../src/engine/transport';
import { dockBadge, isUnread, shouldMarkUnread, unreadCount, validView, viewedChat, NO_VIEW } from '../src/shared/unread';
import type { Preferences, Session } from '../src/shared/types';

const settings=(patch:Partial<Preferences['notifications']>={})=>({enabled:false,sound:true,whenFocused:false,onComplete:true,...patch});

test('unread follows the notifier\'s events, independent of desktop notifications, and skips chats on screen',()=>{
 const view={focused:'a',visible:['a','b']};
 // Needs input / error: marked whenever the chat is not visible in a focused window, even with notifications off.
 assert.equal(shouldMarkUnread('c',false,settings(),true,view),true);
 assert.equal(shouldMarkUnread('c',false,settings({enabled:true}),true,view),true);
 assert.equal(shouldMarkUnread('a',false,settings(),true,view),false);
 assert.equal(shouldMarkUnread('b',false,settings(),true,view),false,'a visible, unfocused split pane counts as seen');
 assert.equal(shouldMarkUnread('a',false,settings(),false,view),true,'on screen but Harbor is in the background');
 assert.equal(shouldMarkUnread('a',false,settings(),true,NO_VIEW),true);
 // Finished turns follow "Notify when an agent finishes working".
 assert.equal(shouldMarkUnread('c',true,settings(),true,view),true);
 assert.equal(shouldMarkUnread('c',true,settings({onComplete:false}),true,view),false);
});
test('a chat is read only as the focused pane of a focused window',()=>{
 assert.equal(viewedChat(true,{focused:'a',visible:['a','b']}),'a');
 assert.equal(viewedChat(false,{focused:'a',visible:['a']}),null);
 assert.equal(viewedChat(true,NO_VIEW),null);
});
test('counts, badge and view validation',()=>{
 const s=(unread?:boolean,archived=false)=>({unread,archived}) as Pick<Session,'unread'|'archived'>;
 assert.equal(unreadCount([s(true),s(),s(true,true),s(false)]),1);assert.equal(isUnread(s(true,true)),false);
 assert.deepEqual([0,1,99,100].map(dockBadge),['','1','99','99+']);
 assert.deepEqual(validView({focused:null,visible:['x']}),{focused:null,visible:['x']});
 for(const bad of [null,'x',{focused:1,visible:[]},{focused:null,visible:'x'},{focused:null,visible:[1]},{focused:null,visible:Array(65).fill('x')}])assert.throws(()=>validView(bad));
});
test('engine persists the flag, clears it, and still loads older indexes without it',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'harbor-unread-'));const createdAt=new Date().toISOString();
 const base={name:'Chat',host:'local',cwd:dir,launcher:'codex',group:'',tags:[],pinned:false,archived:false,createdAt,updatedAt:createdAt,status:'closed'};
 await writeFile(path.join(dir,'sessions.json'),JSON.stringify({version:2,projects:[],sessions:[{...base,id:'a',tmuxName:'harbor-aaaa0',paneId:'%1'},{...base,id:'b',tmuxName:'harbor-aaaa1',paneId:'%2',unread:'yes'}]}));
 let engine=new HarborEngine(dir,new Transport('harbor-unread-test'));await engine.init(false);
 assert.deepEqual(engine.snapshot().sessions.map(s=>s.unread),[undefined,undefined],'legacy and malformed values load as read');
 let changes=0;engine.on('snapshot',()=>changes++);
 await engine.setUnread('a',true);await engine.setUnread('a',true);assert.equal(changes,1,'only a real change is saved');
 await engine.setUnread('missing',true);
 assert.equal(JSON.parse(await readFile(path.join(dir,'sessions.json'),'utf8')).sessions[0].unread,true);await engine.dispose();
 engine=new HarborEngine(dir,new Transport('harbor-unread-test'));await engine.init(false);assert.equal(engine.snapshot().sessions[0].unread,true,'survives restart');
 await engine.setUnread('a',false);assert.equal('unread' in JSON.parse(await readFile(path.join(dir,'sessions.json'),'utf8')).sessions[0],false);await engine.dispose();
});
test('engine raises attention for input, errors and finished turns, which is what marks a chat unread',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'harbor-unread-meta-'));const engine=new HarborEngine(dir,new Transport('harbor-unread-test'));await engine.init(false);
 const createdAt=new Date().toISOString();
 (engine as any).sessions.push({id:'a',tmuxName:'harbor-aaaa0',paneId:'%1',name:'Chat',host:'local',cwd:dir,launcher:'codex',group:'',tags:[],pinned:false,archived:false,createdAt,updatedAt:createdAt,status:'running',generation:'g',activity:'working',activityAt:1});
 const events:{id:string;completed:boolean}[]=[];engine.on('attention',({session,completed})=>events.push({id:session.id,completed}));
 let meta:Record<string,unknown>={generation:'g',activity:'working',updatedAt:2};(engine as any).bridge={metadata:async()=>({a:meta})};
 const poll=()=>(engine as any).refreshMetadata();
 await poll();assert.deepEqual(events,[]);
 meta={...meta,activity:'attention',attentionAt:10,updatedAt:3};await poll();await poll();
 meta={...meta,activity:'idle',completedAt:20,updatedAt:4};await poll();
 assert.deepEqual(events,[{id:'a',completed:false},{id:'a',completed:true}]);await engine.dispose();
});
test('engine never marks a terminal unread: terminals raise no notifications',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'harbor-unread-'));const createdAt=new Date().toISOString();
 const base={name:'Terminal',host:'local',cwd:dir,group:'',tags:[],pinned:false,archived:false,createdAt,updatedAt:createdAt,status:'closed'};
 await writeFile(path.join(dir,'sessions.json'),JSON.stringify({version:2,projects:[],sessions:[{...base,id:'s',tmuxName:'harbor-aaaa0',paneId:'%1',launcher:'shell'},{...base,id:'c',tmuxName:'harbor-aaaa1',paneId:'%2',launcher:'custom'},{...base,id:'a',tmuxName:'harbor-aaaa2',paneId:'%3',launcher:'claude'}]}));
 const engine=new HarborEngine(dir,new Transport('harbor-unread-test'));await engine.init(false);
 for(const id of ['s','c','a'])await engine.setUnread(id,true);
 assert.deepEqual(engine.snapshot().sessions.map(s=>s.unread),[undefined,undefined,true]);await engine.dispose();
});
