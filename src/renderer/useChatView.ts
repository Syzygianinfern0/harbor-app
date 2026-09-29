import { useEffect } from 'react';

/** Tells the main process which chats are on screen, so it can skip or clear their unread markers (see shared/unread.ts). */
export function useChatView(focused: string | null, visible: string[]) {
  const key = JSON.stringify([focused, visible]);
  useEffect(() => { void window.harbor.setChatView({ focused, visible }).catch(() => {}); }, [key]);
}
