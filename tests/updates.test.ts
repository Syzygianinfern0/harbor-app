import test from 'node:test';
import assert from 'node:assert/strict';
import { agentUpdateScript, installAgentUpdate, updateMachines } from '../src/engine/updates';
import { mkdtemp, mkdir, writeFile, symlink, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Transport } from '../src/engine/transport';
import type { Project, SavedHost } from '../src/shared/types';

test('update targets distinguish a saved host from projects with older connection settings',()=>{
 const hosts=[{id:'remote',label:'Remote',enabled:true,connection:{target:'new'}}] as SavedHost[];
 const projects=[{hostId:'remote',hostLabel:'Remote',connection:{target:'old'}},{hostLabel:'Duplicate',connection:{target:'new'}}] as Project[];
 const machines=updateMachines(hosts,projects);
 assert.equal(machines.length,2);assert.notEqual(machines[0].id,machines[1].id);
});
test('standalone Codex updates the active symlink target without invoking npm or brew',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'harbor-standalone-'));
 try {
  const bin=path.join(dir,'bin'),release=path.join(dir,'custom-codex-home/packages/standalone/releases/0.154.0-test/bin');
  await mkdir(bin);await mkdir(release,{recursive:true});
  const log=path.join(dir,'invoked');
  await writeFile(path.join(release,'codex'),'#!/bin/sh\nprintf "%s\\n" "$0" "$@" > "$UPDATE_TEST_LOG"\n',{mode:0o755});
  await symlink('../custom-codex-home/packages/standalone/releases/0.154.0-test/bin/codex',path.join(bin,'codex'));
  for(const name of ['npm','brew'])await writeFile(path.join(bin,name),'#!/bin/sh\nexit 97\n',{mode:0o755});
  const env={...process.env,PATH:`${bin}:/usr/bin:/bin`,UPDATE_TEST_LOG:log};
  await promisify(execFile)('/bin/bash',['--noprofile','--norc','-c',agentUpdateScript('codex')],{env});
  assert.equal(await readFile(log,'utf8'),`${bin}/codex\nupdate\n`);
  await writeFile(path.join(release,'codex'),'#!/bin/sh\necho "update failed" >&2\nexit 42\n',{mode:0o755});
  await assert.rejects(promisify(execFile)('/bin/bash',['--noprofile','--norc','-c',agentUpdateScript('codex')],{env}),/update failed/);
  await rm(path.join(bin,'codex'));await writeFile(path.join(bin,'codex'),'#!/bin/sh\nexit 0\n',{mode:0o755});
  await assert.rejects(promisify(execFile)('/bin/bash',['--noprofile','--norc','-c',agentUpdateScript('codex')],{env}),/Unsupported installation path/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('updates run once, use the original connection, and propagate failures without retry',async()=>{
 const transport=new Transport();let calls=0;
 transport.run=async(host,script,options)=>{calls++;assert.deepEqual(host,{target:'remote'});assert.equal(options?.retry,undefined);assert.equal(options?.timeout,180000);assert.match(script,/npm install -g @openai\/codex@latest/);assert.match(script,/Unsupported installation path/);throw new Error('connection lost');};
 await assert.rejects(installAgentUpdate(transport,{target:'remote'},'codex'),/connection lost/);assert.equal(calls,1);
 await assert.rejects(installAgentUpdate(transport,'local','bad' as any),/Unknown agent/);assert.equal(calls,1);
});
