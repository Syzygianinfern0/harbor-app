import type { Session } from './types';

export const activityLabel = {
  starting: 'Starting', working: 'Working', attention: 'Needs input or approval',
  background: 'Waiting on background work',
  completed: 'Turn finished — waiting for next prompt', idle: 'Ready',
  error: 'Agent error', closed: 'Closed', unknown: 'Status unavailable', external: 'Running elsewhere'
};
export type ChatStatus = keyof typeof activityLabel;
export function chatActivity(session: Session): ChatStatus {
  if (session.status === 'closed') return session.externalActive ? 'external' : 'closed';
  if (['checking', 'unreachable', 'missing'].includes(session.status)) return 'unknown';
  if (session.status === 'exited') return 'closed';
  if (session.activity === 'idle' && session.completedAt) return 'completed';
  return session.activity || 'unknown';
}

/** True when a bridge reason says the chat waits only on artifact live-update watchers. Claude flags those ambient, not activity, so
 * the turn is finished; bridges older than the watcher filter still recorded them as background work. */
export function onlyArtifactWatches(reason?: string) {
  const match=/^(\d+) background tasks? running: (.*)$/s.exec(reason||''); if(!match) return false;
  const names=match[2].split('; ');
  return names.length===Number(match[1]) && names.every(name=>name.startsWith('live updates for artifact '));
}
