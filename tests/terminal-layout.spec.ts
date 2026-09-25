import { test, expect, _electron as electron, type Page } from '@playwright/test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function terminalBounds(page: Page) {
  return page.locator('.terminal-surface').evaluateAll(surfaces => surfaces.map(surface => {
    const screen = surface.querySelector('.xterm-screen')!.getBoundingClientRect();
    const bounds = surface.getBoundingClientRect();
    const padding = parseFloat(getComputedStyle(surface.querySelector('.xterm')!).paddingRight);
    // One row is drawn edge to edge; its last glyph must end inside its own (clipping) row.
    const wide = [...surface.querySelectorAll<HTMLElement>('.xterm-rows > div')].find(row => /^123.*W$/.test(row.textContent!.trimEnd()))!;
    const text = document.createRange();
    text.selectNodeContents(wide);
    const glyphs = text.getBoundingClientRect();
    const scrollbar = surface.querySelector('.xterm-scrollable-element > .scrollbar.vertical')?.getBoundingClientRect();
    return {
      bottomOverflow: screen.bottom - bounds.bottom,
      rightOverflow: screen.right - (bounds.right - padding),
      lastColumnOverflow: glyphs.right - wide.getBoundingClientRect().right,
      clippedWidth: wide.scrollWidth - wide.clientWidth,
      scrollbarOverlap: scrollbar ? screen.right - scrollbar.left : 0,
      rows: surface.querySelectorAll('.xterm-rows > div').length,
    };
  }));
}

