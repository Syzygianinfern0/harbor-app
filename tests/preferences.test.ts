import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HarborEngine } from '../src/engine/engine';
import { defaultPreferences, PreferencesStore, validatePreferences } from '../src/engine/preferences';
import { environment, Transport } from '../src/engine/transport';

test('preferences start local-only, persist edits and hide disabled hosts across restarts', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'harbor-preferences-'));
  const engine = new HarborEngine(directory); await engine.init(false);
  assert.deepEqual(engine.snapshot().hosts.map(host => host.id), ['local']);
  const preferences = engine.snapshot().preferences;
  preferences.hosts.push({ id: 'chosen', label: 'My server', source: 'manual', enabled: true, defaultDirectory: '~/work', connection: { target: 'example', hostname: 'localhost', user: 'alice', port: 2222, identityFile: '~/.ssh/test-key' } });
  preferences.terminal.fontSize = 16;
  preferences.sidebar.expandOnHover = false;
  await engine.savePreferences(preferences);
  assert.equal(engine.snapshot().hosts.length, 2);
  preferences.hosts[1].enabled = false; await engine.savePreferences(preferences);
  assert.deepEqual(engine.snapshot().hosts.map(host => host.id), ['local']);
  await assert.rejects(engine.create({ name: 'Blocked', host: 'chosen', cwd: '~', launcher: 'shell' }), /enabled host/);
  await engine.dispose();
  const restored = new HarborEngine(directory); await restored.init(false);
  assert.equal(restored.snapshot().preferences.terminal.fontSize, 16);
  assert.equal(restored.snapshot().preferences.sidebar.expandOnHover, false);
  assert.equal(restored.snapshot().preferences.hosts[1].connection?.port, 2222);
  assert.deepEqual(restored.snapshot().hosts.map(host => host.id), ['local']);
  assert.equal((await stat(path.join(directory, 'preferences.json'))).mode & 0o777, 0o600);
  await restored.refresh();
  assert.equal(restored.snapshot().hosts.length, 1, 'Status refresh must not repopulate hosts from SSH config');
  await restored.dispose();
});
test('editing or removing a profile never reroutes or destroys its existing sessions', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'harbor-frozen-host-'));
  const transport = new Transport(); const calls: { host: unknown; command: string }[] = [];
  transport.run = async (host, command) => { calls.push({ host, command }); return command.includes('new-session') ? 'HARBOR_PANE=%7\n' : ''; };
  const engine = new HarborEngine(directory, transport); await engine.init(false);
  const preferences = engine.snapshot().preferences;
  preferences.hosts.push({ id: 'saved', label: 'Research', source: 'ssh-config', enabled: true, defaultDirectory: '~', connection: { target: 'original', port: 2200 } });
  await engine.savePreferences(preferences);
  const session = await engine.create({ name: 'Existing', host: 'saved', cwd: '~', launcher: 'shell' });
  preferences.hosts[1].connection = { target: 'different', port: 9999 }; await engine.savePreferences(preferences);
  assert.deepEqual(session.connection, { target: 'original', port: 2200 });
  preferences.hosts.splice(1); await engine.savePreferences(preferences); await engine.refresh();
  assert.equal(engine.snapshot().sessions.length, 1);
  assert.deepEqual(calls.at(-1)?.host, { target: 'original', port: 2200 });
  assert.equal(engine.snapshot().hosts.length, 1);
  assert.ok(calls.every(call => !call.command.includes('kill-session')));
  await engine.dispose();
});
test('invalid preference files are preserved and unsafe SSH options are rejected', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'harbor-invalid-preferences-'));
  const file = path.join(directory, 'preferences.json'); await writeFile(file, '{invalid');
  await assert.rejects(new PreferencesStore(directory).load(), /preserved/);
  assert.equal(await readFile(file, 'utf8'), '{invalid');
  const preferences = defaultPreferences();
  preferences.hosts.push({ id: 'evil', label: 'invalid', source: 'manual', enabled: true, defaultDirectory: '~', connection: { target: '-oProxyCommand=bad' } });
  assert.throws(() => validatePreferences(preferences));
  preferences.hosts[1].connection = { target: 'valid', port: 70000 };
  assert.throws(() => validatePreferences(preferences), /port/);
});
test('SSH overrides use separate arguments; launcher environment drops color suppression', () => {
  const transport = new Transport();
  const args = transport.sshArgs({ target: 'alias', hostname: 'actual.example.com', user: 'alice', port: 2222, identityFile: '/tmp/a key' });
  assert.deepEqual(args.slice(-9), ['-o', 'Hostname=actual.example.com', '-l', 'alice', '-p', '2222', '-i', '/tmp/a key', 'alias']);
  assert.equal(transport.sshArgs({ target: 'old@alias', user: 'new' }).at(-1), 'alias', 'An explicit username must override a user embedded in the destination');
  const original = process.env.NO_COLOR; process.env.NO_COLOR = '1';
  try { assert.equal(environment().NO_COLOR, undefined); assert.equal(environment().TERM, 'xterm-256color'); assert.equal(environment().COLORTERM, 'truecolor'); }
  finally { if (original === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = original; }
});
