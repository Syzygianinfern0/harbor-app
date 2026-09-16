import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Transport } from '../src/engine/transport';

async function importHost(page: Page, alias: string) {
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await page.getByRole('button', { name: 'Import from SSH config', exact: true }).click();
  await page.getByRole('checkbox', { name: alias, exact: true }).check();
  await page.getByRole('button', { name: 'Import selected (1)', exact: true }).click();
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Preferences', exact: true })).toHaveCount(0);
}

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
    await page.screenshot({ animations: 'disabled', path: 'test-results/screenshots/01-overview.png' });
    await page.getByRole('button', { name: 'Create a session', exact: true }).click();
    await page.getByRole('button', { name: 'Shell', exact: true }).click();
    await page.getByLabel('Session name', { exact: true }).fill('Desktop smoke test');
    await page.getByLabel('Working directory', { exact: true }).fill(dataDir);
    await page.getByRole('button', { name: 'Check host & tools' }).click();
    await expect(page.locator('.success-text')).toContainText('tmux');
    await page.screenshot({ animations: 'disabled', path: 'test-results/screenshots/02-launcher.png' });
    await page.getByRole('button', { name: 'Launch session' }).click();
    await expect(page.getByRole('heading', { name: 'Desktop smoke test' })).toBeVisible();
    await expect(page.locator('.connection-label')).toHaveText('Connected');
    await expect(page.locator('.sidebar .host-list')).toHaveCount(0);
    await expect(page.locator('.session-heading, .workspace-footer, .workspace .topbar')).toHaveCount(0);
    const bounds = await page.locator('.terminal-pane').boundingBox();
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    expect(bounds!.y).toBeLessThan(46);
    expect(bounds!.height).toBeGreaterThan(viewport.height - 48);
    expect(bounds!.x + bounds!.width).toBe(viewport.width);

    // Collapsing resizes once; hovering overlays without resizing the live terminal.
    await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
    await page.mouse.move(700, 400);
    await expect(page.locator('.sidebar-dock')).toHaveClass(/is-collapsed/);
    const collapsedBounds = await page.locator('.terminal-pane').boundingBox();
    expect(collapsedBounds!.x).toBe(80);
    await page.screenshot({ animations: 'disabled', path: 'test-results/screenshots/08-sidebar-collapsed.png' });
    await page.locator('.sidebar-rail').hover({ position: { x: 40, y: 200 } });
    await expect(page.locator('.sidebar-dock')).toHaveClass(/is-peeking/);
    expect((await page.locator('.terminal-pane').boundingBox())!.width).toBe(collapsedBounds!.width);
    await page.screenshot({ animations: 'disabled', path: 'test-results/screenshots/09-sidebar-hover.png' });
    await page.getByRole('button', { name: 'Pin sidebar open', exact: true }).click();
    await expect(page.locator('.sidebar-dock')).not.toHaveClass(/is-collapsed/);
    expect(await page.locator('.sidebar .nav-section').evaluate(el => getComputedStyle(el).borderBottomWidth)).toBe('0px');
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.press('Meta+b');
    await expect(page.locator('.sidebar-dock')).toHaveClass(/is-collapsed/);
    await page.keyboard.press('Meta+b');
    await expect(page.locator('.sidebar-dock')).not.toHaveClass(/is-collapsed/);

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
    await page.keyboard.type("printf '\\033[31mRED \\033[32mGREEN \\033[34mBLUE \\033[38;2;12;210;125mTRUECOLOR\\033[0m\\n'");
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => (window as any).testOutput)).toContain('\x1b[31mRED');
    await page.screenshot({ animations: 'disabled', path: 'test-results/screenshots/06-full-terminal-colors.png' });

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
    await page.screenshot({ animations: 'disabled', path: 'test-results/screenshots/03-split-terminals.png' });
    await page.getByRole('button', { name: 'Session actions', exact: true }).click();
    await page.getByRole('button', { name: 'Archive (keep running)', exact: true }).click();
    await expect(page.locator('.session-notice')).toContainText('archived');
    const before = await page.evaluate(() => window.harbor.snapshot());
    expect(before.sessions.every(s => s.status === 'running')).toBeTruthy();
    expect(before.sessions.find(s => s.name === 'Desktop smoke test')?.tags).toEqual(['tested', 'persistent']);
    expect(errors).toEqual([]);
    const processBeforeQuit = application.process();
    await application.evaluate(({ app }) => { setTimeout(() => app.quit(), 0); });
    await expect.poll(() => processBeforeQuit.exitCode, { timeout: 10000 }).toBe(0);
    application = await launch(); page = await application.firstWindow();
    await expect(page.getByRole('heading', { name: 'Desktop smoke test', exact: true })).toBeVisible();
    await expect(page.locator('.connection-label')).toHaveText('Connected');
    await expect.poll(() => page.evaluate(async () => { await window.harbor.refresh(); return (await window.harbor.snapshot()).sessions.map(s => s.status); })).toEqual(['running', 'running']);
    expect((await page.evaluate(() => window.harbor.snapshot())).sessions.find(s => s.name === 'Second shell')?.archived).toBeTruthy();
    await page.screenshot({ animations: 'disabled', path: 'test-results/screenshots/04-restored.png' });
  } finally {
    if (application) {
      try { const page = (await application.windows())[0]; if (page) names.push(...(await page.evaluate(() => window.harbor.snapshot())).sessions.map(s => s.tmuxName)); } catch {}
      await application.close();
    }
    const transport = new Transport();
    for (const name of new Set(names)) await transport.run('local', transport.setup() + transport.tmux(['kill-session', '-t', `=${name}`])).catch(() => {});
  }
});

