import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defaultApp, defaultOpenIn, menuApps, normalizeOpenIn, supportsConnection, type OpenInPreferences } from '../src/shared/openIn';
import { detectApps, interactiveSsh, launchPlan, remoteShellScript, runPlan, zedRemoteUrl } from '../src/desktop/openIn';
import { validatePreferences, defaultPreferences } from '../src/engine/preferences';

const prefs = (patch: Partial<OpenInPreferences> = {}): OpenInPreferences => ({ ...defaultOpenIn(), ...patch });
const nasty = "/data/My project 'x' $(touch pwned) `id` ; rm -rf ~ #你好";

test('open-in preferences load leniently: missing, unknown and malformed values fall back to defaults', () => {
  assert.deepEqual(normalizeOpenIn(undefined), defaultOpenIn());
  assert.deepEqual(normalizeOpenIn({ hidden: ['finder', 'sublime', 7, 'finder'], defaultApp: 'emacs', customLabel: 'Subl\u0007', customCommand: '  subl "$HARBOR_DIR"  ', extra: true }),
    { hidden: ['finder'], customLabel: '', customCommand: 'subl "$HARBOR_DIR"' });
  assert.deepEqual(normalizeOpenIn({ hidden: 'finder', defaultApp: 'zed', customLabel: 'x'.repeat(80) }), { hidden: [], defaultApp: 'zed', customLabel: 'x'.repeat(40), customCommand: '' });
  // Files written before Open in existed still validate, and get defaults.
  const { openIn: _, ...old } = defaultPreferences();
  assert.deepEqual(validatePreferences(old as never).openIn, defaultOpenIn());
  assert.deepEqual(validatePreferences({ ...defaultPreferences(), openIn: { hidden: ['nope'], defaultApp: 'cursor' } as never }).openIn, { hidden: [], defaultApp: 'cursor', customLabel: '', customCommand: '' });
});

test('menus list installed, shown apps that can open the folder, and the default falls back sensibly', () => {
  const installed = ['finder', 'terminal', 'iterm', 'vscode', 'cursor', 'zed'] as const;
  assert.deepEqual(menuApps(prefs(), installed, 'local'), ['finder', 'terminal', 'iterm', 'vscode', 'cursor', 'zed']);
  assert.deepEqual(menuApps(prefs({ customCommand: 'subl .' }), ['finder'], 'local'), ['finder', 'custom']);
  assert.deepEqual(menuApps(prefs({ hidden: ['iterm'] }), installed, 'devbox'), ['terminal', 'vscode', 'cursor', 'zed']);
  assert.deepEqual(menuApps(prefs(), installed, { target: 'devbox', hostname: 'gpu.example.invalid' }), ['terminal', 'iterm', 'vscode', 'cursor']);
  assert.equal(supportsConnection('finder', 'devbox'), false);
  assert.equal(supportsConnection('zed', { target: 'alice@devbox', port: 2222 }), true);
  assert.equal(defaultApp(prefs({ defaultApp: 'vscode' }), installed, 'local'), 'vscode');
  assert.equal(defaultApp(prefs({ defaultApp: 'finder' }), installed, 'devbox'), 'terminal');
  assert.equal(defaultApp(prefs({ defaultApp: 'vscode', hidden: ['vscode'] }), installed, 'local'), 'finder');
  assert.equal(defaultApp(prefs({ hidden: ['finder', 'terminal'] }), ['finder', 'terminal'], 'local'), undefined);
});

test('installed apps come from standard folders first, then Spotlight by bundle ID', async () => {
  const present = new Set(['/System/Library/CoreServices/Finder.app', '/System/Applications/Utilities/Terminal.app', '/Users/alice/Applications/Cursor.app']);
  const asked: string[] = [];
  const apps = await detectApps({ home: '/Users/alice', exists: async file => present.has(file), spotlight: async id => { asked.push(id); return id === 'com.microsoft.VSCode' ? ['/Users/alice/.Trash/Visual Studio Code.app', '/Volumes/Tools/Visual Studio Code.app'] : []; } });
  assert.deepEqual(apps, { finder: '/System/Library/CoreServices/Finder.app', terminal: '/System/Applications/Utilities/Terminal.app', cursor: '/Users/alice/Applications/Cursor.app', vscode: '/Volumes/Tools/Visual Studio Code.app' });
  assert.deepEqual(asked.sort(), ['com.googlecode.iterm2', 'com.microsoft.VSCode', 'dev.zed.Zed']);
});