test('the final terminal row and column fit after resizing, splitting and restoring a tab', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'harbor-terminal-layout-'));
  const createdAt = new Date().toISOString();
  const project = { id: 'layout', name: 'Terminal layout', cwd: dir, hostId: 'local', hostLabel: 'This Mac', connection: 'local', createdAt };
  const sessions = [0, 1, 2].map(i => ({ id: `layout-${i}`, tmuxName: `harbor-abcdef${i}`, paneId: `%${i}`, name: `Layout ${i}`, host: 'local', cwd: dir, launcher: 'codex', group: '', tags: [], pinned: false, archived: false, createdAt, updatedAt: createdAt, status: 'closed', projectId: project.id }));
  await writeFile(path.join(dir, 'sessions.json'), JSON.stringify({ version: 2, projects: [project], sessions }));
  const app = await electron.launch({ args: ['.'], env: { ...process.env, HARBOR_DATA_DIR: dir } });
  const page = await app.firstWindow();
  try {
    await expect(page.locator('.sidebar .chat-row')).toHaveCount(3);
    const snapshot = await page.evaluate(() => window.harbor.snapshot());
    snapshot.sessions.forEach(session => { session.status = 'running'; });
    await app.evaluate(({ ipcMain, BrowserWindow }, snapshot) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      for (const channel of ['attach', 'resize', 'detach']) {
        ipcMain.removeHandler(`harbor:${channel}`);
        ipcMain.handle(`harbor:${channel}`, (_event, id, cols, rows) => {
          if (channel === 'detach') return;
          // Mimic a TUI that draws its footer on the PTY's last row and a border in its last column.
          const wide = Array.from({ length: cols - 1 }, (_, i) => String((i + 1) % 10)).join('') + 'W';
          const output = `\x1b[2J\x1b[HWindow content\x1b[2;1H${wide}\x1b[${rows};1H\x1b[32m${'BOTTOM ROW: gypq | Ready | Full Access'.slice(0, cols)}\x1b[0m`;
          contents.send('harbor:terminal', { id, type: 'data', data: Buffer.from(output).toString('base64') });
        });
      }
      const send = contents.send.bind(contents);
      (globalThis as { layoutSnapshot?: typeof snapshot }).layoutSnapshot = snapshot;
      contents.send = (channel, ...args) => send(channel, ...(channel === 'harbor:snapshot-changed' ? [snapshot] : args));
      contents.send('harbor:snapshot-changed', snapshot);
    }, snapshot);
    await page.locator('.sidebar .chat-row').first().click();
    await expect(page.locator('.connection-label')).toHaveText('Connected');

    const checkRows = async () => {
      // Fit is debounced by 80 ms after the ResizeObserver fires.
      await page.waitForTimeout(160);
      for (const bounds of await terminalBounds(page)) {
        expect(bounds.rows).toBeGreaterThan(1);
        expect(bounds.bottomOverflow, 'last row must fit inside the clipping surface').toBeLessThanOrEqual(0);
        expect(bounds.rightOverflow, 'screen must stay inside the right padding').toBeLessThanOrEqual(0);
        expect(bounds.lastColumnOverflow, 'last column must not be clipped').toBeLessThanOrEqual(0.05);
        expect(bounds.clippedWidth).toBeLessThanOrEqual(0);
        expect(bounds.scrollbarOverlap, 'scrollbar must not cover the last column').toBeLessThanOrEqual(0);
      }
      for (const rows of await page.locator('.xterm-rows').all()) {
        await expect(rows.locator(':scope > div').last()).toContainText('BOTTOM ROW: gypq');
      }
    };
    // Sweep more than a whole character-cell height, including exact-fit edges.
    for (let height = 740; height <= 762; height++) {
      await app.evaluate(({ BrowserWindow }, height) => BrowserWindow.getAllWindows()[0].setSize(1100, height), height);
      await checkRows();
    }
    await page.locator('.sidebar .chat-row').nth(1).click();
    await expect(page.locator('.connection-label')).toHaveText('Connected');
    await page.locator('.sidebar .chat-row').nth(2).click();
    await expect(page.locator('.connection-label')).toHaveText('Connected');
    await page.keyboard.press('Meta+1');
    await checkRows();
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    await page.locator('[data-tab-id="layout-1"]').dispatchEvent('dragstart', { dataTransfer: transfer });
    const zone = page.locator('[data-session-id="layout-0"] [data-drop-side="bottom"]');
    await zone.dispatchEvent('dragover', { dataTransfer: transfer });
    await zone.dispatchEvent('drop', { dataTransfer: transfer });
    await transfer.dispose();
    await expect(page.locator('.terminal-surface')).toHaveCount(2);
    for (let height = 740; height <= 762; height += 2) {
      await app.evaluate(({ BrowserWindow }, height) => BrowserWindow.getAllWindows()[0].setSize(1100, height), height);
      await checkRows();
    }
    const beside = await page.evaluateHandle(() => new DataTransfer());
    await page.locator('[data-tab-id="layout-2"]').dispatchEvent('dragstart', { dataTransfer: beside });
    const right = page.locator('[data-session-id="layout-0"] [data-drop-side="right"]');
    await right.dispatchEvent('dragover', { dataTransfer: beside });
    await right.dispatchEvent('drop', { dataTransfer: beside });
    await beside.dispose();
    await expect(page.locator('.terminal-surface')).toHaveCount(3);
    for (let width = 1000; width <= 1400; width += 23) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 760), width);
      await checkRows();
    }
    for (const fontSize of [9, 11, 12, 14, 15, 17, 20, 24, 28]) {
      await app.evaluate(({ BrowserWindow }, fontSize) => {
        const snapshot = (globalThis as { layoutSnapshot?: { preferences: { terminal: { fontSize: number } } } }).layoutSnapshot!;
        snapshot.preferences.terminal.fontSize = fontSize;
        BrowserWindow.getAllWindows()[0].webContents.send('harbor:snapshot-changed', snapshot);
      }, fontSize);
      await expect.poll(() => page.locator('.xterm-rows').first().evaluate(rows => getComputedStyle(rows).fontSize)).toBe(`${fontSize}px`);
      await checkRows();
    }
    await page.screenshot({ path: 'test-results/terminal-bottom-row.png' });
  } finally {
    await app.close();
  }
});
