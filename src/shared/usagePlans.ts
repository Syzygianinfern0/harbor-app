import type { AgentPlan, BillingMode, ChatBilling, Connection, CostAmount, HostPlans, HostUsage, LimitSnapshot, LimitWindow, UsageLimits, UsagePeriod } from './types';

// Plan-aware usage: limits belong to an account, so a subscription signed in on several hosts is one meter.
// Money is shown only where it is spent per token (API keys), or as a labelled estimate when the plan is unknown.

type Agent = 'codex' | 'claude';
export type AccountKind = 'subscription' | 'api' | 'unknown' | 'down';
export interface UsageHost { id: string; label: string }
export interface UsageAccount {
  key: string; kind: AccountKind; agent?: Agent; plan?: string; hosts: UsageHost[];
  /** Newest snapshot across the account's hosts. */
  limits?: LimitSnapshot;
  cost: Record<UsagePeriod, CostAmount>; costAvailable: boolean; partial: boolean; error?: string;
}
export interface ChatPlan { kind: BillingMode; agent: Agent; plan?: string; window?: LimitWindow; reached?: boolean; account?: UsageAccount; limits?: LimitSnapshot }

const PERIODS: UsagePeriod[] = ['day', 'week', 'month'];
const MODES = new Set<BillingMode>(['subscription', 'api', 'unknown']);
const blank = (): CostAmount => ({ usd: 0, estimated: 0, recorded: 0, unpriced: 0 });
const add = (a: CostAmount, b?: CostAmount): CostAmount => b ? { usd: a.usd + b.usd, estimated: a.estimated + b.estimated, recorded: a.recorded + b.recorded, unpriced: a.unpriced + b.unpriced } : a;
const finite = (value: unknown, min = 0, max = Infinity): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const text = (value: unknown, max = 40) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
export const hostKey = (connection: Connection) => JSON.stringify(connection);
export const AGENT_NAMES: Record<Agent, string> = { claude: 'Claude Code', codex: 'Codex' };
export const SHORT_NAMES: Record<Agent, string> = { claude: 'Claude', codex: 'Codex' };

/** Bridge output is data from another machine: keep only well-formed fields. */
export function cleanLimits(value: unknown): LimitSnapshot | undefined {
  const raw = value as LimitSnapshot | undefined;
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.windows) || !finite(raw.at, 1)) return undefined;
  const windows = raw.windows.slice(0, 6).filter(w => w && finite(w.usedPercent, 0, 100)).map(w => ({ usedPercent: w.usedPercent, ...(finite(w.windowMinutes, 1) ? { windowMinutes: w.windowMinutes } : {}), ...(finite(w.resetsAt, 1) ? { resetsAt: w.resetsAt } : {}), ...(finite(w.at, 1) ? { at: w.at } : {}) }));
  const reached = text(raw.reached, 60);
  if (!windows.length && !reached) return undefined;
  return { windows, at: raw.at, ...(raw.source && ['app-server', 'live', 'log', 'statusline'].includes(raw.source) ? { source: raw.source } : {}), ...(reached ? { reached } : {}) };
}
export function cleanBilling(value: unknown): ChatBilling | undefined {
  const raw = value as ChatBilling | undefined;
  if (!raw || typeof raw !== 'object' || !MODES.has(raw.mode)) return undefined;
  const plan = text(raw.plan); const limits = cleanLimits(raw.limits);
  return { mode: raw.mode, ...(plan ? { plan } : {}), ...(typeof raw.account === 'string' && /^[a-f0-9]{16}$/.test(raw.account) ? { account: raw.account } : {}), ...(limits ? { limits } : {}) };
}
export function cleanPlans(value: unknown): AgentPlan[] {
  const agents = (value as { agents?: unknown[] } | undefined)?.agents;
  if (!Array.isArray(agents)) return [];
  return agents.flatMap(raw => {
    const agent = (raw as AgentPlan)?.agent; const billing = cleanBilling(raw);
    return (agent === 'codex' || agent === 'claude') && billing ? [{ agent, ...billing }] : [];
  });
}

/** A window whose reset time has passed has started over. */
export function currentWindows(limits: LimitSnapshot | undefined, now = Date.now()): LimitWindow[] {
  return (limits?.windows ?? []).map(w => ({ ...(w.resetsAt && w.resetsAt * 1000 <= now ? { usedPercent: 0, ...(w.windowMinutes ? { windowMinutes: w.windowMinutes } : {}) } : w), at: w.at ?? limits!.at }));
}
/** The window closest to its limit; on a tie, the one that resets sooner. */
export function tightest(windows: LimitWindow[]): LimitWindow | undefined {
  return windows.reduce<LimitWindow | undefined>((worst, w) => !worst || w.usedPercent > worst.usedPercent || (w.usedPercent === worst.usedPercent && (w.windowMinutes ?? Infinity) < (worst.windowMinutes ?? Infinity)) ? w : worst, undefined);
}
const SAME_WINDOW = 120; // seconds: resetsAt this close is the same limit window
/** Merge window by window (as the bridge does): a later reset is a newer window, within one window the higher
 * percentage wins (usage only grows), and a window missing from one snapshot is kept from the other. */
