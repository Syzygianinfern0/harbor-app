import { Fragment, useEffect, useRef, useState, type DragEvent } from 'react';
import { Check, Flag, GripVertical } from 'lucide-react';
import { groupLists, inlineText, parseBlocks, parseInline, type Block, type Inline, type List, type ListNode, type Priority } from '../shared/markdown';
import { dropSide } from '../shared/dropCue';
import { moveTask, setPriority, toggleTask } from '../shared/todos';
import { useDropCue } from './useDropCue';

// Notes render from a parsed tree into React text nodes only; there is no HTML path, so nothing in a note can inject markup.
export const PRIORITY_NAMES:Record<Priority,string>={1:'Priority 1',2:'Priority 2',3:'Priority 3',4:'Priority 4'};
const TYPE='application/x-harbor-note-item';

export function Inlines({nodes}:{nodes:Inline[]}) {
  return <>{nodes.map((n,i)=>n.t==='text'?<Fragment key={i}>{n.v}</Fragment>:n.t==='code'?<code key={i}>{n.v}</code>:n.t==='strong'?<strong key={i}><Inlines nodes={n.c}/></strong>:<em key={i}><Inlines nodes={n.c}/></em>)}</>;
}
const Text=({text}:{text:string})=><Inlines nodes={parseInline(text)}/>;

/** Task counts for a note: [done, total]. */
export const taskCounts=(text:string):[number,number]=>{const tasks=text.split('\n').filter(l=>/^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[[ xX]\](?:[ \t]|$)/.test(l));return [tasks.filter(l=>/\[[xX]\]/.test(l)).length,tasks.length];};

interface Ctx {text:string;onChange?:(text:string)=>void;drag:ReturnType<typeof useItemDrag>}
function useItemDrag(text:string,onChange?:(text:string)=>void) {
  const {source,setSource,cue,show,leave}=useDropCue<number,{line:number;after:boolean}>();
  const side=(event:DragEvent)=>dropSide(event.currentTarget.getBoundingClientRect(),event.clientX,event.clientY,'y')==='after';
  return {
    className:(line:number)=>`${source===line?'drag-source':''} ${cue?.line===line?(cue.after?'drop-after':'drop-before'):''}`,
    row:(line:number)=>onChange?{draggable:true,
      onDragStart:(event:DragEvent)=>{event.stopPropagation();event.dataTransfer.setData(TYPE,String(line));event.dataTransfer.effectAllowed='move';setSource(line);},
      onDragEnd:()=>setSource(undefined),
      onDragOver:(event:DragEvent)=>{
        if(!event.dataTransfer.types.includes(TYPE))return;const after=side(event);
        if(source===undefined||!moveTask(text,source,line,after)){show(undefined);return;}
        event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='move';show({line,after});
      },
      onDragLeave:(event:DragEvent)=>leave(event,c=>c.line===line),
      onDrop:(event:DragEvent)=>{
        if(!event.dataTransfer.types.includes(TYPE)||source===undefined)return;event.preventDefault();
        const next=moveTask(text,source,line,side(event));if(next)onChange!(next);
      }}:{},
  };
}