test('local launches pass the folder as one argument to open, never through a shell', () => {
  for (const [app, appPath] of [['finder', '/System/Library/CoreServices/Finder.app'], ['terminal', '/System/Applications/Utilities/Terminal.app'], ['iterm', '/Applications/iTerm.app'], ['zed', '/Applications/Zed.app']] as const)
    assert.deepEqual(launchPlan(app, { cwd: nasty, connection: 'local' }, appPath, prefs()), { kind: 'exec', file: '/usr/bin/open', args: ['-a', appPath, nasty] });
  assert.deepEqual(launchPlan('vscode', { cwd: '/tmp', connection: 'local' }, '/Applications/Visual Studio Code.app', prefs()), { kind: 'editor', editor: 'vscode' });
  assert.deepEqual(launchPlan('cursor', { cwd: '/tmp', connection: 'devbox' }, '/Applications/Cursor.app', prefs()), { kind: 'editor', editor: 'cursor' });
  assert.throws(() => launchPlan('finder', { cwd: '-a', connection: 'local' }, '/x.app', prefs()), /absolute/);
  assert.throws(() => launchPlan('finder', { cwd: '/tmp/a\nb', connection: 'local' }, '/x.app', prefs()), /absolute/);
  assert.throws(() => launchPlan('finder', { cwd: '/tmp', connection: 'devbox' }, '/x.app', prefs()), /SSH hosts/);
  assert.throws(() => launchPlan('iterm', { cwd: '/tmp', connection: 'local' }, undefined, prefs()), /not found/);
  assert.throws(() => launchPlan('terminal', { cwd: '/tmp', connection: '-oProxyCommand=evil' }, '/T.app', prefs()), /valid SSH/);
  assert.throws(() => launchPlan('nope' as never, { cwd: '/tmp', connection: 'local' }, '/T.app', prefs()), /Unknown/);
});

