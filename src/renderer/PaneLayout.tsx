import { useRef, type DragEvent, type ReactNode } from 'react';
import { X, GripVertical } from 'lucide-react';
import type { PaneNode, DropSide } from '../shared/panes';
import type { Session } from '../shared/types';
import { ResizeHandle } from './ResizeHandle';
export interface PaneLayoutProps {
 node:PaneNode;sessions:Session[];selected?:string;dragging?:string;multiple:boolean;
 onFocus:(id:string)=>void;onDrop:(target:string,id:string,side:DropSide)=>void;onResize:(id:string,ratio:number)=>void;onRemove:(id:string)=>void;
 onDragStart:(event:DragEvent,id:string)=>void;onDragEnd:()=>void;render:(session:Session)=>ReactNode;
}
export function PaneLayout(props:PaneLayoutProps) {
 const {node}=props;const container=useRef<HTMLDivElement>(null);
 if(node.kind==='split') {
  const resize=(delta:number)=>{const bounds=container.current?.getBoundingClientRect();if(bounds)props.onResize(node.id,node.ratio+delta/(node.axis==='horizontal'?bounds.width:bounds.height));};
  return <div ref={container} className={`pane-split ${node.axis}`} data-split-id={node.id} style={node.axis==='horizontal'?{gridTemplateColumns:`minmax(0,${node.ratio}fr) 5px minmax(0,${1-node.ratio}fr)`}:{gridTemplateRows:`minmax(0,${node.ratio}fr) 5px minmax(0,${1-node.ratio}fr)`}}>
   <PaneLayout {...props} node={node.first}/><ResizeHandle label={`Resize ${node.axis==='horizontal'?'columns':'rows'}`} axis={node.axis} value={node.ratio*100} onDrag={resize} onStep={delta=>props.onResize(node.id,node.ratio+delta*.03)} onReset={()=>props.onResize(node.id,.5)}/><PaneLayout {...props} node={node.second}/>
  </div>;
 }
 const session=props.sessions.find(s=>s.id===node.sessionId);if(!session)return null;
 return <div className={`workspace-pane ${props.selected===session.id?'focused':''}`} data-session-id={session.id} onPointerDown={()=>props.onFocus(session.id)} onFocusCapture={()=>props.onFocus(session.id)}>
  {props.multiple&&<div className="pane-heading" draggable onDragStart={e=>props.onDragStart(e,session.id)} onDragEnd={props.onDragEnd}><GripVertical size={12}/><span>{session.name}</span><button className="icon-button" aria-label={`Close pane ${session.name}`} title="Remove pane from layout; keep chat open" onClick={e=>{e.stopPropagation();props.onRemove(session.id);}}><X size={13}/></button></div>}
  {props.render(session)}
  {props.dragging&&props.dragging!==session.id&&<div className="pane-drop-targets">{(['left','right','top','bottom','center'] as const).map(side=><div key={side} className={`pane-drop-zone ${side}`} data-drop-side={side} onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect='move';e.currentTarget.classList.add('over');}} onDragLeave={e=>e.currentTarget.classList.remove('over')} onDrop={e=>{e.preventDefault();e.stopPropagation();const id=e.dataTransfer.getData('application/x-harbor-chat');if(id)props.onDrop(session.id,id,side);props.onDragEnd();}}>{side==='center'?'Move here':`Split ${side}`}</div>)}</div>}
 </div>;
}