export function mergeLimits(a?: LimitSnapshot, b?: LimitSnapshot): LimitSnapshot | undefined {
  if (!a || !b) return a ?? b;
  const merged = new Map<number | undefined, LimitWindow>();
  for (const snapshot of [a, b]) for (const raw of snapshot.windows) {
    const window = { ...raw, at: raw.at ?? snapshot.at }; const kept = merged.get(window.windowMinutes);
    if (!kept) { merged.set(window.windowMinutes, window); continue; }
    const x = kept.resetsAt, y = window.resetsAt;
    if (x && y && Math.abs(x - y) > SAME_WINDOW) merged.set(window.windowMinutes, y > x ? window : kept);
    else if (x && y) merged.set(window.windowMinutes, { ...kept, usedPercent: Math.max(kept.usedPercent, window.usedPercent), resetsAt: Math.max(x, y), at: Math.max(kept.at!, window.at!) });
    else merged.set(window.windowMinutes, window.at! >= kept.at! ? window : kept);
  }
  const windows = [...merged.values()].sort((x, y) => (x.windowMinutes ?? 0) - (y.windowMinutes ?? 0));
  const newer = b.at >= a.at ? b : a;
  return { ...newer, windows, at: Math.max(a.at, b.at) };
}

export function buildAccounts(hosts: HostUsage[] | undefined, limits: UsageLimits | undefined): UsageAccount[] {
  const usage = new Map((hosts ?? []).map(h => [h.hostId, h]));
  const plans = new Map((limits?.hosts ?? []).map(h => [h.hostId, h]));
  const accounts = new Map<string, UsageAccount>();
  for (const id of new Set([...plans.keys(), ...usage.keys()])) {
    const spent = usage.get(id); const host: HostPlans | undefined = plans.get(id);
    const label = host?.hostLabel ?? spent?.hostLabel ?? id;
    if (host?.unreachable || spent?.unreachable || (host?.error && !host.agents.length && (!spent || spent.error))) {
      accounts.set('down@' + id, { key: 'down@' + id, kind: 'down', hosts: [{ id, label }], cost: { day: blank(), week: blank(), month: blank() }, costAvailable: false, partial: true, error: host?.error ?? spent?.error });
      continue;
    }
    for (const agent of ['claude', 'codex'] as const) {
      const plan = host?.agents.find(a => a.agent === agent);
      const agentUsage = spent?.agents.find(a => a.agent === agent);
      const used = !!agentUsage && (agentUsage.sessions > 0 || PERIODS.some(p => (agentUsage.periods[p]?.cost?.usd ?? 0) > 0));
      const kind: AccountKind = plan?.mode ?? 'unknown';
      // An agent that is neither signed in nor used on this host is not shown.
      if (kind === 'unknown' && !used) continue;
      const key = plan?.account && kind !== 'api' ? `${agent}:${plan.account}` : `${agent}:${kind}@${id}`;
      const account = accounts.get(key) ?? { key, kind, agent, hosts: [], cost: { day: blank(), week: blank(), month: blank() }, costAvailable: false, partial: false };
      if (!account.hosts.some(h => h.id === id)) account.hosts.push({ id, label });
      account.plan = account.plan ?? plan?.plan;
      account.limits = mergeLimits(account.limits, plan?.limits);
      if (agentUsage && !spent?.error) {
        for (const period of PERIODS) account.cost[period] = add(account.cost[period], agentUsage.periods[period]?.cost);
        account.costAvailable = account.costAvailable || PERIODS.some(p => !!agentUsage.periods[p]?.cost);
        account.partial = account.partial || !!agentUsage.partial || agentUsage.recordedSessions < agentUsage.sessions;
      } else if (spent?.error) account.partial = true;
      accounts.set(key, account);
    }
  }
  const order: AccountKind[] = ['subscription', 'api', 'unknown', 'down'];
  return [...accounts.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || (a.agent ?? '').localeCompare(b.agent ?? ''));
}

