import type { ChatView, Preferences, Session } from './types';

export type { ChatView };
export const NO_VIEW: ChatView = { focused: null, visible: [] };
export function validView(value: unknown): ChatView {
  const v = value as ChatView;
  if (!v || typeof v !== 'object' || !(v.focused === null || typeof v.focused === 'string') || !Array.isArray(v.visible) || v.visible.length > 64 || !v.visible.every(id => typeof id === 'string')) throw new Error('Invalid chat view.');
  return { focused: v.focused, visible: [...v.visible] };
}
/** The unread marker is the in-app notification: the same events as desktop notifications (input, approval, error; finished turns when
 * "Notify when an agent finishes working" is on), but it does not depend on desktop notifications being enabled, and skips chats the user is looking at. */
export function shouldMarkUnread(id: string, completed: boolean, settings: Preferences['notifications'], windowFocused: boolean, view: ChatView) {
  if (completed && !settings.onComplete) return false;
  return !(windowFocused && view.visible.includes(id));
}
/** The chat that counts as read: the focused pane's, and only while Harbor's window has focus. */
export const viewedChat = (windowFocused: boolean, view: ChatView) => windowFocused ? view.focused : null;
export const isUnread = (session: Pick<Session, 'unread' | 'archived'>) => !!session.unread && !session.archived;
export const unreadCount = (sessions: Pick<Session, 'unread' | 'archived'>[]) => sessions.filter(isUnread).length;
export const dockBadge = (count: number) => count > 99 ? '99+' : count > 0 ? String(count) : '';
