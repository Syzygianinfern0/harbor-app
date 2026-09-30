// Captures the landing page screenshots from the built app with a made-up demo workspace.
// Nothing here touches real chats: the profile is a temp dir, tmux uses its own socket, and every
// terminal's output is scripted below. Run: `npm run build && npm run site:shots`.
import { test, expect, _electron as electron, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { mkdtemp, writeFile, readdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Raw PNGs land in a temp dir; the page ships WebP (cwebp) and a social card (ImageMagick): `brew install webp imagemagick`.
const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '../assets/shots');
let OUT = '';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

type Kind = 'codex' | 'claude';
const SSH = { 'build-01': { target: 'build-01' }, 'gpu-box': { target: 'gpu-box' } } as const;
const PROJECTS = [
  { id: 'app', name: 'harbor-app', cwd: '~/code/harbor-app', host: 'local' },
  { id: 'api', name: 'tessera-api', cwd: '/srv/tessera-api', host: 'build-01' },
  { id: 'ml', name: 'vision-train', cwd: '~/vision-train', host: 'gpu-box' },
  { id: 'docs', name: 'docs-site', cwd: '~/code/docs-site', host: 'local' },
] as const;
// [id, project, name, agent, activity, unread]
const CHATS: [string, string, string, Kind, string, boolean][] = [
  ['a1', 'app', 'Tab strip polish', 'claude', 'working', false],
  ['a2', 'app', 'Release notes 0.5', 'codex', 'completed', true],
  ['a3', 'app', 'Fix SSH reattach', 'codex', 'closed', false],
  ['b1', 'api', 'Rate limiter', 'codex', 'working', false],
  ['b2', 'api', 'Flaky auth test', 'claude', 'attention', true],
  ['b3', 'api', 'Postgres 17 migration', 'claude', 'background', false],
  ['c1', 'ml', 'Learning-rate sweep', 'codex', 'background', false],
  ['c2', 'ml', 'Plot ablations', 'claude', 'completed', true],
  ['c3', 'ml', 'Eval harness', 'codex', 'working', false],
  ['d1', 'docs', 'Rewrite quickstart', 'claude', 'completed', false],
];

// ---- Scripted terminal output -------------------------------------------------------------
const rgb = (hex: string) => `\x1b[38;2;${parseInt(hex.slice(1, 3), 16)};${parseInt(hex.slice(3, 5), 16)};${parseInt(hex.slice(5, 7), 16)}m`;
const R = '\x1b[0m', B = '\x1b[1m', DIM = rgb('#7d8796'), TXT = rgb('#d5dbe3'), OK = rgb('#8fd6a8'), WARN = rgb('#e8c170'), ORANGE = rgb('#d98f6a'), BLUE = rgb('#8fb4e8'), BAD = rgb('#e59a8c');

const claude: Record<string, string[]> = {
  a1: [`${DIM}> ${TXT}Tighten tab spacing; show status on folded groups${R}`, '',
    `${TXT}⏺ I'll start with how the strip measures tabs.${R}`, '',
    `${OK}⏺ ${B}Read${R}${TXT}(src/renderer/TabStrip.tsx)${R}`, `${DIM}  ⎿  Read 412 lines${R}`, '',
    `${OK}⏺ ${B}Update${R}${TXT}(src/renderer/styles.css)${R}`, `${DIM}  ⎿  Updated with 6 additions and 2 removals${R}`, '',
    `${OK}⏺ ${B}Bash${R}${TXT}(npm test -- tabGroups)${R}`, `${DIM}  ⎿  ${OK}✔ 18 passing${DIM} (0.9s)${R}`, '',
    `${ORANGE}✻ Refining the folded chip…${DIM} (41s · esc to interrupt)${R}`],
  b2: [`${DIM}> ${TXT}Login test fails 1 in 20 CI runs. Find out why.${R}`, '',
    `${OK}⏺ ${B}Bash${R}${TXT}(npm test -- auth --repeat 40 | grep -c FAIL)${R}`, `${DIM}  ⎿  3${R}`, '',
    `${TXT}⏺ It's a race: the cookie is read before the refresh${R}`, `${TXT}  write lands. I'll await the refresh and add a test.${R}`, '',
    `${BLUE}╭──────────────────────────────────────────────${R}`,
    `${BLUE}│${R} ${B}${TXT}Edit file${R}${TXT}  src/auth/session.ts${R}`,
    `${BLUE}│${R} ${TXT}Do you want to make this edit?${R}`,
    `${BLUE}│${R} ${BLUE}❯ 1. Yes${R}`,
    `${BLUE}│${R} ${TXT}  2. Yes, allow all edits this session${R}`,
    `${BLUE}│${R} ${TXT}  3. No, and tell Claude what to do instead${R}`,
    `${BLUE}╰──────────────────────────────────────────────${R}`],
  b3: [`${DIM}> ${TXT}Upgrade staging to Postgres 17, re-run the suite${R}`, '',
    `${OK}⏺ ${B}Bash${R}${TXT}(./scripts/migrate.sh --target 17)${R}`, `${DIM}  ⎿  ${OK}migrated 43 tables${DIM} in 2m 10s${R}`, '',
    `${OK}⏺ ${B}Bash${R}${TXT}(npm run test:integration)${R}`, `${DIM}  ⎿  Running in the background${R}`, '',
    `${TXT}⏺ The suite takes ~15 minutes. I'll continue when${R}`, `${TXT}  it reports back.${R}`, '',
    `${DIM}  ⧗ 1 background shell running${R}`],
  c2: [`${DIM}> ${TXT}Plot the ablations, one panel per backbone${R}`, '',
    `${OK}⏺ ${B}Read${R}${TXT}(results/ablations.csv)${R}`, `${DIM}  ⎿  Read 96 lines${R}`, '',
    `${OK}⏺ ${B}Write${R}${TXT}(scripts/plot_ablations.py)${R}`, `${DIM}  ⎿  Wrote 58 lines${R}`, '',
    `${OK}⏺ ${B}Bash${R}${TXT}(python scripts/plot_ablations.py)${R}`, `${DIM}  ⎿  saved figures/ablations.pdf${R}`, '',
    `${TXT}⏺ Done: figures/ablations.pdf, one panel per backbone.${R}`, `${TXT}  Augmentation matters most for ViT (−4.1 mAP).${R}`],
  d1: [`${DIM}> ${TXT}Rewrite the quickstart so it works in five minutes${R}`, '', `${TXT}⏺ Rewrote docs/quickstart.md: 9 steps down to 4.${R}`],
};
const codex: Record<string, string[]> = {
  a2: [`${B}${TXT}› ${R}${TXT}Draft 0.5 release notes from commits since v0.4.0${R}`, '',
    `${TXT}• ${B}Ran${R}${TXT} git log --oneline v0.4.0..HEAD${R}`, `${DIM}  └ 37 commits${R}`, '',
    `${TXT}• ${B}Edited${R}${TXT} CHANGELOG.md ${OK}(+41 -0)${R}`, '',
    `${TXT}Grouped into Features, Fixes and Docs, each linked${R}`, `${TXT}to its commit.${R}`],
  b1: [`${B}${TXT}› ${R}${TXT}Add a token-bucket rate limiter to the public API${R}`, '',
    `${TXT}• ${B}Explored${R}`, `${DIM}  └ Read middleware/auth.ts, routes/index.ts${R}`, '',
    `${TXT}• ${B}Edited${R}${TXT} src/middleware/rateLimit.ts ${OK}(+64 -0)${R}`,
    `${TXT}• ${B}Edited${R}${TXT} src/routes/index.ts ${OK}(+3 -1)${R}`, '',
    `${TXT}• ${B}Ran${R}${TXT} npm test -- rateLimit${R}`, `${DIM}  └ ${OK}12 passing${DIM} (1.4s)${R}`, '',
    `${DIM}◦ ${TXT}Working${DIM} (1m 12s • esc to interrupt)${R}`],
  c1: [`${B}${TXT}› ${R}${TXT}Sweep learning rates 1e-4..3e-3 on the small config${R}`, '',
    `${TXT}• ${B}Edited${R}${TXT} configs/sweep_lr.yaml ${OK}(+18 -0)${R}`, '',
    `${TXT}• ${B}Ran${R}${TXT} python sweep.py configs/sweep_lr.yaml${R} ${DIM}(bg)${R}`,
    `${DIM}  └ run 3/8  lr=6e-4  epoch 7/20  val_loss 0.412${R}`, '',
    `${TXT}Started 8 runs on 4 GPUs. I'll summarize when they${R}`, `${TXT}finish, so feel free to close your laptop.${R}`],
  c3: [`${B}${TXT}› ${R}${TXT}Build an eval harness that scores every checkpoint${R}`, '',
    `${TXT}• ${B}Edited${R}${TXT} eval/harness.py ${OK}(+122 -0)${R}`, '',
    `${TXT}• ${B}Ran${R}${TXT} python -m eval.harness runs/ --limit 2${R}`, `${DIM}  └ ckpt-0400  mAP 41.8${R}`, `${DIM}    ckpt-0800  mAP 44.6${R}`, '',
    `${DIM}◦ ${TXT}Working${DIM} (3m 05s • esc to interrupt)${R}`],
};
function screen(id: string, kind: Kind, cwd: string, cols: number, rows: number) {
  const body = (kind === 'claude' ? claude : codex)[id] ?? [];
  const rule = DIM + '─'.repeat(Math.max(10, cols - 2)) + R;
  const footer = kind === 'claude'
    ? [rule, `${TXT}> ${R}`, rule, `${DIM}  ⏵⏵ accept edits on · ${cwd}${R}`]
    : [`${TXT}› ${DIM}Ask Codex to do anything${R}`, '', `${DIM}  ${cwd} · 64% context left${R}`];
  const top = body.map((l, i) => `\x1b[${i + 2};2H${l}`).join('');
  const bottom = footer.map((l, i) => `\x1b[${rows - footer.length + 1 + i};2H${l}`).join('');
  return `\x1b[2J\x1b[H${top}${bottom}`;
}

const NOTE = `## Before release
Ship *after* the tab polish lands.
- [ ] Status on folded chips !p1
  - [ ] Needs input beats turn finished
- [x] Measure tabs before they shrink
### Check
\`\`\`
npm test -- tabGroups
\`\`\`
- Keep **one** line per group`;
const checked = new Date().toISOString();
const UPDATES = [
  { hostId: 'local', hostLabel: 'This Mac', agent: 'codex', installed: '0.154.0', latest: '0.154.0', status: 'current', checkedAt: checked },
  { hostId: 'local', hostLabel: 'This Mac', agent: 'claude', installed: '2.1.263', latest: '2.1.263', status: 'current', checkedAt: checked },
  { hostId: 'build-01', hostLabel: 'build-01', agent: 'codex', installed: '0.151.2', latest: '0.154.0', status: 'available', checkedAt: checked },
  { hostId: 'build-01', hostLabel: 'build-01', agent: 'claude', installed: '2.1.257', latest: '2.1.263', status: 'available', checkedAt: checked },
  { hostId: 'gpu-box', hostLabel: 'gpu-box', agent: 'codex', installed: '0.154.0', latest: '0.154.0', status: 'current', checkedAt: checked },
] as const;

// ---- Demo workspace ----------------------------------------------------------------------
async function launch() {
  const dir = await mkdtemp(path.join(tmpdir(), 'harbor-site-shots-'));
  const createdAt = new Date().toISOString();
  // On disk: a valid local index, so the engine starts normally. The richer demo snapshot is swapped in below.
  const projects = PROJECTS.map(p => ({ id: p.id, name: p.name, cwd: dir, hostId: 'local', hostLabel: 'This Mac', connection: 'local', createdAt }));
  const sessions = CHATS.map(([id, projectId, name, launcher], i) => ({ id, tmuxName: `harbor-5170${i}`, paneId: `%${i}`, name, host: 'local', cwd: dir, launcher, group: '', tags: [], pinned: false, archived: false, createdAt, updatedAt: new Date(Date.now() - i * 60000).toISOString(), status: 'closed', projectId, hasMessages: true }));
  await writeFile(path.join(dir, 'sessions.json'), JSON.stringify({ version: 2, projects, sessions }));
  const app = await electron.launch({ executablePath: process.env.HARBOR_TEST_APP, args: process.env.HARBOR_TEST_APP ? [] : [ROOT], cwd: ROOT, env: { ...process.env, HARBOR_DATA_DIR: dir, HARBOR_TMUX_SOCKET: `harbor-site-${process.pid}` } });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await expect(page.locator('.sidebar .chat-row').first()).toBeVisible();
  return { app, page };
}

async function stage(app: ElectronApplication, page: Page) {
  const snapshot = await page.evaluate(() => window.harbor.snapshot());
  const now = Date.now();
  snapshot.projects = PROJECTS.map(p => ({ id: p.id, name: p.name, cwd: p.cwd, hostId: p.host, hostLabel: p.host === 'local' ? 'This Mac' : p.host, connection: p.host === 'local' ? 'local' : SSH[p.host], createdAt: new Date(now - 86400000).toISOString() }));
  snapshot.sessions = CHATS.map(([id, projectId, name, launcher, activity, unread], i) => {
    const project = PROJECTS.find(p => p.id === projectId)!;
    const remote = project.host !== 'local';
    return { ...snapshot.sessions.find(s => s.id === id)!, name, launcher, cwd: project.cwd, host: remote ? project.host : 'local', hostId: project.host, hostLabel: remote ? project.host : 'This Mac', ...(remote ? { connection: SSH[project.host as keyof typeof SSH] } : {}),
      status: activity === 'closed' ? 'closed' : 'running', activity: activity as never, activityAt: now - i * 60000, unread, updatedAt: new Date(now - i * 60000).toISOString(), conversationId: `00000000-0000-4000-8000-${(0xde000 + i).toString(16).padStart(12, '0')}`,
      ...(activity === 'background' ? { activityDetail: launcher === 'claude' ? 'npm run test:integration' : 'python sweep.py' } : {}),
      ...(id === 'b1' ? { pinned: true } : {}), ...(id === 'a1' ? { note: NOTE } : {}) };
  });
  snapshot.agentUpdates = { updates: [...UPDATES], checking: false, updatingAll: false, results: {}, checkedAt: now };
  const screens = Object.fromEntries(CHATS.map(([id, projectId, , kind]) => [id, { kind, cwd: PROJECTS.find(p => p.id === projectId)!.cwd }]));
  await app.evaluate(({ BrowserWindow, ipcMain }, { snapshot, screens, script }) => {
    const draw = new Function('return ' + script)() as (id: string, kind: string, cwd: string, cols: number, rows: number) => string;
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    const send = contents.send.bind(contents);
    contents.send = (channel: string, ...args: unknown[]) => send(channel, ...(channel === 'harbor:snapshot-changed' ? [snapshot] : args));
    const replace = (channel: string, handler: (...args: any[]) => unknown) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler); };
    replace('harbor:snapshot', () => snapshot);
    replace('harbor:checkUpdates', () => snapshot.agentUpdates!.updates);
    replace('harbor:checkReachability', () => Object.fromEntries(snapshot.projects.map(p => [JSON.stringify(p.connection), true])));
    const cost = (usd: number) => ({ usd, estimated: usd, recorded: 0, unpriced: 0, models: [{ model: 'demo', usd, estimated: usd, recorded: 0, unpriced: 0 }], days: [] });
    const tokens = (total: number) => ({ inputTokens: total * .7, outputTokens: total * .05, cacheReadTokens: total * .2, cacheWriteTokens: total * .05, totalTokens: total });
    replace('harbor:chatUsage', (_event: unknown, id: string) => { const n = id.charCodeAt(0) * 7 + id.charCodeAt(1) * 13; return { tokens: tokens(n * 4100), compactionCount: (n % 2) * 2, cost: cost(n / 90) }; });
    const period = (usd: number) => ({ tokens: tokens(usd * 90000), sessions: 6, cost: cost(usd) });
    replace('harbor:usage', () => [{ hostId: 'local', hostLabel: 'This Mac', checkedAt: new Date().toISOString(), agents: [{ agent: 'claude', sessions: 6, recordedSessions: 6, periods: { day: period(8.42), week: period(41.1), month: period(163) } }] }]);
    const paint = (_event: unknown, id: string, cols: number, rows: number) => {
      const s = screens[id]; if (!s) return;
      contents.send('harbor:terminal', { id, type: 'data', data: Buffer.from(draw(id, s.kind, s.cwd, cols, rows)).toString('base64') });
    };
    replace('harbor:attach', paint); replace('harbor:resize', paint); replace('harbor:detach', () => undefined);
    contents.send('harbor:snapshot-changed', snapshot);
  }, { snapshot, screens, script: screenScript() });
  // Reload so the renderer's first usage and reachability fetches hit the demo handlers, not real data.
  await page.reload();
  await expect(page.locator('.sidebar .chat-row', { hasText: 'Plot ablations' })).toBeVisible();
  await expect(page.locator('.sidebar-cost-value')).toContainText('8.42');
}
// The terminal painter runs in Electron's main process, so it is shipped over as source with its data inlined.
function screenScript() {
  const consts = { R, B, DIM, TXT, claude, codex };
  return `(()=>{const {R,B,DIM,TXT,claude,codex}=${JSON.stringify(consts)};return ${screen.toString()};})()`;
}