test('remote terminals run a script that connects with ssh and starts a login shell in the folder', () => {
  assert.deepEqual(interactiveSsh({ target: 'old@devbox', user: 'alice', hostname: 'gpu.example.invalid', port: 2222, identityFile: '~/.ssh/a key' }, '/Users/alice'),
    ['-t', '-o', 'Hostname=gpu.example.invalid', '-l', 'alice', '-p', '2222', '-i', '/Users/alice/.ssh/a key', '--', 'devbox']);
  const terminal = launchPlan('terminal', { cwd: '/srv/app', connection: 'devbox' }, '/System/Applications/Utilities/Terminal.app', prefs());
  assert.equal(terminal.kind, 'exec');
  if (terminal.kind !== 'exec') return;
  assert.deepEqual(terminal.args, ['-a', '/System/Applications/Utilities/Terminal.app', '{script}']);
  assert.match(terminal.script!, /^#!\/bin\/sh\nrm -f -- "\$0"/);
  const iterm = launchPlan('iterm', { cwd: '/srv/app', connection: 'devbox' }, '/Applications/iTerm.app', prefs());
  if (iterm.kind !== 'exec') throw new Error('expected exec');
  assert.equal(iterm.file, '/usr/bin/osascript');
  assert.equal(iterm.args.at(-1), '{script}');
  assert.ok(iterm.args.includes('create window with default profile command (item 1 of argv)'));
});

test('the remote script survives hostile folder names: ssh gets exact arguments and the remote shell cds to the literal path', async () => {
  const dir = realpathSync(await mkdtemp(path.join(tmpdir(), 'harbor-openin-')));
  try {
    const folder = path.join(dir, "a 'b' $(touch pwned) `touch pwned2` \"c\" ; d");
    await mkdir(folder);
    // Stand-in ssh: records its arguments, then runs the remote command with sh like a real server would.
    const fakeSsh = path.join(dir, 'ssh'), record = path.join(dir, 'args'), shell = path.join(dir, 'login');
    await writeFile(fakeSsh, `#!/bin/sh\nfor a in "$@"; do printf '%s\\0' "$a"; done > '${record}'\neval "last=\\\${$#}"\nexec /bin/sh -c "$last"\n`, { mode: 0o700 });
    await writeFile(shell, `#!/bin/sh\npwd > '${path.join(dir, 'pwd')}'\n`, { mode: 0o700 });
    const scriptDir = path.join(dir, 'run'); await mkdir(scriptDir);
    const script = path.join(scriptDir, 'open.command');
    await writeFile(script, remoteShellScript({ cwd: folder, connection: { target: 'devbox', port: 2200 } }, '/Users/alice').replace('/usr/bin/ssh', fakeSsh));
    await chmod(script, 0o700);
    execFileSync('/bin/sh', [script], { cwd: dir, env: { PATH: '/usr/bin:/bin', SHELL: shell } });
    const args = (await readFile(record, 'utf8')).split('\0').slice(0, -1);
    assert.deepEqual(args.slice(0, -1), ['-t', '-p', '2200', '--', 'devbox']);
    assert.equal((await readFile(path.join(dir, 'pwd'), 'utf8')).trim(), folder);
    await assert.rejects(readFile(path.join(dir, 'pwned')));
    await assert.rejects(readFile(path.join(folder, 'pwned')));
    await assert.rejects(readFile(script), 'the script deletes itself');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Zed remote URLs carry user, host, port and an encoded path', () => {
  assert.equal(zedRemoteUrl({ cwd: '/srv/My app #1', connection: { target: 'devbox', user: 'alice', port: 2222 } }), 'ssh://alice@devbox:2222/srv/My%20app%20%231');
  assert.equal(zedRemoteUrl({ cwd: '/srv', connection: 'bob@devbox' }), 'ssh://bob@devbox/srv');
  const plan = launchPlan('zed', { cwd: '/srv', connection: 'devbox' }, '/Applications/Zed.app', prefs());
  assert.deepEqual(plan, { kind: 'exec', file: '/Applications/Zed.app/Contents/MacOS/cli', args: ['ssh://devbox/srv'] });
  assert.throws(() => launchPlan('zed', { cwd: '/srv', connection: { target: 'devbox', identityFile: '~/.ssh/k' } }, '/Applications/Zed.app', prefs()), /SSH hosts/);
});

test('custom commands get the folder and host in environment variables, not spliced into the command', async () => {
  assert.throws(() => launchPlan('custom', { cwd: '/tmp', connection: 'local' }, undefined, prefs()), /custom command/);
  const remote = launchPlan('custom', { cwd: nasty, connection: { target: 'old@devbox', user: 'alice' } }, undefined, prefs({ customCommand: 'echo "$HARBOR_DIR"' }), '/Users/alice');
  assert.deepEqual(remote, { kind: 'custom', command: 'echo "$HARBOR_DIR"', cwd: '/Users/alice', env: { HARBOR_DIR: nasty, HARBOR_HOST: 'alice@devbox' } });
  const dir = realpathSync(await mkdtemp(path.join(tmpdir(), 'harbor-custom-')));
  try {
    const out = path.join(dir, 'out');
    const local = launchPlan('custom', { cwd: dir, connection: 'local' }, undefined, prefs({ customCommand: `printf '%s|%s|%s' "$HARBOR_DIR" "$HARBOR_HOST" "$(pwd)" > '${out}'` }));
    await runPlan(local, 'Custom', { cwd: dir, connection: 'local' }, undefined);
    assert.equal(await readFile(out, 'utf8'), `${dir}||${dir}`);
    const failing = launchPlan('custom', { cwd: dir, connection: 'local' }, undefined, prefs({ customCommand: 'echo nope >&2; exit 3' }));
    await assert.rejects(runPlan(failing, 'My tool', { cwd: dir, connection: 'local' }, undefined), /Could not open in My tool\. nope/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
