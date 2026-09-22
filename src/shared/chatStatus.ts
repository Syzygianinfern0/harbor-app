import type { Session } from './types';

export const activityLabel = {
  starting: 'Starting', working: 'Working', attention: 'Needs input or approval',
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