function PriorityMenu({priority,onPick}:{priority:Priority;onPick:(p:Priority)=>void}) {
  const button=useRef<HTMLButtonElement>(null);const [at,setAt]=useState<{x:number;y:number}>();
  useEffect(()=>{if(!at)return;const close=(event:MouseEvent)=>{if(!(event.target as Element).closest?.('.note-priority-menu,.note-priority'))setAt(undefined);};document.addEventListener('mousedown',close,true);return()=>document.removeEventListener('mousedown',close,true);},[at]);
  const open=()=>{if(at){setAt(undefined);return;}const r=button.current!.getBoundingClientRect();setAt({x:Math.max(8,Math.min(r.right-150,innerWidth-158)),y:r.bottom+176>innerHeight?r.top-172:r.bottom+4});};
  return <>
    <button ref={button} type="button" className={`note-priority p${priority} ${at?'open':''}`} aria-label={`${PRIORITY_NAMES[priority]} · change priority`} title={PRIORITY_NAMES[priority]} aria-haspopup="menu" aria-expanded={!!at} onClick={open} onKeyDown={event=>{if(event.key==='Escape'&&at){event.stopPropagation();setAt(undefined);}}}><Flag size={11}/></button>
    {at&&<div className="note-priority-menu" role="menu" aria-label="Priority" style={{left:at.x,top:at.y}} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();setAt(undefined);button.current?.focus();}}}>
      {([1,2,3,4] as Priority[]).map(p=><button key={p} type="button" role="menuitemradio" aria-checked={p===priority} className={`p${p}`} onClick={()=>{setAt(undefined);onPick(p);}}><Flag size={12}/>{PRIORITY_NAMES[p]}{p===priority&&<Check size={12} className="note-priority-current"/>}</button>)}
    </div>}
  </>;
}

function ItemView({item,ctx}:{item:ListNode;ctx:Ctx}) {
  const {text,onChange,drag}=ctx;const label=inlineText(parseInline(item.content))||'Untitled item';
  return <li className={`note-item ${item.task?'task':''} ${item.checked?'checked':''} p${item.priority} ${drag.className(item.line)}`} data-line={item.line}>
    <div className="note-item-row" {...drag.row(item.line)}>
      {onChange&&<span className="note-grip" aria-hidden="true"><GripVertical size={11}/></span>}
      {item.task&&(onChange
        ?<button type="button" role="checkbox" aria-checked={item.checked} aria-label={label} className={`note-check p${item.priority}`} onClick={()=>onChange(toggleTask(text,item.line))}><Check size={9} strokeWidth={3}/></button>
        :<span className={`note-check p${item.priority}`} role="checkbox" aria-checked={item.checked} aria-label={label}><Check size={9} strokeWidth={3}/></span>)}
      <span className="note-item-text"><Text text={item.content}/>{item.more.map((line,i)=><Fragment key={i}>{'\n'}<Text text={line}/></Fragment>)}</span>
      {onChange&&item.task&&<PriorityMenu priority={item.priority} onPick={p=>onChange(setPriority(text,item.line,p))}/>}
      {!onChange&&item.priority<4&&!item.task&&<Flag size={10} className={`note-flag p${item.priority}`} aria-label={PRIORITY_NAMES[item.priority]}/>}
    </div>
    {groupLists(item.children).map((list,i)=><ListView key={i} list={list} ctx={ctx}/>)}
  </li>;
}

function ListView({list,ctx}:{list:List;ctx:Ctx}) {
  const items=list.items.map(item=><ItemView key={item.line} item={item} ctx={ctx}/>);
  return list.ordered?<ol className="note-list" start={list.start}>{items}</ol>:<ul className="note-list">{items}</ul>;
}

function BlockView({block,ctx}:{block:Block;ctx:Ctx}) {
  if(block.t==='heading'){const H=`h${block.level+2}` as 'h3'|'h4'|'h5';return <H className={`note-h${block.level}`}><Text text={block.text}/></H>;}
  if(block.t==='para')return <p>{block.lines.map((line,i)=><Fragment key={i}>{i>0&&'\n'}<Text text={line}/></Fragment>)}</p>;
  if(block.t==='code')return <pre><code>{block.v}</code></pre>;
  return <ListView list={block} ctx={ctx}/>;
}

/** A note rendered from Markdown. With `onChange`, tasks can be checked, reordered by dragging and given a priority;
 *  each edit hands back the new Markdown text. */
export function NoteMarkdown({text,onChange,className=''}:{text:string;onChange?:(text:string)=>void;className?:string}) {
  const drag=useItemDrag(text,onChange);const ctx={text,onChange,drag};
  return <div className={`note-markdown ${onChange?'interactive':''} ${className}`}>{parseBlocks(text).map((block,i)=><BlockView key={i} block={block} ctx={ctx}/>)}</div>;
}
