import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('plain URLs and labeled terminal links open in the browser through validated IPC', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'harbor-links-'));
  const createdAt = new Date().toISOString();
  const project = { id: 'links', name: 'Links', cwd: dir, hostId: 'local', hostLabel: 'This Mac', connection: 'local', createdAt };
  const session = { id: 'links-chat', tmuxName: 'harbor-abcdef', paneId: '%0', name: 'Link test', host: 'local', cwd: dir, launcher: 'codex', group: '', tags: [], pinned: false, archived: false, createdAt, updatedAt: createdAt, status: 'closed', projectId: project.id };
  await writeFile(path.join(dir, 'sessions.json'), JSON.stringify({ version: 2, projects: [project], sessions: [session] }));
  const app = await electron.launch({ executablePath: process.env.HARBOR_TEST_APP, args: process.env.HARBOR_TEST_APP ? [] : ['.'], env: { ...process.env, HARBOR_DATA_DIR: dir } });
  const page = await app.firstWindow();
  try {
    await expect(page.locator('.sidebar .chat-row')).toHaveCount(1);
    await app.evaluate(({ ipcMain, shell }) => {
      for (const channel of ['attach', 'detach', 'resize']) {
        ipcMain.removeHandler('harbor:' + channel);
        ipcMain.handle('harbor:' + channel, () => {});
      }
      (globalThis as any).openedLinks = [];
      shell.openExternal = async url => { (globalThis as any).openedLinks.push(url); };
    });
    const snapshot = await page.evaluate(() => window.harbor.snapshot());
    snapshot.sessions[0].status = 'running';
    await app.evaluate(({ BrowserWindow }, snapshot) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      const send = contents.send.bind(contents);
      contents.send = (channel, ...args) => send(channel, ...(channel === 'harbor:snapshot-changed' ? [snapshot] : args));
      contents.send('harbor:snapshot-changed', snapshot);
    }, snapshot);
    await page.locator('.sidebar .chat-row').click();
    await expect(page.locator('.connection-label')).toHaveText('Connected');
    // Accept the old xterm fallback confirmation so the regression detects the
    // blocked popup, rather than hanging on a dialog before the click completes.
    await page.evaluate(() => { window.confirm = () => true; });
    const plain = 'https://example.com/plain?q=harbor#links';
    const labeled = 'https://example.org/docs?q=harbor#start';
    const http = 'http://localhost:5173/chat';
    const output = `${plain}\r\n\x1b]8;;${labeled}\x07Read documentation\x1b]8;;\x07\r\n\x1b]8;;${http}\x1b\\Local preview\x1b]8;;\x1b\\\r\n`;
    await app.evaluate(({ BrowserWindow }, output) => BrowserWindow.getAllWindows()[0].webContents.send('harbor:terminal', { id: 'links-chat', type: 'data', data: Buffer.from(output).toString('base64') }), output);
    const clickLink = async (label: string) => {
      const row = page.locator('.xterm-rows > div').filter({ hasText: label });
      await expect(row).toBeVisible();
      const bounds = (await row.boundingBox())!;
      // xterm's screen overlay handles the mouse, not the rendered text spans.
      await page.mouse.move(bounds.x + 12, bounds.y + bounds.height / 2);
      await expect(page.locator('.xterm-screen')).toHaveClass(/xterm-cursor-pointer/);
      await page.mouse.click(bounds.x + 12, bounds.y + bounds.height / 2);
    };
    for (const [label, expected] of [[plain, [plain]], ['Read documentation', [plain, labeled]], ['Local preview', [plain, labeled, http]]] as const) {
      await clickLink(label);
      await expect.poll(() => app.evaluate(() => (globalThis as any).openedLinks)).toEqual(expected);
      await expect(page.locator('.terminal-surface')).toHaveAttribute('title', expected[expected.length - 1]);
    }
    expect(app.windows()).toHaveLength(1);
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'not a URL']) {
      expect(await page.evaluate(url => window.harbor.openExternal(url).then(() => false, () => true), url)).toBe(true);
    }
    expect(await app.evaluate(() => (globalThis as any).openedLinks)).toEqual([plain, labeled, http]);
    await app.evaluate(({ shell }) => { shell.openExternal = async () => { throw new Error('Browser launch failed'); }; });
    await clickLink('Read documentation');
    await expect(page.getByRole('alert')).toContainText('Browser launch failed');
  } finally {
    await app.close();
  }
});
