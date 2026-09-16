import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { HarborEngine, validateCreate } from '../src/engine/engine';
import { ControlParser, decodeOutput } from '../src/engine/control';
import { discoverHosts } from '../src/engine/hosts';
import { Transport, quote, validateHost } from '../src/engine/transport';

test('control parser preserves binary and split UTF-8, recognizes guarded command responses', () => {
  assert.deepEqual(decodeOutput(Buffer.from('a\\015\\012\\134\\000')), Buffer.from([97, 13, 10, 92, 0]));
  const parser = new ControlParser(); const output: Buffer[] = []; const responses: unknown[] = [];
  parser.on('output', (pane, bytes) => { assert.equal(pane, '%4'); output.push(bytes); });
  parser.on('response', response => responses.push(response));
  const data = Buffer.from('%begin 123 10 1\n%output this is command text\n%end 123 10 1\n%output %4 你好\\015\\012\n%begin 123 11 1\nno such pane\n%error 123 11 1\n');
  for (const byte of data) parser.feed(Buffer.from([byte]));
  assert.equal(Buffer.concat(output).toString(), '你好\r\n');
  assert.deepEqual(responses, [{ ok: true, text: '%output this is command text' }, { ok: false, text: 'no such pane' }]);
});
test('SSH discovery follows Include globs and skips wildcard and negated hosts', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'harbor-hosts-'));
  await mkdir(path.join(home, '.ssh/conf.d'), { recursive: true });
  await writeFile(path.join(home, '.ssh/config'), 'Host * !bad *.example.org\nInclude conf.d/*\nHost = alpha beta # not-a-host\nInclude config\n');
  await writeFile(path.join(home, '.ssh/conf.d/hosts'), 'Host "gamma"\n  Hostname something\n');
  const hosts = await discoverHosts(path.join(home, '.ssh/config'), home);
  assert.deepEqual(hosts.map(h => h.id), ['local', 'alpha', 'beta', 'gamma']);
});
test('host validation blocks option and command injection; shell quoting preserves literals', () => {
  for (const host of ['-oProxyCommand=bad', 'host;id', 'host\ncommand', 'host space']) assert.throws(() => validateHost(host));
  assert.equal(validateHost('name@my-host'), 'name@my-host');
  assert.equal(quote("a'b"), "'a'\\''b'");
  assert.throws(() => validateCreate({ name: 'x', cwd: '~', host: 'local', launcher: 'shell', env: { 'A;bad': 'x' } }));
  assert.throws(() => validateCreate({ name: 'x', cwd: 'relative/path', host: 'local', launcher: 'shell' }));
});
async function eventually(check: () => Promise<boolean> | boolean, message: string, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.fail(message);
}
for (const host of ['local', ...(process.env.HARBOR_TEST_SSH ? [process.env.HARBOR_TEST_SSH] : [])]) {
  test(`real tmux on ${host}: input, resize, metadata, detach, engine restart, exit, explicit termination`, { timeout: 90000 }, async t => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'harbor-engine-'));
    const transport = new Transport('harbor-test-' + randomUUID().slice(0, 8));
    let engine = new HarborEngine(dataDir, transport); await engine.init(false);
    if (host !== 'local') {
      const preferences = engine.snapshot().preferences;
      preferences.hosts.push({ id: host, label: host, source: 'manual', enabled: true, defaultDirectory: '~/harbor-smoke-test-20260916', connection: { target: host } });
      await engine.savePreferences(preferences);
    }

    t.after(async () => { await engine.dispose(); await transport.run(host, transport.setup() + transport.tmux(['kill-server'])).catch(() => {}); });
    const diagnosis = await engine.diagnose(host); assert.equal(diagnosis.ok, true, diagnosis.error);
    const testDir = host === 'local' ? path.join(dataDir, "folder with 'quotes' and $dollars") : '~/harbor-smoke-test-20260916';
    if (host === 'local') await mkdir(testDir);
    const session = await engine.create({ name: 'Real shell test', host, cwd: testDir, launcher: 'custom', command: 'printf "BOOT:%s\\n" "$HARBOR_TEST_VALUE"; exec bash --noprofile --norc', env: { HARBOR_TEST_VALUE: "it's $literal; 你好" }, group: 'Tests', tags: ['integration'] });
    const persisted = await readFile(path.join(dataDir, 'sessions.json'), 'utf8');
    assert.equal(JSON.parse(persisted).sessions[0].env, undefined); assert.ok(!persisted.includes("it's $literal"));
    let output = '';
    engine.on('terminal', event => { if (event.type === 'data') output += Buffer.from(event.data, 'base64').toString(); });
    await engine.attach(session.id, 100, 28);
    await eventually(() => output.includes("BOOT:it's $literal; 你好"), 'Initial output including exact environment value should be restored');
    // Rapid tab switches must cancel the old attach without detaching the replacement.
    const staleAttach = engine.attach(session.id, 100, 28).catch(() => {});
    engine.detach(session.id);
    const freshAttach = engine.attach(session.id, 100, 28);
    await Promise.all([staleAttach, freshAttach]);
    output = '';
    await engine.input(session.id, "printf 'COLOR_ENV:%s:%s:%s\\n' \"$TERM\" \"$COLORTERM\" \"${NO_COLOR-unset}\"\r");
    await eventually(() => output.includes('COLOR_ENV:xterm-256color:truecolor:unset'), 'Color-capable environment must reach the real session');
    await engine.input(session.id, "printf '\\033[31mCOLOR_RED\\033[0m \\033[38;2;12;210;125mCOLOR_RGB\\033[0m\\n'\r");
    await eventually(() => output.includes('\x1b[31mCOLOR_RED') && output.includes('\x1b[38;2;12;210;125mCOLOR_RGB'), 'ANSI and true color must survive live control-mode output');
    output = '';
    await engine.input(session.id, "printf 'INPUT_%s\\n' 'OK_你好'\r");
    await eventually(() => output.includes('INPUT_OK_你好'), 'UTF-8 keyboard input should reach the real shell');
    await engine.paste(session.id, "printf 'PASTE_%s\\n' 'OK_你好'");
    await engine.input(session.id, '\r');
    await eventually(() => output.includes('PASTE_OK_你好'), 'Pasting must preserve bytes and use the pane bracketed-paste state');
    await engine.input(session.id, "printf 'CWD_OK:%s\\n' \"$PWD\"\r");
    await eventually(() => output.includes('CWD_OK:' + (host === 'local' ? testDir : diagnosis.home + '/harbor-smoke-test-20260916')), 'The session must start in the requested folder');
    await engine.resize(session.id, 91, 25);
    const size = await transport.run(host, transport.setup() + transport.tmux(['display-message', '-p', '-t', session.paneId, '#{pane_width},#{pane_height}']));
    assert.equal(size.trim(), '91,25');
    await engine.update(session.id, { pinned: true, name: 'Renamed', archived: true });
    await engine.refresh(); assert.equal(engine.snapshot().sessions[0].status, 'running');
    await engine.input(session.id, "(sleep 1; printf 'SURVIVED_%s\\n' 'DETACH') &\r");
    await engine.dispose();
    await new Promise(resolve => setTimeout(resolve, 1600));
    engine = new HarborEngine(dataDir, transport); await engine.init(false); await engine.refresh();
    assert.equal(engine.snapshot().sessions[0].status, 'running');
    assert.equal(engine.snapshot().sessions[0].pinned, true); assert.equal(engine.snapshot().sessions[0].archived, true);
    output = ''; engine.on('terminal', event => { if (event.type === 'data') output += Buffer.from(event.data, 'base64').toString(); });
    await engine.attach(session.id, 100, 28);
    await eventually(() => output.includes('SURVIVED_DETACH'), 'Background work must continue while the app is closed');
    await engine.input(session.id, 'exit\r');
    await eventually(async () => { await engine.refresh(); return engine.snapshot().sessions[0].status === 'closed'; }, 'Exited chat should be marked closed');
    await engine.terminate(session.id); await engine.refresh(); assert.equal(engine.snapshot().sessions[0].status, 'closed', engine.snapshot().sessions[0].detail);
  });
}
test('unreachable host never triggers a mutation or kills its sessions', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'harbor-offline-')); const transport = new Transport('harbor-offline');
  const calls: string[] = [];
  transport.run = async (_host, script) => { calls.push(script); throw new Error('Connection timed out'); };
  await writeFile(path.join(dataDir, 'sessions.json'), JSON.stringify({ version: 1, sessions: [{ id: 'offline', tmuxName: 'harbor-aaaa', paneId: '%1', name: 'Offline', host: 'remote', cwd: '~', launcher: 'shell', group: 'Tests', tags: [], pinned: false, archived: false }] }));
  const engine = new HarborEngine(dataDir, transport); await engine.init(false); await engine.refresh(); await engine.refresh(); await engine.dispose();
  assert.equal(engine.snapshot().sessions[0].status, 'unreachable');
  assert.ok(calls.every(command => !command.includes('kill-') && !command.includes('new-session')));
});
