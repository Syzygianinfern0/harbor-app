import { Bell, Circle, CircleCheck, CircleHelp, ExternalLink, Hourglass, LoaderCircle, TriangleAlert } from 'lucide-react';
import type { Session } from '../shared/types';
import { activityLabel, chatActivity, tracksActivity, type ChatStatus } from '../shared/chatStatus';
import { isUnread, unreadCount } from '../shared/unread';

export function ChatStatusIcon({ session }: { session: Session }) {
  // Terminals carry no status: an empty slot keeps sidebar rows aligned.
  if (!tracksActivity(session)) return <span className="chat-activity no-status" aria-hidden="true"/>;
  const activity = chatActivity(session);
  const detail = activity === 'completed' ? 'The agent is idle after its last turn. Task success is not verified.' : session.activityDetail;
  return <>{isUnread(session)&&<UnreadDot sessions={[session]}/>}<StatusIcon activity={activity} detail={detail}/></>;
}

/** A calm dot for chats that raised a notification while off screen; a rollup when given several chats. Renders nothing when none are unread. */
export function UnreadDot({ sessions, rollup }: { sessions: Pick<Session, 'unread' | 'archived' | 'name'>[]; rollup?: boolean }) {
  const count = unreadCount(sessions); if (!count) return null;
  const label = rollup ? `${count} unread ${count === 1 ? 'chat' : 'chats'}` : 'Unread';
  return <span role="img" className={`unread-dot ${rollup ? 'rollup' : ''}`} aria-label={label} title={rollup ? `${label}: ${sessions.filter(isUnread).map(s => s.name).join(', ')}` : 'Unread: needed you while you were away'}/>;
}

export function StatusIcon({ activity, detail }: { activity: ChatStatus; detail?: string }) {
  // Closed chats draw no glyph; the empty, same-width slot keeps row contents aligned and still carries the label.
  const Icon = { starting: LoaderCircle, working: LoaderCircle, attention: Bell, background: Hourglass, completed: CircleCheck,
    idle: Circle, error: TriangleAlert, closed: null, unknown: CircleHelp, external: ExternalLink }[activity];
  const label = activityLabel[activity];
  return <span role="img" className={`chat-activity ${activity}`} aria-label={label} title={detail ? `${label}\n${detail}` : label}>
    {Icon&&<Icon size={14} aria-hidden="true" className={activity === 'working' || activity === 'starting' ? 'spin' : undefined}/>}
  </span>;
}