export interface FooterSummary { worst?: { account: UsageAccount; window: LimitWindow }; spend?: CostAmount; estimate: boolean; pending: boolean; partial: boolean }
/** Sidebar: the tightest subscription window, plus 24-hour spend only when some account pays per token. */
export function footerSummary(accounts: UsageAccount[], now = Date.now()): FooterSummary {
  let worst: FooterSummary['worst'];
  for (const account of accounts) {
    if (account.kind !== 'subscription') continue;
    const window = tightest(currentWindows(account.limits, now));
    if (window && (!worst || window.usedPercent > worst.window.usedPercent)) worst = { account, window };
  }
  const paying = accounts.filter(a => a.kind === 'api' || a.kind === 'unknown');
  return {
    worst, spend: paying.length ? paying.reduce((total, a) => add(total, a.cost.day), blank()) : undefined,
    estimate: paying.some(a => a.kind === 'unknown'),
    pending: accounts.some(a => a.kind === 'subscription' && !a.limits),
    partial: accounts.some(a => a.kind === 'down' || a.partial),
  };
}

/** A chat's own billing: what it reported, else its host's default for that agent. */
export function chatPlan(session: { id: string; launcher: string; host: string; connection?: Connection }, limits: UsageLimits | undefined, accounts: UsageAccount[], now = Date.now()): ChatPlan | undefined {
  if (session.launcher !== 'codex' && session.launcher !== 'claude') return undefined;
  const agent = session.launcher; const id = hostKey(session.connection ?? session.host);
  const billing = limits?.chats[session.id];
  const fallback = limits?.hosts.find(h => h.hostId === id)?.agents.find(a => a.agent === agent);
  const kind: BillingMode = billing && billing.mode !== 'unknown' ? billing.mode : fallback?.mode ?? 'unknown';
  if (kind !== 'subscription') return { kind, agent, plan: kind === 'api' ? billing?.plan ?? fallback?.plan : undefined };
  const accountId = billing?.account ?? fallback?.account;
  const account = accounts.find(a => a.kind === 'subscription' && a.agent === agent && (accountId ? a.key === `${agent}:${accountId}` : a.hosts.some(h => h.id === id)));
  const snapshot = mergeLimits(account?.limits, billing?.limits);
  const window = tightest(currentWindows(snapshot, now));
  return { kind, agent, plan: billing?.plan ?? fallback?.plan ?? account?.plan, window, account, limits: snapshot, reached: !!window && window.usedPercent >= 100 };
}

export const level = (used: number) => used >= 90 ? 'danger' : used >= 75 ? 'warn' : '';
export function windowLabel(window: LimitWindow) {
  const minutes = window.windowMinutes;
  if (!minutes) return 'Limit';
  if (minutes === 10080) return 'Weekly';
  if (minutes === 1440) return 'Daily';
  if (minutes < 1440 && minutes % 60 === 0) return `${minutes / 60}-hour`;
  return minutes < 1440 ? `${minutes}-minute` : `${Math.round(minutes / 1440)}-day`;
}
export const leftText = (window: LimitWindow) => window.usedPercent >= 100 ? 'Limit reached' : `${Math.max(0, Math.floor(100 - window.usedPercent))}% left`;
export function resetText(resetsAt: number | undefined, now = Date.now()) {
  if (!resetsAt) return undefined;
  const minutes = Math.round((resetsAt * 1000 - now) / 60000);
  if (minutes <= 0) return 'now';
  if (minutes < 60) return `in ${minutes}m`;
  if (minutes < 1440) return `in ${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
  return new Date(resetsAt * 1000).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}
export function agoText(at: number, now = Date.now()) {
  const seconds = Math.max(0, Math.round(now / 1000 - at));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  const days = Math.floor(seconds / 86400);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** A snapshot older than this is shown greyed out, as a lower bound: usage can only have grown since. */
export const STALE_AFTER_MS = 10 * 60 * 1000;
export const isStale = (limits: LimitSnapshot | undefined, now = Date.now()) => !!limits && now - limits.at * 1000 > STALE_AFTER_MS;
/** Staleness per window: each window carries when it was read (currentWindows fills it in). */
export const windowStale = (window: LimitWindow | undefined, now = Date.now()) => !!window?.at && now - window.at * 1000 > STALE_AFTER_MS;
/** When each agent's limits refresh on their own. */
export const STALE_HINT: Record<Agent, string> = { claude: 'Updates when a Claude chat replies', codex: 'Updates when a Codex chat runs' };
/** "≥26% used" for a stale reading (a window that has reset since reads ≥0%). */
export const staleUsedText = (window: LimitWindow) => `≥${Math.round(window.usedPercent)}% used`;
export const asOfText = (at: number, now = Date.now()) => `as of ${agoText(at, now)}`;
/** Tone for meters and rings: a stale number never warns as if it were current. */
export const toneOf = (window: LimitWindow, stale: boolean) => stale ? 'stale' : level(window.usedPercent);
