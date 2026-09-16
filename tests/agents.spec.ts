import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Transport } from '../src/engine/transport';

function hasChromaticColor(screen: string) {
  return /\x1b\[(?:3[1-6]|9[1-6])m/.test(screen) || /\x1b\[38;5;[1-6]m/.test(screen) || [...screen.matchAll(/\x1b\[38;2;(\d+);(\d+);(\d+)m/g)].some(([, red, green, blue]) => red !== green || green !== blue);
}

for (const host of ['local', ...(process.env.HARBOR_TEST_SSH ? [process.env.HARBOR_TEST_SSH] : [])]) {
  for (const launcher of ['codex', 'claude'] as const) {
    test(`${launcher} renders inside Harbor on ${host}`, async () => {
      test.skip(!process.env.HARBOR_TEST_AGENTS, 'Set HARBOR_TEST_AGENTS=1 to launch the real CLIs.');
      const directory = await mkdtemp(path.join(tmpdir(), `harbor-${launcher}-ui-`));
      const application = await electron.launch({ executablePath: process.env.HARBOR_TEST_APP, args: process.env.HARBOR_TEST_APP ? [] : ['.'], env: { ...process.env, HARBOR_DATA_DIR: directory, NO_COLOR: '1' } });
      const page = await application.firstWindow();
      const transport = new Transport();
      let tmuxName: string | undefined;
      try {
        if (host !== 'local') await page.evaluate(async host => {
          const preferences = (await window.harbor.snapshot()).preferences;
          preferences.hosts.push({ id: host, label: host, enabled: true, source: 'manual', defaultDirectory: '~/harbor-smoke-test-20260916', connection: { target: host } });
          await window.harbor.savePreferences(preferences);
        }, host);
        await page.getByRole('button', { name: 'Create a session', exact: true }).click();
        await page.getByRole('button', { name: launcher === 'codex' ? 'Codex' : 'Claude Code', exact: true }).click();
        await page.getByLabel('Host', { exact: true }).selectOption(host);
        await page.getByLabel('Session name', { exact: true }).fill(`${launcher} color verification`);
        await page.getByRole('button', { name: 'Launch session', exact: true }).click();
        await expect(page.locator('.connection-label')).toHaveText('Connected');
        const session = (await page.evaluate(() => window.harbor.snapshot())).sessions[0]; tmuxName = session.tmuxName;
        // Read the rendered pane after the actual CLI starts; shell startup colors don't count.
        const capture = () => transport.run(host, transport.setup() + transport.tmux(['capture-pane', '-p', '-e', '-t', session.paneId]));
        if (launcher === 'codex') {
          await expect.poll(capture, { timeout: 20000 }).toMatch(/OpenAI Codex|Welcome to Codex|Update available!/);
          if ((await capture()).includes('Update available!')) {
            // Skip this one update prompt; don't install software or change version preferences.
            await page.locator('.xterm-helper-textarea').focus();
            await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
          }
        }
        await expect.poll(capture, { timeout: 20000 }).toMatch(launcher === 'codex' ? /OpenAI Codex|Welcome to Codex/ : /Claude Code/);
        const screen = await capture();
        const sgr = [...new Set(screen.match(/\x1b\[[0-9;]*m/g) ?? [])].map(sequence => sequence.replace('\x1b', 'ESC'));
        console.log(JSON.stringify({ launcher, host, renderedStyles: sgr }));
        expect(hasChromaticColor(screen), 'The actual CLI must emit chromatic colors, not just bold or dim text.').toBeTruthy();
        await page.screenshot({ animations: 'disabled', path: `test-results/screenshots/agent-${launcher}-${host}.png` });
        await page.getByRole('button', { name: 'Session actions', exact: true }).click();
        await page.getByRole('button', { name: 'Reconnect terminal', exact: true }).click();
        await expect(page.locator('.connection-label')).toHaveText('Connected');
        expect(hasChromaticColor(await capture()), 'Agent colors must remain available after reconnect.').toBeTruthy();
        await page.screenshot({ animations: 'disabled', path: `test-results/screenshots/agent-${launcher}-${host}-reconnected.png` });
      } finally {
        if (!tmuxName) { try { tmuxName = (await page.evaluate(() => window.harbor.snapshot())).sessions[0]?.tmuxName; } catch {} }
        await application.close();
        if (tmuxName) await transport.run(host, transport.setup() + transport.tmux(['kill-session', '-t', `=${tmuxName}`])).catch(() => {});
      }
    });
  }
}
