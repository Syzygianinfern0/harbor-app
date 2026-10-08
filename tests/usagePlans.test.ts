import test from 'node:test';
import assert from 'node:assert/strict';
import { STALE_AFTER_MS, asOfText, buildAccounts, chatPlan, cleanBilling, cleanLimits, cleanPlans, currentWindows, footerSummary, isStale, mergeLimits, windowStale, leftText, resetText, staleUsedText, tightest, toneOf, windowLabel } from '../src/shared/usagePlans';
import { usageSourceFromEnv, fixtureLimits } from '../src/engine/usageSource';
import { addTokens, compactTokens, tokenBreakdown, tokenLine } from '../src/shared/usageTokens';
import type { AgentUsage, HostUsage, UsageLimits } from '../src/shared/types';

const now = 1_900_000_000_000; const sec = now / 1000;
const cost = (usd: number) => ({ usd, estimated: 1, recorded: 0, unpriced: 0, models: [], days: [] });
const tokens = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 };
const agentUsage = (agent: 'codex' | 'claude', day: number): AgentUsage => ({ agent, sessions: 2, recordedSessions: 2, periods: { day: { tokens, sessions: 1, cost: cost(day) }, week: { tokens, sessions: 2, cost: cost(day * 5) }, month: { tokens, sessions: 2, cost: cost(day * 20) } } });
const local = JSON.stringify('local'); const devbox = JSON.stringify({ target: 'devbox' });
const usage: HostUsage[] = [
  { hostId: local, hostLabel: 'This Mac', checkedAt: '', agents: [agentUsage('claude', 1), agentUsage('codex', 0.5)] },
  { hostId: devbox, hostLabel: 'devbox', checkedAt: '', agents: [agentUsage('claude', 2.1), agentUsage('codex', 0.25)] },
];
const limits: UsageLimits = { chats: {}, hosts: [
  { hostId: local, hostLabel: 'This Mac', checkedAt: '', agents: [
    { agent: 'claude', mode: 'subscription', plan: 'Pro', account: 'aaaaaaaaaaaaaaaa', limits: { windows: [{ usedPercent: 52, windowMinutes: 300, resetsAt: sec + 6000 }, { usedPercent: 33, windowMinutes: 10080, resetsAt: sec + 300000 }], at: sec - 120 } },
    { agent: 'codex', mode: 'subscription', plan: 'Plus', account: 'bbbbbbbbbbbbbbbb', limits: { windows: [{ usedPercent: 27, windowMinutes: 300 }], at: sec - 600 } }] },
  { hostId: devbox, hostLabel: 'devbox', checkedAt: '', agents: [
    { agent: 'claude', mode: 'api' },
    { agent: 'codex', mode: 'subscription', plan: 'Plus', account: 'bbbbbbbbbbbbbbbb', limits: { windows: [{ usedPercent: 69, windowMinutes: 10080, resetsAt: sec + 90000 }, { usedPercent: 27, windowMinutes: 300 }], at: sec - 5 } }] },
] };

test('one account per sign-in across hosts; API keys stay per host', () => {
  const accounts = buildAccounts(usage, limits);
  assert.deepEqual(accounts.map(a => [a.kind, a.agent, a.hosts.map(h => h.label).join(',')]), [['subscription', 'claude', 'This Mac'], ['subscription', 'codex', 'This Mac,devbox'], ['api', 'claude', 'devbox']]);
  const codex = accounts[1];
  assert.equal(codex.limits?.at, sec - 5, 'newest snapshot across hosts wins');
  assert.equal(codex.cost.week.usd, 3.75, 'API-equivalent value sums both hosts');
  assert.equal(accounts[2].cost.day.usd, 2.1);
});

test('footer shows the tightest window and adds API spend only when an account pays per token', () => {
  const mixed = footerSummary(buildAccounts(usage, limits), now);
  assert.equal(mixed.worst?.window.usedPercent, 69); assert.equal(mixed.worst?.account.agent, 'codex'); assert.equal(mixed.spend?.usd, 2.1);
  const subscriptionOnly = { ...limits, hosts: [limits.hosts[0]] };
  const only = footerSummary(buildAccounts([usage[0]], subscriptionOnly), now);
  assert.equal(only.worst?.window.usedPercent, 52); assert.equal(only.spend, undefined);
  const apiOnly = footerSummary(buildAccounts(usage, { chats: {}, hosts: limits.hosts.map(h => ({ ...h, agents: h.agents.map(a => ({ agent: a.agent, mode: 'api' as const })) })) }), now);
  assert.equal(apiOnly.worst, undefined); assert.equal(apiOnly.spend?.usd, 3.85);
});

