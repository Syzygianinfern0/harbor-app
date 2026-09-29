import { GitFork } from 'lucide-react';
import type { Session } from '../shared/types';
import { forkBlocker } from '../shared/fork';

// Blocked forks stay hoverable (aria-disabled, not disabled) so the reason shows as a tooltip, and a click explains it.
export function ForkChatItem({ session, busy, onFork }: { session: Session; busy: boolean; onFork: (session: Session) => void }) {
  if (session.launcher !== 'codex' && session.launcher !== 'claude') return null;
  const blocked = forkBlocker(session);
  return <button role="menuitem" className="fork-chat" aria-disabled={busy || !!blocked} disabled={busy} title={blocked ?? 'Start a new chat from this conversation. The original stays as it is.'} onClick={() => onFork(session)}><GitFork size={14}/>Fork chat</button>;
}
