import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HarborEngine } from '../src/engine/engine';
import { Transport } from '../src/engine/transport';
import { onlyArtifactWatches } from '../src/shared/chatStatus';

const watch=(id:string)=>`live updates for artifact https://claude.ai/artifact/${id} (auto-reply on)`;
test('only artifact watches are recognised as a finished turn',()=>{
 assert.equal(onlyArtifactWatches(`1 background task running: ${watch('a')}`),true);
 assert.equal(onlyArtifactWatches(`2 background tasks running: ${watch('a')}; ${watch('b')}`),true);
 assert.equal(onlyArtifactWatches(`2 background tasks running: ${watch('a')}; Run the test suite`),false);
 assert.equal(onlyArtifactWatches(`4 background tasks running: ${watch('a')}; ${watch('b')}; ${watch('c')}; +1 more`),false);
 assert.equal(onlyArtifactWatches('Turn finished; 1 background terminal still running: live updates for artifact x'),false);
 assert.equal(onlyArtifactWatches(undefined),false);
});
test('engine settles a watch-only wait from an older bridge without a spurious notification',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'harbor-watch-'));const engine=new HarborEngine(dir,new Transport('harbor-watch-test'));await engine.init(false);
 const createdAt=new Date().toISOString();
 (engine as any).sessions.push({id:'a',tmuxName:'harbor-aaaa0',paneId:'%1',name:'Chat',host:'local',cwd:dir,launcher:'claude',group:'',tags:[],pinned:false,archived:false,createdAt,updatedAt:createdAt,status:'running',generation:'g',activity:'background',activityAt:5,completedAt:1});
 const events:boolean[]=[];engine.on('attention',({completed})=>events.push(completed));
 let meta:Record<string,unknown>={generation:'g',activity:'background',reason:`1 background task running: ${watch('a')}`,completedAt:1,updatedAt:5};
 (engine as any).bridge={metadata:async()=>({a:meta})};const poll=()=>(engine as any).refreshMetadata();
 await poll();let [session]=engine.snapshot().sessions;
 assert.equal(session.activity,'idle');assert.equal(session.activityDetail,'');assert.equal(session.completedAt,5);assert.deepEqual(events,[],'already on screen');
 meta={...meta,activity:'working',reason:'',updatedAt:6};await poll();
 meta={...meta,activity:'background',reason:`1 background task running: ${watch('a')}`,updatedAt:7};await poll();
 [session]=engine.snapshot().sessions;assert.equal(session.completedAt,7);assert.deepEqual(events,[true],'a new watch-only stop is a finished turn');
 meta={...meta,activity:'background',reason:'1 background task running: Run the test suite',updatedAt:8};await poll();
 assert.equal(engine.snapshot().sessions[0].activity,'background');await engine.dispose();
});