const openChat = (page: Page, name: string) => page.locator('.sidebar .chat-row', { hasText: name }).click();
async function split(page: Page, source: string, target: string, side: string) {
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await page.locator(`[data-tab-id="${source}"]`).dispatchEvent('dragstart', { dataTransfer: transfer });
  const zone = page.locator(`[data-session-id="${target}"] [data-drop-side="${side}"]`);
  await expect(zone).toBeVisible(); await zone.dispatchEvent('dragover', { dataTransfer: transfer }); await zone.dispatchEvent('drop', { dataTransfer: transfer });
  await transfer.dispose();
}
const settle = (page: Page) => page.waitForTimeout(700);
// Feature cards share one aspect ratio: crop a 16:10 box around the targets, kept inside the window.
// ratio 0 crops to the targets' own shape.
// within keeps the crop inside one element, so no slivers of neighboring UI show at the edges.
async function crop(page: Page, targets: Locator[], file: string, pad = 36, ratio = 1.6, within?: Locator) {
  const boxes = (await Promise.all(targets.map(t => t.boundingBox()))).filter(b => !!b) as { x: number; y: number; width: number; height: number }[];
  const bound = within ? (await within.boundingBox())! : null;
  const view = bound ? { w: bound.width, h: bound.height } : await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  if (bound) for (const b of boxes) { b.x -= bound.x; b.y -= bound.y; }
  const x0 = Math.min(...boxes.map(b => b.x)) - pad, y0 = Math.min(...boxes.map(b => b.y)) - pad;
  const x1 = Math.max(...boxes.map(b => b.x + b.width)) + pad, y1 = Math.max(...boxes.map(b => b.y + b.height)) + pad;
  let width = ratio ? Math.max(x1 - x0, (y1 - y0) * ratio) : x1 - x0; width = Math.min(width, view.w, ratio ? view.h * ratio : view.w);
  const height = ratio ? width / ratio : Math.min(y1 - y0, view.h);
  const x = Math.max(0, Math.min((x0 + x1 - width) / 2, view.w - width)), y = Math.max(0, Math.min((y0 + y1 - height) / 2, view.h - height));
  await page.screenshot({ path: `${OUT}/${file}.png`, clip: { x: x + (bound?.x ?? 0), y: y + (bound?.y ?? 0), width, height } });
}
const row = (page: Page, name: string) => page.locator('.sidebar .chat-row', { hasText: name });

