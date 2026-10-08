import { test, expect, _electron as electron, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Plan-aware usage with injected fake snapshots (HARBOR_USAGE_FIXTURE). Placeholder numbers only.
const local = JSON.stringify('local'); const devbox = JSON.stringify({ target: 'devbox' }); const buildbox = JSON.stringify({ target: 'buildbox' });
const tokens = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 };
const cost = (usd: number) => ({ usd, estimated: 2, recorded: 0, unpriced: 0, models: [{ model: 'demo-model', usd, estimated: 2, recorded: 0, unpriced: 0 }], days: [] });
const spend = (agent: string, day: number) => ({ agent, sessions: 3, recordedSessions: 3, periods: { day: { tokens, sessions: 1, cost: cost(day) }, week: { tokens, sessions: 2, cost: cost(day * 5) }, month: { tokens, sessions: 3, cost: cost(day * 20) } } });
const windows = (five: number, week: number) => ({ windows: [{ usedPercent: five, windowMinutes: 300, resetsIn: 8040 }, { usedPercent: week, windowMinutes: 10080, resetsIn: 300000 }], ago: 60 });
const chat = { tokens: { ...tokens, totalTokens: 402118 }, compactionCount: 1, cost: cost(0.86) };

const SCENARIOS: Record<string, object> = {
  api: { usage: [{ hostId: local, hostLabel: 'This Mac', agents: [spend('claude', 3.84), spend('codex', 1.27)] }],
    limits: { hosts: [{ hostId: local, hostLabel: 'This Mac', agents: [{ agent: 'claude', mode: 'api' }, { agent: 'codex', mode: 'api' }] }] }, chat },
  subscription: { usage: [{ hostId: local, hostLabel: 'This Mac', agents: [spend('claude', 2.48), spend('codex', 0.62)] }],
    limits: { hosts: [{ hostId: local, hostLabel: 'This Mac', agents: [{ agent: 'claude', mode: 'subscription', plan: 'Max', account: 'aaaaaaaaaaaaaaaa', limits: windows(38, 61) }, { agent: 'codex', mode: 'subscription', plan: 'Plus', account: 'bbbbbbbbbbbbbbbb', limits: windows(12, 44) }] }] }, chat },
  mixed: { usage: [{ hostId: local, hostLabel: 'This Mac', agents: [spend('claude', 1.35), spend('codex', 0.44)] }, { hostId: devbox, hostLabel: 'devbox', agents: [spend('claude', 2.1), spend('codex', 0.2)] }],
    limits: { hosts: [{ hostId: local, hostLabel: 'This Mac', agents: [{ agent: 'claude', mode: 'subscription', plan: 'Pro', account: 'aaaaaaaaaaaaaaaa', limits: windows(52, 33) }, { agent: 'codex', mode: 'subscription', plan: 'Plus', account: 'bbbbbbbbbbbbbbbb', limits: windows(27, 69) }] },
      { hostId: devbox, hostLabel: 'devbox', agents: [{ agent: 'claude', mode: 'api' }, { agent: 'codex', mode: 'subscription', plan: 'Plus', account: 'bbbbbbbbbbbbbbbb' }] }] }, chat },
  unknown: { usage: [{ hostId: local, hostLabel: 'This Mac', agents: [spend('claude', 0.9)] }, { hostId: devbox, hostLabel: 'devbox', agents: [spend('codex', 0.64)] }],
    limits: { hosts: [{ hostId: local, hostLabel: 'This Mac', agents: [{ agent: 'claude', mode: 'subscription', plan: 'Pro' }] }, { hostId: devbox, hostLabel: 'devbox', agents: [{ agent: 'codex', mode: 'unknown' }] },
      { hostId: buildbox, hostLabel: 'buildbox', agents: [], unreachable: true, error: 'Host is not answering. Retrying with backoff.' }] }, chat },
  near: { usage: [{ hostId: local, hostLabel: 'This Mac', agents: [spend('claude', 8.24), spend('codex', 1.92)] }],
    limits: { hosts: [{ hostId: local, hostLabel: 'This Mac', agents: [{ agent: 'claude', mode: 'subscription', plan: 'Max', account: 'aaaaaaaaaaaaaaaa', limits: windows(94, 71) }, { agent: 'codex', mode: 'subscription', plan: 'Plus', account: 'bbbbbbbbbbbbbbbb', limits: windows(40, 100) }] }] }, chat },
  // The sandbox's own fixture (npm run dev:sandbox), so its token counts stay renderable.
  sandbox: JSON.parse(readFileSync(path.resolve('tests/fixtures/usage-mixed.json'), 'utf8')),
};

