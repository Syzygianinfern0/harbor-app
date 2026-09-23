import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { HarborEngine } from '../src/engine/engine';
import { Transport, quote } from '../src/engine/transport';

// Query from a real raw-mode PTY, not a mocked control-protocol response.
const probe = `import json, os, pathlib, select, time, tty
tty.setraw(0)
for i in range(3):
 if i:
  while not pathlib.Path('go'+str(i)).exists(): time.sleep(.02)
 os.write(1,b'\\x1b]10;?\\x07\\x1b]11;?\\x07')
 data=b''; deadline=time.monotonic()+.5
 while time.monotonic()<deadline:
  if select.select([0],[],[],.05)[0]: data+=os.read(0,4096)
 pathlib.Path('result'+str(i)).write_text(json.dumps(data.decode()))
time.sleep(60)
`;

for (const host of ['local', ...(process.env.HARBOR_TEST_SSH ? [process.env.HARBOR_TEST_SSH] : [])]) {
  test(`terminal colors on ${host}: startup, attachment, reattachment and resume`, { timeout: 60000 }, async t => {
    const transport = new Transport('harbor-colors-' + randomUUID().slice(0, 8));
    const run = (script: string) => transport.run(host, transport.setup() + script);
    const remoteDir = (await run('mktemp -d /tmp/harbor-colors.XXXXXXXX')).trim();
    const engine = new HarborEngine(await mkdtemp(path.join(tmpdir(), 'harbor-colors-data-')), transport);
    t.after(async () => {
      await engine.dispose();
      await run(transport.tmux(['kill-server'])).catch(() => {});
      await run(`rm -rf -- ${quote(remoteDir)}`);
    });
    await engine.init(false);
    if (host !== 'local') {
      const preferences = engine.snapshot().preferences;
      preferences.hosts.push({ id: host, label: host, source: 'manual', enabled: true, defaultDirectory: remoteDir, connection: { target: host } });
      await engine.savePreferences(preferences);
    }
    const session = await engine.create({ name: 'Color query', host, cwd: remoteDir, launcher: 'custom', command: `python3 -c ${quote(probe)}` });
    const commands = await run(transport.tmux(['list-commands']));
    const reportsColors = /^refresh-client\b[^\n]*\[-r /m.test(commands);
    if (host === 'local') assert.ok(reportsColors, 'local regression must exercise color-reporting tmux');
    const expected = '\x1b]10;rgb:dcdc/e1e1/ebeb\x07\x1b]11;rgb:1010/1212/1717\x07';
    const readResult = async (i: number) => {
      const file = quote(`${remoteDir}/result${i}`);
      // Login-shell startup can exceed 2.5 seconds during the parallel suite.
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const result = await run(`if test -f ${file}; then cat ${file}; fi`);
        if (result) return (JSON.parse(result) as string).replace(/rgb:([0-9a-f]+)\/([0-9a-f]+)\/([0-9a-f]+)/g,
          (_match, ...channels) => 'rgb:' + channels.slice(0, 3).map(c => c.length === 2 ? c.repeat(2) : c).join('/'));
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.fail(`color query ${i} did not complete`);
    };
    assert.equal(await readResult(0), expected, 'colors must be correct before any renderer attaches');
    // Remove the bootstrap style to verify that attach explicitly reports the
    // theme, including for existing panes created by older Harbor builds.
    await run(transport.tmux(['select-pane', '-t', session.paneId, '-P', 'default']));
    await engine.attach(session.id, 100, 28);
    await run(`touch ${quote(`${remoteDir}/go1`)}`);
    assert.equal(await readResult(1), reportsColors ? expected : '', 'attachment must report colors when supported; older tmux must retain its fallback');
    engine.detach(session.id);
    await engine.attach(session.id, 100, 28);
    await run(`touch ${quote(`${remoteDir}/go2`)}`);
    assert.equal(await readResult(2), reportsColors ? expected : '', 'reattachment must preserve colors without leaking input');
    await engine.terminate(session.id);
    await run(`rm -f ${quote(`${remoteDir}/result0`)} ${quote(`${remoteDir}/go1`)} ${quote(`${remoteDir}/go2`)}`);
    await engine.resume(session.id);
    assert.equal(await readResult(0), expected, 'resumed apps must also start with correct colors');
  });
}
