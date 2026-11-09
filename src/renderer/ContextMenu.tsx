import { useRef, type HTMLAttributes } from 'react';
import { useFitInWindow } from './fitInWindow';

/** A right-click menu opened at the raw click point `x`,`y`; it moves itself to fit fully inside the window. */
export function ContextMenu({x,y,className,children,...rest}:{x:number;y:number}&HTMLAttributes<HTMLDivElement>) {
  const box=useRef<HTMLDivElement>(null);useFitInWindow(box,{left:x,top:y});
  return <div ref={box} className={`popover chat-context-menu${className?` ${className}`:''}`} role="menu" {...rest}>{children}</div>;
}
