import { Bell, Circle, CircleCheck, CircleHelp, CircleSlash, ExternalLink, Hourglass, LoaderCircle, TriangleAlert } from 'lucide-react';
import type { Session } from '../shared/types';
import { activityLabel, chatActivity, type ChatStatus } from '../shared/chatStatus';

export function ChatStatusIcon({ session }: { session: Session }) {
  const activity = chatActivity(session);
  const detail = activity === 'completed' ? 'The agent is idle after its last turn. Task success is not verified.' : session.activityDetail;
  return <StatusIcon activity={activity} detail={detail}/>;
}

export function StatusIcon({ activity, detail }: { activity: ChatStatus; detail?: string }) {
  const Icon = { starting: LoaderCircle, working: LoaderCircle, attention: Bell, background: Hourglass, completed: CircleCheck,
    idle: Circle, error: TriangleAlert, closed: CircleSlash, unknown: CircleHelp, external: ExternalLink }[activity];
  const label = activityLabel[activity];
  return <span role="img" className={`chat-activity ${activity}`} aria-label={label} title={detail ? `${label}\n${detail}` : label}>
    <Icon size={14} aria-hidden="true" className={activity === 'working' || activity === 'starting' ? 'spin' : undefined}/>
  </span>;
}
