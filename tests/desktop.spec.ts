import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Transport } from '../src/engine/transport';

test('desktop creates real terminals, edits metadata, splits, archives, and survives restart', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'harbor-desktop-'));
  let application: ElectronApplication | undefined;
  const names: string[] = [];
  const launch = () => electron.launch({ executablePath: process.env.HARBOR_TEST_APP, args: process.env.HARBOR_TEST_APP ? [] : ['.'], env: { ...process.env, HARBOR_DATA_DIR: dataDir } });
  try {
    application = await launch(); let page = await application.firstWindow();
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await expect(page.getByRole('heading', { name: 'Pick up where you left off.' })).toBeVisible();
    await mkdir('test-results/screenshots', { recursive: true });
    await page.screenshot({ path: 'test-results/screenshots/01-overview.png' });
    await page.getByRole('button', { name: 'Create a session', exact: true }).click();
    await page.getByRole('button', { name: 'Shell', exact: true }).click();
    await page.getByLabel('Session name', { exact: true }).fill('Desktop smoke test');
    await page.getByLabel('Working directory', { exact: true }).fill(dataDir);
    await page.getByRole('button', { name: 'Check host & tools' }).click();
    await expect(page.locator('.success-text')).toContainText('tmux');
    await page.screenshot({ path: 'test-results/screenshots/02-launcher.png' });
    await page.getByRole('button', { name: 'Launch session' }).click();
    await expect(page.getByRole('heading', { name: 'Desktop smoke test' })).toBeVisible();
    await expect(page.locator('.connection-label')).toHaveText('Connected');
    names.push(...(await page.evaluate(() => window.harbor.snapshot())).sessions.map(s => s.tmuxName));
    await page.evaluate(() => { (window as any).testOutput = ''; window.harbor.onTerminal(event => { if (event.type === 'data') (window as any).testOutput += atob(event.data); }); });
    const remoteSession = (await page.evaluate(() => window.harbor.snapshot())).sessions[0];
    const readyTransport = new Transport();
    // The user's login shell runs plugins (and sometimes updates) before accepting input.
    // Wait for its line editor to enable bracketed paste, rather than typing during startup.
    await expect.poll(async () => (await readyTransport.run('local', readyTransport.setup() + readyTransport.tmux(['display-message', '-p', '-t', remoteSession.paneId, '#{bracket_paste_flag}']))).trim(), { timeout: 30000 }).toBe('1');
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.type("printf 'DESKTOP_%s\\n' 'INPUT_OK'"); await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => (window as any).testOutput)).toContain('DESKTOP_INPUT_OK');
    await page.locator('.xterm-helper-textarea').evaluate(element => {
      const data = new DataTransfer(); data.setData('text/plain', "printf 'CLIPBOARD_%s\\n' 'OK_你好'");
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    // Wait for the asynchronous paste to reach tmux before sending Enter.
    await expect.poll(() => page.evaluate(() => (window as any).testOutput)).toContain('CLIPBOARD_%s');
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => (window as any).testOutput)).toContain('CLIPBOARD_OK_');
    await page.getByRole('button', { name: 'Pin session', exact: true }).click();
    await page.getByRole('button', { name: 'Session actions', exact: true }).click();
    await page.getByRole('button', { name: 'Edit details', exact: true }).click();
    await page.getByLabel('Group', { exact: true }).fill('UI verification');
    await page.getByLabel('Tags', { exact: true }).fill('tested, persistent');
    await page.getByRole('button', { name: 'Save details', exact: true }).click();
    await page.getByRole('button', { name: 'New session tab', exact: true }).click();
    await page.getByRole('button', { name: 'Shell', exact: true }).click();
    await page.getByLabel('Session name', { exact: true }).fill('Second shell');
    await page.getByRole('button', { name: 'Launch session' }).click();
    await expect(page.getByRole('heading', { name: 'Second shell', exact: true })).toBeVisible();
    await expect(page.locator('.connection-label')).toHaveText('Connected');
    names.push(...(await page.evaluate(() => window.harbor.snapshot())).sessions.map(s => s.tmuxName));
    await page.getByRole('button', { name: 'Split view', exact: true }).click();
    await page.locator('.split-picker').getByRole('button', { name: 'Desktop smoke test', exact: true }).click();
    await expect(page.locator('.terminal-pane')).toHaveCount(2);
    await expect(page.locator('.connection-label').nth(1)).toHaveText('Connected');
    await page.screenshot({ path: 'test-results/screenshots/03-split-terminals.png' });
    await page.getByRole('button', { name: 'Session actions', exact: true }).click();
    await page.getByRole('button', { name: 'Archive (keep running)', exact: true }).click();
    await expect(page.locator('.session-notice')).toContainText('archived');
    const before = await page.evaluate(() => window.harbor.snapshot());
    expect(before.sessions.every(s => s.status === 'running')).toBeTruthy();
    expect(before.sessions.find(s => s.name === 'Desktop smoke test')?.tags).toEqual(['tested', 'persistent']);
    expect(errors).toEqual([]);
    await application.close(); application = await launch(); page = await application.firstWindow();
    await expect(page.getByRole('heading', { name: 'Desktop smoke test', exact: true })).toBeVisible();
    await expect(page.locator('.connection-label')).toHaveText('Connected');
    await expect.poll(() => page.evaluate(async () => { await window.harbor.refresh(); return (await window.harbor.snapshot()).sessions.map(s => s.status); })).toEqual(['running', 'running']);
    expect((await page.evaluate(() => window.harbor.snapshot())).sessions.find(s => s.name === 'Second shell')?.archived).toBeTruthy();
    await page.screenshot({ path: 'test-results/screenshots/04-restored.png' });
  } finally {
    if (application) {
      try { const page = (await application.windows())[0]; if (page) names.push(...(await page.evaluate(() => window.harbor.snapshot())).sessions.map(s => s.tmuxName)); } catch {}
      await application.close();
    }
    const transport = new Transport();
    for (const name of new Set(names)) await transport.run('local', transport.setup() + transport.tmux(['kill-session', '-t', `=${name}`])).catch(() => {});
  }
});