test('landing page screenshots', async () => {
  OUT = await mkdtemp(path.join(tmpdir(), 'harbor-site-png-'));
  const { app, page } = await launch();
  try {
    await stage(app, page);
    // Hero: several projects on two machines, grouped tabs, Codex and Claude side by side.
    for (const name of ['Tab strip polish', 'Release notes 0.5', 'Rate limiter', 'Flaky auth test', 'Learning-rate sweep', 'Plot ablations']) await openChat(page, name);
    await openChat(page, 'Rate limiter');
    await split(page, 'b2', 'b1', 'right');
    await expect(page.locator('.workspace-pane')).toHaveCount(2);
    await settle(page);
    await page.screenshot({ path: `${OUT}/hero.png` });

    // Remote: a chat on the GPU server, beside the sidebar that lists hosts per project.
    await openChat(page, 'Learning-rate sweep');
    await split(page, 'c2', 'c1', 'right');
    await settle(page);
    // Focused on the sidebar's host badges, with the remote chat beside them.
    await crop(page, [page.locator('.project-heading', { hasText: 'harbor-app' }), page.locator('.project-heading', { hasText: 'docs-site' }), row(page, 'Postgres 17 migration')], 'remote', 12, 0, page.locator('.sidebar'));

    // Projects: fold two groups; the chips carry the most urgent status.
    await page.getByRole('button', { name: /^tessera-api group/ }).click();
    await page.getByRole('button', { name: /^harbor-app group/ }).click();
    await settle(page);

    // Feature cards. Drop: a file dragged over a chat on the GPU server.
    const surface = page.locator('[data-session-id="c2"] .terminal-surface');
    await surface.evaluate(el => { const dt = new DataTransfer(); dt.items.add(new File(['x'], 'loss_curve.png', { type: 'image/png' })); el.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })); });
    await expect(page.locator('.file-drop-indicator')).toBeVisible(); await settle(page);
    await crop(page, [page.locator('.file-drop-indicator'), page.locator('[data-session-id="c2"] .xterm-rows > div').nth(9)], 'drop', 40, 1.6, page.locator('[data-session-id="c2"]'));
    await surface.evaluate(el => el.dispatchEvent(new DragEvent('dragleave', { bubbles: true, relatedTarget: document.body })));

    // Search: ⌘F over a chat's scrollback.
    await openChat(page, 'Flaky auth test');
    await page.locator('[data-session-id="b2"] .xterm').click();
    await page.keyboard.press('Meta+f');
    const find = page.locator('[data-session-id="b2"] .terminal-find input'); await expect(find).toBeFocused();
    await find.fill('test'); await page.keyboard.press('Enter');
    await expect(page.locator('.terminal-find-count')).toBeVisible(); await settle(page);
    await crop(page, [page.locator('[data-session-id="b2"] .terminal-find'), page.locator('[data-session-id="b2"] .xterm-rows > div').nth(8)], 'search', 36, 1.6, page.locator('[data-session-id="b2"]'));
    await page.keyboard.press('Escape');

    // Rename and pin: the chat menu, next to a pinned chat.
    await row(page, 'Flaky auth test').click({ button: 'right' });
    const menu = page.locator('.chat-context-menu'); await expect(menu).toBeVisible(); await settle(page);
    await crop(page, [menu, row(page, 'Rate limiter')], 'pin', 12, 0);
    await page.keyboard.press('Escape');

    // Notes and to-dos, in the formatted view.
    await row(page, 'Tab strip polish').hover(); await row(page, 'Tab strip polish').locator('.chat-note').click();
    const editor = page.getByRole('dialog', { name: 'Note for Tab strip polish' });
    await editor.getByRole('radio', { name: 'Formatted' }).click(); await settle(page);
    await editor.screenshot({ path: `${OUT}/notes.png` });
    await page.keyboard.press('Escape');

    // Both agents: the New chat dialog with its permission mode.
    await page.getByRole('button', { name: 'New chat in tessera-api', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New chat' });
    await dialog.getByRole('button', { name: /Claude Code/ }).click(); await settle(page);
    await crop(page, [dialog.locator('.modal-heading'), dialog.locator('.launcher-options'), dialog.locator('label', { hasText: 'Permission mode' })], 'agents', 14, 0, dialog);
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    // Agent updates across machines.
    await page.getByRole('button', { name: /^Preferences/ }).click();
    await page.getByRole('button', { name: 'Agent updates', exact: true }).click();
    await expect(page.locator('.updates-table')).toBeVisible(); await settle(page);
    await crop(page, [page.locator('.updates-heading'), page.locator('.updates-table tbody tr').nth(5)], 'updates', 20, 0);
    await page.keyboard.press('Escape');

    // Step away: everything folded shows the overview of every chat and what it needs.
    await page.getByRole('button', { name: 'Tab groups', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Collapse all groups' }).click();
    await expect(page.locator('.groups-overview')).toBeVisible();
    await settle(page);
    await crop(page, [page.locator('.session-toolbar [data-group-key]').first(), page.locator('.group-card').first(), page.locator('.group-card').last()], 'overview', 30, 0, page.locator('.workspace'));
  } finally { await app.close(); }
  for (const file of await readdir(OUT)) execFileSync('cwebp', ['-quiet', '-q', '82', '-m', '6', path.join(OUT, file), '-o', path.join(SHOTS, file.replace(/\.png$/, '.webp'))]);
  execFileSync('magick', [path.join(OUT, 'hero.png'), '-resize', '1200x', '-gravity', 'north', '-crop', '1200x630+0+0', '+repage', '-strip', path.join(SHOTS, '../og.png')]);
  await rm(OUT, { recursive: true });
});
