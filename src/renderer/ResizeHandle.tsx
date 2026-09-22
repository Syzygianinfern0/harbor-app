import { useRef } from 'react';
export function ResizeHandle({axis,label,value,onDrag,onStep,onReset,className=''}:{axis:'horizontal'|'vertical';label:string;value:number;onDrag:(delta:number)=>void;onStep:(delta:number)=>void;onReset:()=>void;className?:string}) {
  const last=useRef<number|null>(null);
  return <div role="separator" tabIndex={0} aria-label={label} aria-orientation={axis==='horizontal'?'vertical':'horizontal'} aria-valuenow={Math.round(value)} className={`resize-handle ${axis} ${className}`} onDoubleClick={onReset}
    onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();last.current=axis==='horizontal'?event.clientX:event.clientY;event.currentTarget.setPointerCapture(event.pointerId);}}
    onPointerMove={event=>{if(last.current===null)return;const position=axis==='horizontal'?event.clientX:event.clientY;onDrag(position-last.current);last.current=position;}}
    onPointerUp={event=>{last.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}}
    onLostPointerCapture={()=>{last.current=null;}} onPointerCancel={()=>{last.current=null;}}
    onKeyDown={event=>{const negative=axis==='horizontal'?'ArrowLeft':'ArrowUp',positive=axis==='horizontal'?'ArrowRight':'ArrowDown';if(event.key===negative||event.key===positive){event.preventDefault();onStep(event.key===negative?-1:1);}if(event.key==='Home'){event.preventDefault();onReset();}}}/>
}
