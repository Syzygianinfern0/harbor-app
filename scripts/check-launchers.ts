// Explicit opt-in smoke check. Starts real CLIs but never submits prompts or grants trust.
import { HarborEngine } from '../src/engine/engine';
import { Transport } from '../src/engine/transport';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

for (const host of ['local', ...(process.env.HARBOR_TEST_SSH ? [process.env.HARBOR_TEST_SSH] : [])]) {
  const transport = new Transport('harbor-launcher-test-' + randomUUID().slice(0, 8));
  const engine = new HarborEngine(await mkdtemp(path.join(tmpdir(), 'harbor-launchers-')), transport);
  await engine.init(false);
    if (host !== 'local') {
      const preferences = engine.snapshot().preferences;
      preferences.hosts.push({ id: host, label: host, source: 'manual', enabled: true, defaultDirectory: '~/harbor-smoke-test-20260916', connection: { target: host } });
      await engine.savePreferences(preferences);
    }

  try {
    for (const launcher of ['codex', 'claude'] as const) {
      let output = '';
      const session = await engine.create({ name: `${launcher} startup check`, host, cwd: host === 'local' ? process.cwd() : '~/harbor-smoke-test-20260916', launcher });
      const listener = (event: { id: string; type: string; data: string }) => { if (event.id === session.id && event.type === 'data') output += Buffer.from(event.data, 'base64').toString(); };
      engine.on('terminal', listener);
      await engine.attach(session.id, 110, 32);
      const start = Date.now();
      while (Date.now() - start < 12000 && !/Codex|Claude Code|trust this|trust the|trust.*folder|workspace.*trust/i.test(output)) await new Promise(resolve => setTimeout(resolve, 250));
      await engine.refresh();
      const state = engine.snapshot().sessions.find(s => s.id === session.id)!;
      const result = { host, launcher, status: state.status, startupScreen: /Codex|Claude Code|trust this|trust the|trust.*folder|workspace.*trust/i.test(output), bytes: output.length, process: state.detail };
      console.log(JSON.stringify(result));
      if (state.status !== 'running' || !result.startupScreen) process.exitCode = 1;
      await engine.terminate(session.id);
      engine.off('terminal', listener);
    }
  } finally { await engine.dispose(); await transport.run(host, transport.setup() + transport.tmux(['kill-server'])).catch(() => {}); }
}