test('remote desktop terminal connects, takes input, and restores output', async () => {
  test.skip(!process.env.HARBOR_TEST_SSH, 'Set HARBOR_TEST_SSH to opt in to remote desktop testing.');
  const host = process.env.HARBOR_TEST_SSH!;
  const dataDir = await mkdtemp(path.join(tmpdir(), 'harbor-remote-desktop-'));
  const application = await electron.launch({ executablePath: process.env.HARBOR_TEST_APP, args: process.env.HARBOR_TEST_APP ? [] : ['.'], env: { ...process.env, HARBOR_DATA_DIR: dataDir } });
  const page = await application.firstWindow();
  const names: string[] = [];
  try {
    await page.getByRole('button', { name: 'Create a session', exact: true }).click();
    await page.getByRole('button', { name: 'Shell', exact: true }).click();
    await page.getByLabel('Host', { exact: true }).selectOption(host);
    await page.getByLabel('Session name', { exact: true }).fill('Remote desktop verification');
    await page.getByLabel('Working directory', { exact: true }).fill('~/harbor-smoke-test-20260916');
    await page.getByRole('button', { name: 'Launch session' }).click();
    await expect(page.locator('.connection-label')).toHaveText('Connected');
    names.push(...(await page.evaluate(() => window.harbor.snapshot())).sessions.map(s => s.tmuxName));
    await page.evaluate(() => { (window as any).testOutput = ''; window.harbor.onTerminal(event => { if (event.type === 'data') (window as any).testOutput += atob(event.data); }); });
    await page.locator('.xterm-helper-textarea').focus();
    const remoteSession = (await page.evaluate(() => window.harbor.snapshot())).sessions[0];
    const readyTransport = new Transport();
    await expect.poll(async () => (await readyTransport.run(host, readyTransport.setup() + readyTransport.tmux(['capture-pane', '-p', '-t', remoteSession.paneId]))).trim().split('\n').at(-1), { timeout: 30000 }).toMatch(/^[❯➜>$#]/);
    await page.keyboard.type("printf 'REMOTE_%s\\n' 'DESKTOP_OK'; pwd"); await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => (window as any).testOutput)).toContain('REMOTE_DESKTOP_OK');
    await expect.poll(() => page.evaluate(() => (window as any).testOutput)).toContain('/harbor-smoke-test-20260916');
    await page.evaluate(() => { (window as any).testOutput = ''; });
    await page.getByRole('button', { name: 'Reconnect Remote desktop verification', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).testOutput)).toContain('REMOTE_DESKTOP_OK');
    await expect(page.locator('.connection-label')).toHaveText('Connected');
    await page.screenshot({ path: 'test-results/screenshots/05-remote-terminal.png' });
  } finally {
    try { names.push(...(await page.evaluate(() => window.harbor.snapshot())).sessions.map(s => s.tmuxName)); } catch {}
    await application.close(); const transport = new Transport();
    for (const name of new Set(names)) await transport.run(host, transport.setup() + transport.tmux(['kill-session', '-t', `=${name}`])).catch(() => {});
  }
});
