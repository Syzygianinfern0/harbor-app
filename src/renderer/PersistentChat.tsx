import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { reducedMotion } from './useTabMotion';

// A stable portal keeps xterm's buffer, connection and viewport alive when a
// tab is hidden or its pane moves elsewhere in the split tree.
export function PersistentChat({ id, placement, onFocus, children }: { id: string; placement: unknown; onFocus: () => void; children: ReactNode }) {
  const scrollPositions = useRef(new Map<Element, {top:number; left:number}>());
  const shownIn = useRef<HTMLElement | null>(null);
  const [surface] = useState(() => {
    const node = document.createElement('div');
    node.className = 'chat-surface';
    return node;
  });
  useLayoutEffect(() => {
    // Portals follow their React parent for synthetic events, so focus needs a
    // native listener on the preserved surface rather than the layout slot.
    surface.addEventListener('pointerdown', onFocus);
    surface.addEventListener('focusin', onFocus);
    return () => { surface.removeEventListener('pointerdown', onFocus); surface.removeEventListener('focusin', onFocus); };
  }, [surface, onFocus]);
  useLayoutEffect(() => {
    const remember = (event: Event) => {
      const node = event.target as Element;
      if (node.isConnected) scrollPositions.current.set(node, {top:node.scrollTop, left:node.scrollLeft});
    };
    surface.addEventListener('scroll', remember, true);
    return () => surface.removeEventListener('scroll', remember, true);
  }, [surface]);
  useLayoutEffect(() => {
    const slot = Array.from(document.querySelectorAll<HTMLElement>('[data-chat-slot]')).find(node => node.dataset.chatSlot === id);
    if (slot) {
      slot.appendChild(surface);
      // Fade in when the chat arrives in a pane, not when the layout merely re-renders around it.
      if (slot !== shownIn.current && !reducedMotion()) surface.animate([{opacity: .35}, {opacity: 1}], {duration: 140, easing: 'cubic-bezier(.2,0,0,1)'});
      for (const [node, position] of scrollPositions.current) {
        if (surface.contains(node)) { node.scrollTop = position.top; node.scrollLeft = position.left; }
        else scrollPositions.current.delete(node);
      }
    }
    shownIn.current = slot ?? null;
    return () => {
      // Capture synchronously too: a tab shortcut can arrive before the browser
      // dispatches its pending scroll event.
      if (surface.isConnected) for (const node of surface.querySelectorAll('.closed-chat-panel, .disconnected-preview, .xterm-viewport')) {
        scrollPositions.current.set(node, {top:node.scrollTop, left:node.scrollLeft});
      }
      surface.remove();
    };
  }, [id, placement, surface]);
  return createPortal(children, surface);
}
