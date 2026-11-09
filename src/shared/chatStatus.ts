import type { Session } from './types';
import { isUnread } from './unread';

export const activityLabel = {
  starting: 'Starting', working: 'Working', attention: 'Needs input or approval',
  background: 'Waiting on background work',
  completed: 'Turn finished — waiting for next prompt', idle: 'Ready',
  error: 'Agent error', closed: 'Closed', unknown: 'Status unavailable', external: 'Running elsewhere'
};
export type ChatStatus = keyof typeof activityLabel;
/** Only Codex and Claude chats have an agent Harbor can read status from. Terminals (and custom commands) show no status icon,
 * unread marker or notification: their activity is never tracked, so any status shown would be a stale or "unknown" guess. */
export const tracksActivity = (session: Pick<Session, 'launcher'>) => session.launcher === 'codex' || session.launcher === 'claude';
export function chatActivity(session: Session): ChatStatus {
  if (session.status === 'closed') return session.externalActive ? 'external' : 'closed';
  if (['checking', 'unreachable', 'missing'].includes(session.status)) return 'unknown';
  if (session.status === 'exited') return 'closed';
  if (session.activity === 'idle' && session.completedAt) return 'completed';
  return session.activity || 'unknown';
}

/** A chat's status for folded-group rollups (see ROLLUP_ORDER in shared/tabGroups.ts): like chatActivity, but a finished turn the user
 * hasn't seen yet (still marked unread) is 'completed-unread', so it outranks chats that are working now while seen ones rank last. */
export type RollupStatus = ChatStatus | 'completed-unread';
export function rollupStatus(session: Session): RollupStatus {
  const activity = chatActivity(session);
  return activity === 'completed' && isUnread(session) ? 'completed-unread' : activity;
}
/** The icon a rollup status is drawn with: an unseen finished turn uses the normal finished icon (the unread dot sits beside it). */
export const rollupIcon = (status: string): ChatStatus => (status === 'completed-unread' ? 'completed' : status) as ChatStatus;
export const rollupLabel = (status: string) => status === 'completed-unread' ? 'Turn finished while you were away' : activityLabel[rollupIcon(status)];

/** True when a bridge reason says the chat waits only on artifact live-update watchers. Claude flags those ambient, not activity, so
 * the turn is finished; bridges older than the watcher filter still recorded them as background work. */
export function onlyArtifactWatches(reason?: string) {
  const match=/^(\d+) background tasks? running: (.*)$/s.exec(reason||''); if(!match) return false;
  const names=match[2].split('; ');
  return names.length===Number(match[1]) && names.every(name=>name.startsWith('live updates for artifact '));
}