test('preferences opt into SSH hosts, edit imports, add manual hosts, hide hosts, and persist', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'harbor-preferences-ui-'));
  let application = await electron.launch({ executablePath: process.env.HARBOR_TEST_APP, args: process.env.HARBOR_TEST_APP ? [] : ['.'], env: { ...process.env, HARBOR_DATA_DIR: dataDir } });
  try {
    let page = await application.firstWindow();
    await expect.poll(() => page.evaluate(async () => (await window.harbor.snapshot()).hosts.map(host => host.id))).toEqual(['local']);
    await expect(page.locator('.sidebar .host-list')).toHaveCount(0);
    await page.getByRole('button', { name: 'Preferences', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Close preferences', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Import from SSH config', exact: true }).click();
    const candidates = await page.evaluate(() => window.harbor.sshCandidates());
    if (candidates.length) {
      const candidate = candidates.find(host => host.id === 'devbox') ?? candidates[0];
      await page.getByRole('checkbox', { name: candidate.label, exact: true }).check();
      await page.getByRole('button', { name: 'Import selected (1)', exact: true }).click();
      await page.getByLabel('Display name', { exact: true }).fill('Selected research host');
      await page.getByLabel('Hostname override', { exact: true }).fill('custom.example.invalid');
      await page.getByLabel('Username', { exact: true }).fill('researcher');
      await page.getByLabel('Port', { exact: true }).fill('2222');
      await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Preferences', exact: true })).toHaveCount(0);
      const saved = await page.evaluate(() => window.harbor.snapshot());
      expect(saved.hosts).toHaveLength(2);
      expect(saved.hosts[1].connection).toMatchObject({ target: candidate.id, hostname: 'custom.example.invalid', user: 'researcher', port: 2222 });
      await page.getByRole('button', { name: 'Preferences', exact: true }).click();
      await page.locator('.saved-host-list').getByRole('button', { name: /Selected research host/ }).click();
      await page.getByRole('checkbox', { name: 'Show in launcher', exact: true }).uncheck();
    } else await page.getByRole('button', { name: 'Back to hosts' }).click();
    await page.getByRole('button', { name: 'Add manually', exact: true }).click();
    await page.getByLabel('Display name', { exact: true }).fill('Manual workstation');
    await page.getByLabel('SSH alias or address', { exact: true }).fill('manual.example.invalid');
    await page.getByLabel('Default working directory', { exact: true }).fill('~/project');
    await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Preferences', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Create a session', exact: true }).click();
    await expect(page.getByLabel('Host', { exact: true }).locator('option')).toHaveText(['This Mac', 'Manual workstation', 'Manage hosts in Preferences…']);
    await page.getByLabel('Host', { exact: true }).selectOption({ label: 'Manual workstation' });
    await expect(page.getByLabel('Working directory', { exact: true })).toHaveValue('~/project');
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.getByRole('button', { name: 'Preferences', exact: true }).click();
    await page.locator('.saved-host-list').getByRole('button', { name: /Manual workstation/ }).click();
    await page.screenshot({ animations: 'disabled', path: 'test-results/screenshots/07-host-preferences.png' });
    await page.getByRole('button', { name: 'Terminal', exact: true }).click();
    await page.getByLabel('Font size', { exact: true }).fill('15');
    await page.getByRole('button', { name: 'Sidebar', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Expand sidebar on hover', exact: true }).uncheck();
    await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Preferences', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
    await page.locator('.sidebar-rail').hover({ position: { x: 40, y: 200 } });
    await expect(page.locator('.sidebar-dock')).not.toHaveClass(/is-peeking/);
    await application.close();
    application = await electron.launch({ executablePath: process.env.HARBOR_TEST_APP, args: process.env.HARBOR_TEST_APP ? [] : ['.'], env: { ...process.env, HARBOR_DATA_DIR: dataDir } });
    page = await application.firstWindow();
    const restored = await page.evaluate(() => window.harbor.snapshot());
    expect(restored.hosts.map(host => host.label)).toEqual(['This Mac', 'Manual workstation']);
    expect(restored.preferences.terminal.fontSize).toBe(15);
    expect(restored.preferences.sidebar.expandOnHover).toBe(false);
    await expect(page.locator('.sidebar-dock')).toHaveClass(/is-collapsed/);
    await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
    await page.getByRole('button', { name: 'Preferences', exact: true }).click();
    await page.locator('.saved-host-list').getByRole('button', { name: /Manual workstation/ }).click();
    await page.getByRole('button', { name: 'Remove host', exact: true }).click();
    await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Preferences', exact: true })).toHaveCount(0);
    expect((await page.evaluate(() => window.harbor.snapshot())).hosts.map(host => host.id)).toEqual(['local']);
  } finally { await application.close(); }
});

