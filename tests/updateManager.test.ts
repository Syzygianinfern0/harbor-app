import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PARALLEL_HOSTS, UpdateManager, UPDATE_CHECK_INTERVAL } from '../src/engine/updateManager';
import type { AgentUpdate } from '../src/shared/types';
const row = (hostId: string, agent: AgentUpdate['agent'] = 'codex', status: AgentUpdate['status'] = 'available'): AgentUpdate => ({hostId,hostLabel:hostId,agent,status,installed:'1.0.0',latest:'1.1.0',checkedAt:new Date().toISOString()});

test('automatic checks coalesce, survive restart, respect daily TTL and react to changed hosts', async t => {
  const dir=await mkdtemp(path.join(tmpdir(),'harbor-auto-updates-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  let now=10000000, calls=0, targets='local';
  const check=async()=>{calls++; await new Promise(resolve=>setTimeout(resolve,5)); return [row('local')];};
  const make=()=>new UpdateManager(dir,()=>targets,check,async()=>{throw new Error('Checks must not install');},()=>{},()=>now);
  let manager=make();await manager.load();
  await Promise.all([manager.check(false),manager.check(false),manager.check()]);assert.equal(calls,1);
  manager=make();await manager.load();await manager.check(false);assert.equal(calls,1);
  now+=UPDATE_CHECK_INTERVAL;await manager.check(false);assert.equal(calls,2);
  targets='local+remote';await manager.check(false);assert.equal(calls,3);
  await manager.check();assert.equal(calls,4);
});
test('failed machines retry after an hour rather than waiting an entire day',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'harbor-update-retry-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  let now=10000,calls=0;
  const manager=new UpdateManager(dir,()=>'',async()=>{calls++;return [row('offline','codex','unknown')];},async()=>{throw new Error('not used');},()=>{},()=>now);
  await manager.check(false);now+=59*60*1000;await manager.check(false);assert.equal(calls,1);
  now+=60*1000;await manager.check(false);assert.equal(calls,2);
});
test('update all verifies every available agent, continues after failure, prevents duplicate installs and preserves progress',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'harbor-update-all-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const rows=[row('local'),row('offline'),row('remote','claude'),row('missing','codex','missing'),row('unknown','claude','unknown'),row('current','codex','current')];
  const calls:string[]=[];let release!:()=>void;
  const gate=new Promise<void>(resolve=>release=resolve);
  const manager=new UpdateManager(dir,()=>'',async()=>rows,async(host,agent)=>{
    calls.push(host+':'+agent);if(host==='local')await gate;if(host==='offline')throw new Error('SSH connection lost');
    return {update:{...row(host,agent),status:'current',installed:'1.1.0'},output:'updated'};
  },()=>{});
  const job=manager.updateAll();
  await assert.rejects(manager.updateAll(),/already running/);await assert.rejects(manager.install('local','codex'),/already running/);
  await new Promise(resolve=>setTimeout(resolve,20));assert.ok(manager.snapshot().installing.includes('local:codex'));release();await job;
  assert.deepEqual([...calls].sort(),['local:codex','offline:codex','remote:claude']);
  const state=manager.snapshot();assert.equal(state.completed,3);assert.equal(state.total,3);assert.equal(state.updatingAll,false);assert.deepEqual(state.installing,[]);assert.deepEqual(state.queued,[]);
  assert.match(state.results['offline:codex'].message,/SSH connection lost/);assert.match(state.results['remote:claude'].message,/Verified/);
  assert.equal(state.updates.find(r=>r.hostId==='remote')?.status,'current');
  const restored=new UpdateManager(dir,()=>'',async()=>[],async()=>{throw new Error('unused');},()=>{});await restored.load();assert.equal(restored.snapshot().updates.find(r=>r.hostId==='remote')?.installed,'1.1.0');
});
test('update all runs machines in parallel, agents on one machine one at a time, and caps concurrent machines',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'harbor-update-parallel-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const hosts=['a','b','c','d','e','f'];
  const rows=hosts.flatMap(host=>[row(host,'codex'),row(host,'claude')]);
  const active=new Map<string,number>();let peak=0,overlapOnHost=false;const gates:(()=>void)[]=[];
  const manager=new UpdateManager(dir,()=>'',async()=>rows,async(host,agent)=>{
    active.set(host,(active.get(host)??0)+1);if(active.get(host)!>1)overlapOnHost=true;
    peak=Math.max(peak,[...active.values()].filter(Boolean).length);
    await new Promise<void>(resolve=>gates.push(resolve));
    active.set(host,active.get(host)!-1);
    return {update:{...row(host,agent),status:'current',installed:'1.1.0'},output:''};
  },()=>{});
  const job=manager.updateAll();
  const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
  const until=async(ready:()=>boolean)=>{for(let i=0;i<400&&!ready();i++)await tick();assert.ok(ready());};
  await until(()=>gates.length===PARALLEL_HOSTS);
  let state=manager.snapshot();
  assert.equal(state.installing.length,PARALLEL_HOSTS,'one install per machine, up to the cap');
  assert.equal(new Set(state.installing.map(key=>key.split(':')[0])).size,PARALLEL_HOSTS);
  assert.equal(state.queued.length,rows.length-PARALLEL_HOSTS);
  // A row on a machine still waiting its turn is refused rather than racing Update all.
  await assert.rejects(manager.install('f','codex'),/already running on this machine/);
  gates.shift()!();await until(()=>manager.snapshot().completed===1);
  await until(()=>gates.length===PARALLEL_HOSTS);
  while(gates.length||manager.snapshot().updatingAll){gates.shift()?.();await tick();}
  await job;
  state=manager.snapshot();
  assert.equal(state.completed,rows.length);assert.ok(state.updates.every(r=>r.status==='current'));
  assert.equal(overlapOnHost,false);assert.equal(peak,PARALLEL_HOSTS);
});
test('single installs on different machines run together, but not twice on one machine',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'harbor-update-single-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const rows=[row('a','codex'),row('a','claude'),row('b','codex')];const gates:(()=>void)[]=[];
  const manager=new UpdateManager(dir,()=>'',async()=>rows,async(host,agent)=>{
    await new Promise<void>(resolve=>gates.push(resolve));
    return {update:{...row(host,agent),status:'current',installed:'1.1.0'},output:''};
  },()=>{});
  await manager.check();
  const first=manager.install('a','codex');const second=manager.install('b','codex');
  await assert.rejects(manager.install('a','claude'),/already running on this machine/);
  await assert.rejects(manager.updateAll(),/already running/);
  assert.deepEqual([...manager.snapshot().installing].sort(),['a:codex','b:codex']);
  gates.forEach(release=>release());await Promise.all([first,second]);
  assert.deepEqual(manager.snapshot().installing,[]);
  const third=manager.install('a','claude');for(let i=0;i<400&&gates.length<3;i++)await new Promise(resolve=>setTimeout(resolve,5));gates[2]();await third;
  assert.equal(manager.snapshot().updates.filter(r=>r.status==='current').length,3);
});