async function launch(scenario?: string) {
  const dir = await mkdtemp(path.join(tmpdir(), 'harbor-usage-plans-')); const createdAt = new Date().toISOString();
  const projects = [{ id: 'app', name: 'harbor-app', cwd: dir, hostId: 'local', hostLabel: 'This Mac', connection: 'local', createdAt }];
  const sessions = [['claude', 'Fix tab folding'], ['codex', 'Write unit tests']].map(([launcher, name], i) => ({ id: `chat-${i}`, tmuxName: `harbor-eeee${i}`, paneId: `%${i}`, name, host: 'local', cwd: dir, launcher, group: '', tags: [], pinned: false, archived: false, createdAt, updatedAt: new Date(Date.now() - i * 1000).toISOString(), status: 'closed', projectId: 'app', hasMessages: true }));
  await writeFile(path.join(dir, 'sessions.json'), JSON.stringify({ version: 2, projects, sessions }));
  const env: Record<string, string> = { ...process.env as Record<string, string>, HARBOR_DATA_DIR: dir, HARBOR_TMUX_SOCKET: 'harbor-usage-e2e-' + process.pid };
  delete env.HARBOR_USAGE_FIXTURE; delete env.HARBOR_LIVE_USAGE;
  if (scenario) { const file = path.join(dir, 'usage-fixture.json'); await writeFile(file, JSON.stringify(SCENARIOS[scenario])); env.HARBOR_USAGE_FIXTURE = file; }
  const app = await electron.launch({ executablePath: process.env.HARBOR_TEST_APP, args: process.env.HARBOR_TEST_APP ? [] : ['.'], env });
  return { app, page: await app.firstWindow() };
}
const footer = (page: Page) => page.getByRole('button', { name: 'Usage and limits', exact: true });
const openChat = (page: Page, name: string) => page.locator('.sidebar .chat-row', { hasText: name }).click();
const shot = (page: Page, name: string) => mkdir('test-results/screenshots', { recursive: true }).then(() => page.screenshot({ animations: 'disabled', path: `test-results/screenshots/${name}.png` }));