test('unknown plans, pending subscriptions and unreachable hosts', () => {
  const accounts = buildAccounts([usage[1]], { chats: {}, hosts: [
    { hostId: local, hostLabel: 'This Mac', checkedAt: '', agents: [{ agent: 'claude', mode: 'subscription', plan: 'Pro' }, { agent: 'codex', mode: 'unknown' }] },
    { hostId: devbox, hostLabel: 'devbox', checkedAt: '', agents: [{ agent: 'codex', mode: 'unknown' }, { agent: 'claude', mode: 'unknown' }] },
    { hostId: 'buildbox', hostLabel: 'buildbox', checkedAt: '', agents: [], unreachable: true, error: 'timed out' }] });
  assert.deepEqual(accounts.map(a => a.kind + ':' + (a.agent ?? a.hosts[0].label)), ['subscription:claude', 'unknown:claude', 'unknown:codex', 'down:buildbox']);
  const summary = footerSummary(accounts, now);
  assert.ok(summary.pending); assert.ok(summary.partial); assert.ok(summary.estimate); assert.equal(summary.worst, undefined);
});

test('chat plan: its own billing first, then the host default', () => {
  const accounts = buildAccounts(usage, limits);
  const chat = (id: string, launcher: string, host: string, connection?: { target: string }) => chatPlan({ id, launcher, host, connection }, limits, accounts, now);
  assert.equal(chat('a', 'claude', 'local')?.window?.usedPercent, 52);
  assert.equal(chat('b', 'claude', 'devbox', { target: 'devbox' })?.kind, 'api');
  assert.equal(chat('c', 'codex', 'devbox', { target: 'devbox' })?.window?.usedPercent, 69);
  // A chat launched with an API key on a subscription host.
  const withKey = chatPlan({ id: 'd', launcher: 'claude', host: 'local' }, { ...limits, chats: { d: { mode: 'api' } } }, accounts, now);
  assert.equal(withKey?.kind, 'api');
  // A chat's own status-line snapshot is newer than the host's.
  const own = chatPlan({ id: 'e', launcher: 'claude', host: 'local' }, { ...limits, chats: { e: { mode: 'subscription', account: 'aaaaaaaaaaaaaaaa', limits: { windows: [{ usedPercent: 94, windowMinutes: 300 }], at: sec } } } }, accounts, now);
  assert.equal(own?.window?.usedPercent, 94);
  assert.equal(chatPlan({ id: 'f', launcher: 'shell', host: 'local' }, limits, accounts, now), undefined);
});

test('windows reset, labels and text', () => {
  assert.deepEqual(currentWindows({ windows: [{ usedPercent: 80, windowMinutes: 300, resetsAt: sec - 1 }], at: sec - 9000 }, now), [{ usedPercent: 0, windowMinutes: 300, at: sec - 9000 }]);
  assert.equal(tightest([{ usedPercent: 40, windowMinutes: 10080 }, { usedPercent: 40, windowMinutes: 300 }])?.windowMinutes, 300);
  assert.deepEqual([300, 10080, 1440, 120, 43200, undefined].map(m => windowLabel({ usedPercent: 1, windowMinutes: m })), ['5-hour', 'Weekly', 'Daily', '2-hour', '30-day', 'Limit']);
  assert.equal(leftText({ usedPercent: 61.5 }), '38% left'); assert.equal(leftText({ usedPercent: 100 }), 'Limit reached');
  assert.equal(resetText(sec + 18 * 60, now), 'in 18m'); assert.equal(resetText(sec + 134 * 60, now), 'in 2h 14m');
});

test('bridge data is sanitized and never carries raw IDs', () => {
  assert.equal(cleanBilling({ mode: 'subscription', account: 'raw-account-uuid' })?.account, undefined);
  assert.equal(cleanBilling({ mode: 'free money' }), undefined);
  assert.deepEqual(cleanPlans({ agents: [{ agent: 'codex', mode: 'api', email: 'alice@example.invalid' }, { agent: 'other', mode: 'api' }] }), [{ agent: 'codex', mode: 'api' }]);
  assert.equal(cleanBilling({ mode: 'subscription', limits: { windows: [{ usedPercent: 300 }], at: 1 } })?.limits, undefined);
});

