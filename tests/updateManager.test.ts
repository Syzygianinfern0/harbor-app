import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { UpdateManager, UPDATE_CHECK_INTERVAL } from '../src/engine/updateManager';
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
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(manager.snapshot().running,'local:codex');release();await job;
  assert.deepEqual(calls,['local:codex','offline:codex','remote:claude']);
  const state=manager.snapshot();assert.equal(state.completed,3);assert.equal(state.total,3);assert.equal(state.updatingAll,false);
  assert.match(state.results['offline:codex'].message,/SSH connection lost/);assert.match(state.results['remote:claude'].message,/Verified/);
  assert.equal(state.updates.find(r=>r.hostId==='remote')?.status,'current');
  const restored=new UpdateManager(dir,()=>'',async()=>[],async()=>{throw new Error('unused');},()=>{});await restored.load();assert.equal(restored.snapshot().updates.find(r=>r.hostId==='remote')?.installed,'1.1.0');
});
