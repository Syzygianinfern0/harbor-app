import { useLayoutEffect, type RefObject } from 'react';

/** Where a menu opens from: a point (a right-click) or a box (the button that opened it). It opens below the anchor,
 *  starting at its left edge (or ending at its right edge with `align:'end'`), flips to the other side when there is
 *  no room, and otherwise slides until it fits. */
export type Anchor={left:number;top:number;right?:number;bottom?:number;align?:'start'|'end'};

const MARGIN=8;

/** One axis: the box starts at `start` (opening forward) or ends at `end` (flipped back), whichever fits first in
 *  order of preference, else it slides along until it fits inside `[MARGIN, view-MARGIN]`. */
function place(start:number,end:number,size:number,view:number,preferEnd:boolean) {
  const fits=(at:number)=>at>=MARGIN&&at+size<=view-MARGIN;
  const [first,second]=preferEnd?[end-size,start]:[start,end-size];
  if(fits(first))return first;
  if(fits(second))return second;
  return Math.max(MARGIN,Math.min(first,view-MARGIN-size));
}

/** The box a menu of `width`×`height` gets in a `view` window, with a max height (so it scrolls) when it is taller
 *  than the window. */
export function fitInWindow(anchor:Anchor,width:number,height:number,view:{width:number;height:number}) {
  const right=anchor.right??anchor.left,bottom=anchor.bottom??anchor.top;
  const room=view.height-2*MARGIN,maxHeight=height>room?room:undefined;
  return {
    left:place(anchor.left,right,width,view.width,anchor.align==='end'),
    top:maxHeight===undefined?place(bottom,anchor.top,height,view.height,false):MARGIN,
    maxHeight,
  };
}

/** Positions a `position:fixed` menu fully inside the window. It is measured in a layout effect, before the first
 *  paint, so it never shows in the wrong place, and refitted whenever it or the window changes size. Call sites pass
 *  the raw click point or opener rect (`undefined` while closed) and leave `left`/`top` out of the element's style. */
export function useFitInWindow(box:RefObject<HTMLElement|null>,anchor:Anchor|undefined) {
  const open=!!anchor,{left=0,top=0,right,bottom,align}=anchor??{};
  useLayoutEffect(()=>{
    const el=box.current;if(!open||!el)return;
    const fit=()=>{
      // Measure at the window's corner, at natural size, so the right edge can't squeeze it narrower (and taller).
      el.style.left='0px';el.style.top='0px';el.style.maxHeight='';el.style.overflowY='';
      const r=el.getBoundingClientRect();
      const at=fitInWindow({left,top,right,bottom,align},r.width,r.height,{width:innerWidth,height:innerHeight});
      el.style.left=`${at.left}px`;el.style.top=`${at.top}px`;
      if(at.maxHeight!==undefined){el.style.maxHeight=`${at.maxHeight}px`;el.style.overflowY='auto';}
    };
    fit();const observer=new ResizeObserver(fit);observer.observe(el);addEventListener('resize',fit);
    return()=>{observer.disconnect();removeEventListener('resize',fit);};
  },[box,open,left,top,right,bottom,align]);
}
