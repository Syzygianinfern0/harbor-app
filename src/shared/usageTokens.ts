import type { TokenUsage } from './types';

/** Sum token counts; undefined when no row carried any (a host on an older bridge). */
export function addTokens(rows: (TokenUsage | undefined)[]): TokenUsage | undefined {
  let total: TokenUsage | undefined;
  for (const row of rows) {
    if (!row) continue;
    total ??= { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 0 };
    total.inputTokens += row.inputTokens; total.outputTokens += row.outputTokens;
    total.cacheReadTokens += row.cacheReadTokens; total.cacheWriteTokens += row.cacheWriteTokens;
    total.reasoningTokens! += row.reasoningTokens ?? 0; total.totalTokens += row.totalTokens;
  }
  return total;
}

/** 940, 1.2k, 12k, 3.4M, 1.1B. */
export function compactTokens(value: number): string {
  const units = [['', 1], ['k', 1e3], ['M', 1e6], ['B', 1e9]] as const;
  let index = 0; while (index < units.length - 1 && value >= units[index + 1][1]) index++;
  const round = (scaled: number) => index === 0 ? Math.round(scaled) : scaled < 9.95 ? Math.round(scaled * 10) / 10 : Math.round(scaled);
  let shown = round(value / units[index][1]);
  // 999,950 reads 1M, not 1000k.
  if (shown >= 1000 && index < units.length - 1) { index++; shown = round(value / units[index][1]); }
  return `${shown}${units[index][0]}`;
}

const exact = (value: number) => value.toLocaleString('en-US');

/** Exact counts for a tooltip: input with its cached share, output with its reasoning share. */
export function tokenBreakdown(tokens: TokenUsage): string {
  const cache = [tokens.cacheReadTokens && `cache read ${exact(tokens.cacheReadTokens)}`, tokens.cacheWriteTokens && `cache write ${exact(tokens.cacheWriteTokens)}`].filter(Boolean).join(' · ');
  const reasoning = tokens.reasoningTokens ? ` (reasoning ${exact(tokens.reasoningTokens)})` : '';
  return `${exact(tokens.totalTokens)} tokens · Input ${exact(tokens.inputTokens)}${cache ? ` (${cache})` : ''} · Output ${exact(tokens.outputTokens)}${reasoning}`;
}

/** One compact line: "1.2M input · 980k cached · 40k output · 3k reasoning". */
export function tokenLine(tokens: TokenUsage): string {
  const cached = tokens.cacheReadTokens + tokens.cacheWriteTokens;
  return [`${compactTokens(tokens.inputTokens)} input`, cached && `${compactTokens(cached)} cached`, `${compactTokens(tokens.outputTokens)} output`, tokens.reasoningTokens && `${compactTokens(tokens.reasoningTokens)} reasoning`].filter(Boolean).join(' · ');
}