test('test profiles never show real usage', async () => {
  const { app, page } = await launch();
  try {
    await expect(footer(page)).toContainText('Off');
    await footer(page).click();
    await expect(page.getByRole('dialog', { name: 'Usage', exact: true })).toContainText('Usage is off in this test profile');
    await expect(page.locator('.account-card')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await openChat(page, 'Fix tab folding');
    await expect(page.getByLabel('Chat usage', { exact: true })).toContainText('Chat usage unavailable');
  } finally { await app.close(); }
});

test('API keys: money only, per account', async () => {
  const { app, page } = await launch('api');
  try {
    await expect(footer(page)).toContainText('24h'); await expect(footer(page)).toContainText('$5.11');
    await footer(page).click();
    const popover = page.getByRole('dialog', { name: 'Usage', exact: true });
    await expect(popover.getByRole('region', { name: 'Claude Code usage' })).toContainText('API key');
    await expect(popover.getByRole('region', { name: 'Claude Code usage' })).toContainText('$3.84');
    await expect(popover).not.toContainText('% left');
    await shot(page, 'usage-api-popover'); await page.keyboard.press('Escape');
    await openChat(page, 'Fix tab folding');
    const bar = page.getByLabel('Chat usage', { exact: true });
    await expect(bar.getByLabel('Plan usage')).toContainText('API key'); await expect(bar).toContainText('$0.86');
  } finally { await app.close(); }
});

test('subscriptions: what is left and when it resets, plus the API-rate value', async () => {
  const { app, page } = await launch('subscription');
  try {
    await expect(footer(page)).toContainText('Claude weekly'); await expect(footer(page)).toContainText('39% left');
    await expect(footer(page)).not.toContainText('$');
    await footer(page).click();
    const card = page.getByRole('dialog', { name: 'Usage', exact: true }).getByRole('region', { name: 'Claude Code usage' });
    await expect(card).toContainText('Max'); await expect(card).toContainText('5-hour'); await expect(card).toContainText('62% left'); await expect(card).toContainText('Resets in 2h 14m');
    await expect(card).toContainText('at API rates this week, not charged'); await expect(card).toContainText('Updated 1 min ago');
    await shot(page, 'usage-subscription-popover');
    await page.getByRole('button', { name: 'View detailed usage' }).click();
    await expect(page.locator('.usage-panel')).toContainText('Subscriptions · usage left');
    await expect(page.locator('.usage-panel').getByRole('region', { name: 'Codex usage' })).toContainText('Used on: This Mac');
    await shot(page, 'usage-subscription-preferences');
    await page.keyboard.press('Escape');
    await openChat(page, 'Fix tab folding');
    await expect(page.getByLabel('Plan usage')).toContainText('Max'); await expect(page.getByLabel('Plan usage')).toContainText('Weekly · 39% left');
    await expect(page.locator('.limit-ring')).toHaveCount(0);
  } finally { await app.close(); }
});

test('mixed local subscription and remote API key: one shared meter, money only for the API account', async () => {
  const { app, page } = await launch('mixed');
  try {
    await expect(footer(page)).toContainText('31%'); await expect(footer(page)).toContainText('$2.10');
    await footer(page).click();
    const popover = page.getByRole('dialog', { name: 'Usage', exact: true });
    await expect(popover.locator('.account-card')).toHaveCount(3);
    await expect(popover.getByRole('region', { name: 'Codex usage' })).toContainText('This Mac, devbox');
    await expect(popover.getByRole('region', { name: 'Codex usage' })).toContainText('shared by 2 hosts');
    await shot(page, 'usage-mixed-popover');
    await popover.getByRole('button', { name: 'View detailed usage' }).click();
    await page.getByRole('button', { name: 'Last month', exact: true }).first().click();
    await expect(page.locator('.usage-panel .account-card.compact')).toHaveCount(0);
    await expect(page.locator('.usage-panel')).toContainText('Pay as you go · spend');
    await expect(page.locator('.usage-panel').getByRole('region', { name: 'Claude Code usage' }).last()).toContainText('$42.00');
    await shot(page, 'usage-mixed-preferences');
  } finally { await app.close(); }
});

test('unknown plan, waiting for a first snapshot, and an unreachable host', async () => {
  const { app, page } = await launch('unknown');
  try {
    await expect(footer(page)).toContainText('$0.64 *');
    await footer(page).click();
    const popover = page.getByRole('dialog', { name: 'Usage', exact: true });
    await expect(popover).toContainText('Usage appears after the next reply in a Harbor-launched Claude chat');
    await expect(popover).toContainText("Couldn't tell whether this is an API key or a subscription. Update Codex on devbox");
    await expect(popover).toContainText('buildbox is unreachable. Retrying with backoff.');
    await shot(page, 'usage-unknown-popover'); await page.keyboard.press('Escape');
    await openChat(page, 'Fix tab folding');
    await expect(page.getByLabel('Plan usage')).toContainText('Usage appears after next reply');
  } finally { await app.close(); }
});

test('near the limit: warnings, a paused account and the tab ring', async () => {
  const { app, page } = await launch('near');
  try {
    await expect(footer(page)).toContainText('Codex weekly'); await expect(footer(page)).toContainText('Limit reached');
    await footer(page).click();
    const popover = page.getByRole('dialog', { name: 'Usage', exact: true });
    await expect(popover.getByRole('region', { name: 'Codex usage' })).toContainText('Codex is paused until');
    await expect(popover.getByRole('region', { name: 'Claude Code usage' })).toContainText('Almost out. Resets in 2h 14m.');
    await shot(page, 'usage-near-popover'); await page.keyboard.press('Escape');
    await openChat(page, 'Fix tab folding'); await openChat(page, 'Write unit tests');
    await expect(page.getByRole('img', { name: 'Claude 5-hour: 6% left' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Codex weekly: Limit reached' })).toBeVisible();
    await expect(page.getByLabel('Plan usage')).toContainText('Limit reached');
    await shot(page, 'usage-near-tabs');
  } finally { await app.close(); }
});

test('token cost at API rates folds away under the plan cards and shows tokens per row', async () => {
  const { app, page } = await launch('sandbox');
  try {
    await footer(page).click(); await page.getByRole('button', { name: 'View detailed usage' }).click();
    const head = page.locator('.cost-disclosure-head');
    await expect(head).toHaveAttribute('aria-expanded', 'false'); await expect(head).toContainText('≈ $18.80 · 1.2M tokens · last week');
    await shot(page, 'usage-cost-collapsed');
    // Defaults for a new viewer: last week, grouped by day, host and model.
    await head.click(); await expect(page.getByRole('button', { name: 'Last week', exact: true }).last()).toHaveAttribute('aria-pressed', 'true'); await expect(page.getByLabel('Group usage by')).toHaveValue('day');
    await expect(page.locator('.cost-total')).toContainText('1.2M tokens · 1.1M input · 940k cached · 43k output · 2k reasoning');
    await expect(page.locator('.cost-group').first()).toContainText('2026-01-15'); await expect(page.locator('.cost-group .cost-tokens').first()).toHaveText('476k tokens');
    await expect(page.locator('.cost-model .cost-tokens')).toHaveCount(12);
    await page.locator('.cost-total').scrollIntoViewIfNeeded(); await shot(page, 'usage-cost-expanded');
  } finally { await app.close(); }
});
