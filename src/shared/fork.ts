import type { Session } from './types';
import { dropPane, paneIds, type PaneNode } from './panes';

// Forking starts a new agent conversation from a saved one (Claude `--resume <id> --fork-session`, `codex fork <id>`).
// Only a conversation the agent has written to disk can be forked; the reason is shown on the disabled menu item and as the engine's error.
export function forkBlocker(s: Pick<Session, 'launcher' | 'conversationId' | 'resumable' | 'hasMessages' | 'status' | 'activity'>): string | undefined {
  if (s.launcher !== 'codex' && s.launcher !== 'claude') return 'Only Codex and Claude Code chats can be forked.';
  const starting = s.status !== 'closed' && s.activity === 'starting';
  if (!s.conversationId || s.resumable === false || s.hasMessages === false) return starting ? 'This chat is still starting. Fork it once it is ready.' : 'This chat has no saved conversation yet. Send a message, then fork it.';
  if (!/^[a-f0-9-]{36}$/i.test(s.conversationId)) return 'This chat’s conversation ID is invalid, so it cannot be forked.';
}
export const forkName = (name: string) => `${name.slice(0, 93).trim()} (fork)`;
/** The fork's tab goes right after the original's (or at the end), and it splits in beside the original when that is on screen. */
export function placeFork(tabs: string[], layout: PaneNode | null, original: string, fork: string) {
  const rest = tabs.filter(t => t !== fork); const at = rest.indexOf(original);
  rest.splice(at < 0 ? rest.length : at + 1, 0, fork);
  return { tabs: rest, layout: paneIds(layout).includes(original) ? dropPane(layout, original, fork, 'right') : undefined };
}
