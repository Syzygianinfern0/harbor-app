import { useLayoutEffect, useRef, type RefObject } from 'react';
import { EASE, MOVE, reducedMotion } from './useTabMotion';

/** FLIP for a vertical list, timed like the tab strip's: items that move slide from where they were painted. It measures
 *  only in the render that brings a new `signature` (the order, or whatever moves items), so other renders cost nothing.
 *  `items` names each item by a key that survives the move. Moves only: new items appear and removed ones go at once. */
export function useListMotion(root:RefObject<HTMLElement|null>,signature:string,items:(root:HTMLElement)=>Iterable<readonly [string,HTMLElement]>) {
  const shown=useRef(signature),before=useRef<Map<string,DOMRect>|null>(null),running=useRef<Animation[]>([]);
  // Measure the painted items during the render that brings the new signature, before React commits it.
  if(shown.current!==signature&&!before.current&&root.current&&!reducedMotion())before.current=new Map(Array.from(items(root.current),([k,el])=>[k,el.getBoundingClientRect()]));
  shown.current=signature;
  useLayoutEffect(()=>{
    const el=root.current,prev=before.current;before.current=null;if(!el||!prev)return;
    running.current.forEach(a=>a.cancel());running.current=[];
    for(const [key,item] of items(el)){
      const old=prev.get(key);if(!old)continue;const now=item.getBoundingClientRect(),dx=old.left-now.left,dy=old.top-now.top;
      if(Math.abs(dx)>.5||Math.abs(dy)>.5)running.current.push(item.animate([{transform:`translate(${dx}px,${dy}px)`},{transform:'none'}],{duration:MOVE,easing:EASE}));
    }
  },[signature]);
}
