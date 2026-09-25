import { useLayoutEffect, useRef, type RefObject } from 'react';

// FLIP for the tab strip: items that stay slide from where they were painted,
// new ones fade/scale in, and removed ones leave a fading ghost. Short and
// decelerating so a click still feels immediate.
const EASE='cubic-bezier(.2,0,0,1)',MOVE=170,ENTER=150,EXIT=120;
const ITEMS='[data-tab-id],[data-group-key],.tab-add';
type Snapshot=Map<string,{el:HTMLElement;rect:DOMRect}>;
const keyOf=(el:HTMLElement)=>el.dataset.tabId?`t:${el.dataset.tabId}`:el.dataset.groupKey?`g:${el.dataset.groupKey}`:'add';
const snapshot=(root:HTMLElement):Snapshot=>new Map(Array.from(root.querySelectorAll<HTMLElement>(ITEMS),el=>[keyOf(el),{el,rect:el.getBoundingClientRect()}]));
export const reducedMotion=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;

export function useTabMotion(strip:RefObject<HTMLElement|null>) {
  const before=useRef<Snapshot|null>(null);
  const running=useRef<{snap:Snapshot;animations:Animation[];ghosts:HTMLElement[]}|null>(null);
  // Measure the painted DOM during render (before React commits). Fit/measure
  // passes re-render before the next frame; they all compare against this one.
  if(!before.current&&strip.current&&!reducedMotion()){
    before.current=snapshot(strip.current);requestAnimationFrame(()=>{before.current=null;});
  }
  useLayoutEffect(()=>{
    const root=strip.current,prev=before.current;if(!root||!prev)return;
    const last=running.current;
    // Stop in-flight motion so we measure true layout; the snapshot already holds where it was on screen.
    last?.animations.forEach(a=>a.cancel());
    if(last?.snap===prev)last.ghosts.forEach(g=>g.remove());
    const animations:Animation[]=[],ghosts:HTMLElement[]=[];
    const next=snapshot(root);
    for(const [key,{el,rect}] of next){
      const old=prev.get(key);
      if(!old){animations.push(el.animate([{opacity:0,transform:'scale(.92)'},{opacity:1,transform:'none'}],{duration:ENTER,easing:EASE}));continue;}
      const dx=old.rect.left-rect.left,dy=old.rect.top-rect.top;
      if(Math.abs(dx)>.5||Math.abs(dy)>.5)animations.push(el.animate([{transform:`translate(${dx}px,${dy}px)`},{transform:'none'}],{duration:MOVE,easing:EASE}));
    }
    const host=root.offsetParent as HTMLElement|null;
    if(host){
      const origin=host.getBoundingClientRect();
      for(const [key,{el,rect}] of prev){
        if(next.has(key)||!rect.width)continue;
        const ghost=el.cloneNode(true) as HTMLElement;
        ghost.removeAttribute('data-tab-id');ghost.removeAttribute('data-group-key');ghost.removeAttribute('data-attention');
        ghost.setAttribute('aria-hidden','true');ghost.inert=true;
        // Selection moves at once; only the shape fades.
        ghost.classList.remove('active','multi-selected','dragging','drag-source','drop-into');ghost.querySelectorAll('.tab-flare').forEach(f=>f.remove());ghost.classList.add('motion-ghost');
        Object.assign(ghost.style,{position:'absolute',left:`${rect.left-origin.left}px`,top:`${rect.top-origin.top}px`,width:`${rect.width}px`,height:`${rect.height}px`,margin:'0',pointerEvents:'none'});
        root.appendChild(ghost);ghosts.push(ghost);
        const exit=ghost.animate([{opacity:1,transform:'none'},{opacity:0,transform:'scale(.92)'}],{duration:EXIT,easing:EASE,fill:'forwards'});
        exit.onfinish=()=>ghost.remove();exit.oncancel=()=>ghost.remove();
      }
    }
    running.current={snap:prev,animations,ghosts};
  });
}
