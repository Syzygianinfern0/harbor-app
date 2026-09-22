import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm, chmod } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { HarborEngine } from '../src/engine/engine';
import { Transport } from '../src/engine/transport';

test('folder completion lists real folders, handles literal paths, filtering, home, errors and result limits', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'harbor-folders-'));
  const engine = new HarborEngine(dir); await engine.init(false);
  t.after(async () => {await engine.dispose(); await rm(dir, {recursive:true, force:true});});
  const root = path.join(dir, 'folders'); await mkdir(root);
  const names = ['Alpha', 'Alpine', 'my alpha', '.hidden', "space 'quotes' $(literal) 你好"];
  await Promise.all(names.map(name => mkdir(path.join(root, name))));
  await writeFile(path.join(root, 'a-file'), '');
  await symlink(path.join(root, 'Alpha'), path.join(root, 'linked'));
  await symlink(path.join(root, 'missing'), path.join(root, 'broken'));
  const listing = await engine.listDirectories('local', root + '/', false);
  assert.deepEqual(listing.entries.map(e => e.name), ['Alpha', 'Alpine', 'linked', 'my alpha', names[4]]);
  assert.equal(listing.directory, root); assert.equal(listing.parent, dir);
  assert.deepEqual((await engine.listDirectories('local', root + '/AL', false)).entries.map(e => e.name), ['Alpha', 'Alpine', 'my alpha', names[4]]);
  assert.deepEqual((await engine.listDirectories('local', root + '/.', false)).entries.map(e => e.name), ['.hidden']);
  assert.ok((await engine.listDirectories('local', root, true)).entries.some(e => e.name === '.hidden'));
  assert.equal((await engine.listDirectories('local', path.join(root, names[4]) + '/', false)).directory, path.join(root, names[4]));
  assert.equal((await engine.listDirectories('local', '~', false)).directory, homedir());
  assert.equal((await engine.listDirectories('local', '/', false)).parent, null);
  assert.equal((await engine.listDirectories('local', root + '/nothing-matches', false)).entries.length, 0);
  await assert.rejects(engine.listDirectories('local', root + '/missing/', false), /Folder not found/);
  const locked = path.join(root, 'locked'); await mkdir(locked); await chmod(locked, 0);
  try {await assert.rejects(engine.listDirectories('local', locked + '/', false), /Permission denied/);} finally {await chmod(locked, 0o700);}
  await Promise.all(Array.from({length:205}, (_, i) => mkdir(path.join(root, `many-${i}`))));
  const many = await engine.listDirectories('local', root + '/many-', false);
  assert.equal(many.entries.length, 200); assert.equal(many.truncated, true);
  assert.equal((await engine.listDirectories('local', root + '/many-204', false)).directory, root + '/many-204');
  await assert.rejects(engine.listDirectories('missing', '~', false), /enabled host/);
  await assert.rejects(engine.listDirectories('local', 'x\n', false), /Invalid/);
});

test('folder completion routes to the saved SSH connection and never falls back to local', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'harbor-folders-remote-'));
  const transport = new Transport(); const engine = new HarborEngine(dir, transport); await engine.init(false);
  t.after(async () => {await engine.dispose(); await rm(dir, {recursive:true, force:true});});
  const connection = {target:'research', hostname:'server.example', user:'alice', port:2222, identityFile:'/tmp/a key'};
  const prefs = engine.snapshot().preferences;
  prefs.hosts.push({id:'remote', label:'Research', source:'manual', enabled:true, defaultDirectory:'~', connection});
  await engine.savePreferences(prefs);
  const calls: unknown[] = [];
  transport.run = async (host, command) => {
    calls.push(host);
    return command.includes(' directories ') ? JSON.stringify({directory:'/remote/home',home:'/remote/home',parent:'/remote',query:'',entries:[],truncated:false}) : '';
  };
  assert.equal((await engine.listDirectories('remote', '~', false)).home, '/remote/home');
  assert.ok(calls.length >= 2); assert.ok(calls.every(host => JSON.stringify(host) === JSON.stringify(connection)));
  transport.run = async () => {throw new Error('SSH unavailable');};
  await assert.rejects(engine.listDirectories('remote', '~', false), /SSH unavailable/);
});

if (process.env.HARBOR_TEST_SSH) test('live SSH folder browsing resolves home and children on the remote host', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'harbor-folder-ssh-'));
  const engine = new HarborEngine(dir); await engine.init(false);
  t.after(async () => {await engine.dispose(); await rm(dir, {recursive:true, force:true});});
  const prefs = engine.snapshot().preferences;
  prefs.hosts.push({id:'remote-test',label:'Remote test',source:'manual',enabled:true,defaultDirectory:'~',connection:{target:process.env.HARBOR_TEST_SSH!}});
  await engine.savePreferences(prefs);
  const home = await engine.listDirectories('remote-test', '~', false);
  assert.ok(home.home.startsWith('/')); assert.equal(home.directory, home.home);
  assert.ok(home.entries.length);
  const child = await engine.listDirectories('remote-test', home.entries[0].path + '/', false);
  assert.equal(child.directory, home.entries[0].path);
});