test('test and sandbox profiles never read real usage', () => {
  assert.equal(usageSourceFromEnv({ HARBOR_DATA_DIR: '/tmp/x' }).kind, 'off');
  assert.equal(usageSourceFromEnv({ HARBOR_DATA_DIR: '/tmp/x', HARBOR_LIVE_USAGE: '1' }).kind, 'live');
  assert.equal(usageSourceFromEnv({ HARBOR_USAGE_FIXTURE: '/tmp/f.json' }).kind, 'fixture');
  assert.equal(usageSourceFromEnv({}).kind, 'live');
  const fixture = fixtureLimits({ limits: { chats: { 'Fix tab folding': { mode: 'api' } } } }, [{ id: 's1', name: 'Fix tab folding' } as any]);
  assert.deepEqual(fixture.chats, { s1: { mode: 'api' } });
});

test('token counts sum across cost rows and format compactly with an exact breakdown', () => {
  const row = { inputTokens: 1_200_000, outputTokens: 34_000, cacheReadTokens: 900_000, cacheWriteTokens: 50_000, reasoningTokens: 12_000, totalTokens: 1_234_000 };
  assert.equal(addTokens([undefined]), undefined);
  assert.deepEqual(addTokens([row, undefined, { ...row, reasoningTokens: undefined }]), { inputTokens: 2_400_000, outputTokens: 68_000, cacheReadTokens: 1_800_000, cacheWriteTokens: 100_000, reasoningTokens: 12_000, totalTokens: 2_468_000 });
  assert.deepEqual([0, 940, 1234, 9950, 12_345, 950_000, 999_950, 1_234_567, 2_100_000_000].map(compactTokens), ['0', '940', '1.2k', '10k', '12k', '950k', '1M', '1.2M', '2.1B']);
  assert.equal(tokenBreakdown(row), '1,234,000 tokens · Input 1,200,000 (cache read 900,000 · cache write 50,000) · Output 34,000 (reasoning 12,000)');
  assert.equal(tokenBreakdown({ ...row, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }), '1,234,000 tokens · Input 1,200,000 · Output 34,000');
  assert.equal(tokenLine(row), '1.2M input · 950k cached · 34k output · 12k reasoning');
});

test('stale limits read as a lower bound, never warn as current, and still reset', () => {
  const fresh = { windows: [{ usedPercent: 91, windowMinutes: 300 }], at: sec - 60 };
  const old = { windows: [{ usedPercent: 26.4, windowMinutes: 300, resetsAt: sec + 3600 }, { usedPercent: 91, windowMinutes: 10080, resetsAt: sec - 60 }], at: sec - 2 * 3600 };
  assert.equal(isStale(fresh, now), false); assert.equal(isStale(old, now), true); assert.equal(isStale(undefined, now), false);
  assert.equal(isStale({ ...fresh, at: sec - STALE_AFTER_MS / 1000 + 1 }, now), false); assert.equal(isStale({ ...fresh, at: sec - STALE_AFTER_MS / 1000 - 1 }, now), true);
  const windows = currentWindows(old, now);
  assert.deepEqual(windows.map(staleUsedText), ['≥26% used', '≥0% used']);
  assert.equal(asOfText(old.at, now), 'as of 2 h ago');
  assert.equal(toneOf(fresh.windows[0], false), 'danger'); assert.equal(toneOf(fresh.windows[0], true), 'stale');
  assert.equal(cleanLimits({ ...fresh, source: 'live' })?.source, 'live');
});

test('limits merge per window: newer windows replace, usage only grows, missing windows are kept', () => {
  const fresh = { windows: [{ usedPercent: 3, windowMinutes: 300, resetsAt: sec + 17000 }, { usedPercent: 86, windowMinutes: 10080, resetsAt: sec + 300000 }], at: sec - 30 };
  const idle = { windows: [{ usedPercent: 80, windowMinutes: 10080, resetsAt: sec + 300030 }], at: sec - 3 * 3600 };
  const merged = mergeLimits(fresh, idle)!;
  assert.deepEqual(merged.windows.map(w => [w.windowMinutes, w.usedPercent, w.at]), [[300, 3, sec - 30], [10080, 86, sec - 30]]);
  assert.deepEqual(mergeLimits(idle, fresh), merged);
  const reset = mergeLimits(fresh, { windows: [{ usedPercent: 1, windowMinutes: 300, resetsAt: sec + 30000 }], at: sec - 3 * 3600 })!;
  assert.equal(reset.windows[0].usedPercent, 1);
  const windows = currentWindows({ ...merged, windows: [merged.windows[0], { ...merged.windows[1], at: sec - 7200 }] }, now);
  assert.deepEqual(windows.map(w => windowStale(w, now)), [false, true]);
  assert.equal(windowStale(currentWindows(idle, now)[0], now), true);
});
