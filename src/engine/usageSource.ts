import { readFile } from 'node:fs/promises';
import type { ChatBilling, ChatUsage, HostPlans, HostUsage, Session, UsageLimits } from '../shared/types';
import { cleanBilling, cleanPlans } from '../shared/usagePlans';

/** Where usage, plans and limits come from. Test and sandbox profiles never read real usage. */
export type UsageSource = { kind: 'live' } | { kind: 'off'; reason: string } | { kind: 'fixture'; file: string };
export const USAGE_OFF = 'Usage is off in this test profile, so real numbers never reach tests or screenshots. Set HARBOR_LIVE_USAGE=1 to read real usage.';

export function usageSourceFromEnv(env: NodeJS.ProcessEnv): UsageSource {
  if (env.HARBOR_USAGE_FIXTURE) return { kind: 'fixture', file: env.HARBOR_USAGE_FIXTURE };
  // A custom profile (tests, `npm run dev:sandbox`) shares this Mac's ~/.codex and ~/.claude, so it must opt in.
  if (env.HARBOR_DATA_DIR && env.HARBOR_LIVE_USAGE !== '1') return { kind: 'off', reason: USAGE_OFF };
  return { kind: 'live' };
}

/** Fake usage for tests, screenshots and the sandbox. Chats are keyed by session ID or name; `resetsIn` and
 * `ago` (seconds) become `resetsAt` and `at` relative to now, so fixtures never go stale. */
export interface UsageFixture {
  usage?: HostUsage[];
  limits?: { hosts?: HostPlans[]; chats?: Record<string, ChatBilling> };
  chat?: ChatUsage; chats?: Record<string, ChatUsage>;
}
function relative<T>(value: T, now: number): T {
  if (Array.isArray(value)) return value.map(item => relative(item, now)) as T;
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'resetsIn' && typeof item === 'number') result.resetsAt = now + item;
    else if (key === 'ago' && typeof item === 'number') result.at = now - item;
    else result[key] = relative(item, now);
  }
  return result as T;
}
export async function readFixture(file: string): Promise<UsageFixture> {
  return relative(JSON.parse(await readFile(file, 'utf8')) as UsageFixture, Date.now() / 1000);
}
const pick = <T>(map: Record<string, T> | undefined, session: Pick<Session, 'id' | 'name'>) => map?.[session.id] ?? map?.[session.name];
export function fixtureUsage(fixture: UsageFixture): HostUsage[] {
  return (fixture.usage ?? []).map(host => ({ ...host, checkedAt: host.checkedAt ?? new Date().toISOString() }));
}
export function fixtureLimits(fixture: UsageFixture, sessions: Session[]): UsageLimits {
  const chats: Record<string, ChatBilling> = {};
  for (const session of sessions) { const billing = cleanBilling(pick(fixture.limits?.chats, session)); if (billing) chats[session.id] = billing; }
  return { chats, hosts: (fixture.limits?.hosts ?? []).map(host => ({ ...host, checkedAt: host.checkedAt ?? new Date().toISOString(), agents: cleanPlans(host) })) };
}
export function fixtureChat(fixture: UsageFixture, session: Pick<Session, 'id' | 'name'>): ChatUsage {
  return pick(fixture.chats, session) ?? fixture.chat ?? { error: 'No saved conversation is available yet.' };
}