test('remote desktop terminal connects, takes input, and restores output', async () => {
  test.skip(!process.env.HARBOR_TEST_SSH, 'Set HARBOR_TEST_SSH to opt in to remote desktop testing.');
  const host = process.env.HARBOR_TEST_SSH!;
  const dataDir = await mkdtemp(path.join(tmpdir(), 'harbor-remote-desktop-'));
  const application = await electron.launch({ executablePath: process.env.HARBOR_TEST_APP, args: process.env.HARBOR_TEST_APP ? [] : ['.'], env: { ...process.env, HARBOR_DATA_DIR: dataDir } });
  const page = await application.firstWindow();
  const names: string[] = [];
  try {
    await importHost(page, host);
    await page.getByRole('button', { name: 'Create a session', exact: true }).click();
    await page.getByRole('button', { name: 'Shell', exact: true }).click();
    await page.getByLabel('Host', { exact: true }).selectOption({ label: host });
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
    await page.getByRole('button', { name: 'Session actions', exact: true }).click();
    await page.getByRole('button', { name: 'Reconnect terminal', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).testOutput)).toContain('REMOTE_DESKTOP_OK');
    await expect(page.locator('.connection-label')).toHaveText('Connected');
    await page.screenshot({ animations: 'disabled', path: 'test-results/screenshots/05-remote-terminal.png' });
  } finally {
    try { names.push(...(await page.evaluate(() => window.harbor.snapshot())).sessions.map(s => s.tmuxName)); } catch {}
    await application.close(); const transport = new Transport();
    for (const name of new Set(names)) await transport.run(host, transport.setup() + transport.tmux(['kill-session', '-t', `=${name}`])).catch(() => {});
  }
});
