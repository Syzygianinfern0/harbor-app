import { Fragment, useEffect, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type RefObject } from 'react';
import { Check, Flag, GripVertical, Plus, X } from 'lucide-react';
import { groupLists, inlineText, parseBlocks, parseInline, scanLines, type Block, type Inline, type List, type ListNode, type Priority } from '../shared/markdown';
import { dropSide } from '../shared/dropCue';
import { addTask, deleteTask, editTask, insertTask, itemLines, moveTask, nudgeTask, setPriority, toggleTask, type Placed } from '../shared/todos';
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

type Caret=number|'end';
/** What every row needs. Handlers read the latest text through `get`, so a blur that edits the note and the click
 *  that caused it both see each other's change. */
interface Ctx {
  get:()=>string;change?:(text:string)=>void;drag:ReturnType<typeof useItemDrag>;
  editing?:{line:number;caret:Caret};edit:(line:number,caret?:Caret)=>void;stopEditing:(line:number)=>void;focusItem:(line:number)=>void;
}
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

/** The item's own text, edited in place like a Keep list item: Enter adds the next item (splitting at the cursor),
 *  Backspace on an empty item deletes it, ↑/↓ at either end move between items, ⌥↑/⌥↓ move the item, Esc finishes. */
function ItemEditor({item,ctx}:{item:ListNode;ctx:Ctx&{change:(text:string)=>void}}) {
  const field=useRef<HTMLTextAreaElement>(null);const [draft,setDraft]=useState(item.content);const {line}=item;
  // Set once a key hands the cursor elsewhere, so the blur that follows does not act on a line that has moved.
  const handedOff=useRef(false);
  const fit=()=>{const el=field.current;if(el){el.style.height='auto';el.style.height=`${el.scrollHeight}px`;}};
  useLayoutEffect(()=>{const el=field.current!;el.focus();const at=ctx.editing?.caret==='end'||ctx.editing?.caret===undefined?el.value.length:Math.min(ctx.editing.caret,el.value.length);el.setSelectionRange(at,at);fit();},[]);
  const go=(placed:Placed|undefined,caret:Caret)=>{if(!placed)return;ctx.change(placed.text);ctx.edit(placed.line,caret);};
  const keys=(event:KeyboardEvent<HTMLTextAreaElement>)=>{
    const el=event.currentTarget,start=el.selectionStart,end=el.selectionEnd,plain=!event.metaKey&&!event.ctrlKey&&!event.altKey&&!event.shiftKey;
    if(event.nativeEvent.isComposing)return;
    const handled=()=>{event.preventDefault();event.stopPropagation();handedOff.current=true;};
    if(event.key==='Escape'){handled();ctx.focusItem(line);return;}
    if(event.key==='Enter'&&plain){
      handled();
      // Enter on an empty item ends the list there, like Keep and most editors.
      if(!draft&&!item.children.length){ctx.change(deleteTask(ctx.get(),line));ctx.stopEditing(line);return;}
      go(insertTask(editTask(ctx.get(),line,draft.slice(0,start).trimEnd()),line,draft.slice(end).trimStart()),0);return;
    }
    if(event.key==='Backspace'&&plain&&!draft&&!item.children.length){
      handled();const prev=itemLines(ctx.get()).filter(l=>l<line).at(-1);
      ctx.change(deleteTask(ctx.get(),line));if(prev===undefined)ctx.stopEditing(line);else ctx.edit(prev,'end');return;
    }
    if((event.key==='ArrowUp'||event.key==='ArrowDown')&&event.altKey&&!event.metaKey&&!event.ctrlKey){event.preventDefault();event.stopPropagation();const placed=nudgeTask(ctx.get(),line,event.key==='ArrowUp'?-1:1);if(placed){handedOff.current=true;go(placed,start);}return;}
    if(event.key==='ArrowUp'&&plain&&start===0&&end===0){const prev=itemLines(ctx.get()).filter(l=>l<line).at(-1);if(prev!==undefined){handled();ctx.edit(prev,'end');}return;}
    if(event.key==='ArrowDown'&&plain&&start===draft.length&&end===draft.length){const next=itemLines(ctx.get()).find(l=>l>line);if(next!==undefined){handled();ctx.edit(next,0);}return;}
  };
  return <textarea ref={field} className="note-item-input" rows={1} value={draft} aria-label="Item text" spellCheck
    onChange={event=>{const value=event.target.value.replace(/\r\n?|\n/g,' ');setDraft(value);ctx.change(editTask(ctx.get(),line,value));fit();}}
    onKeyDown={keys}
    onBlur={()=>{
      // Leaving a just-added item empty drops it again, the way Todoist cancels an empty task.
      if(handedOff.current)return;
      const t=ctx.get(),now=scanLines(t)[line];
      if(!draft&&!item.children.length&&now?.kind==='item'&&!now.content)ctx.change(deleteTask(t,line));
      ctx.stopEditing(line);
    }}/>;
}

function ItemView({item,ctx}:{item:ListNode;ctx:Ctx}) {
  const {change,drag}=ctx;const label=inlineText(parseInline(item.content))||'Untitled item';const editing=!!change&&ctx.editing?.line===item.line;
  const rowKeys=(event:KeyboardEvent)=>{
    // ⌥↑/⌥↓ on a focused row (its checkbox or text) moves it; the editor handles its own keys first.
    if(!change||!event.altKey||event.metaKey||event.ctrlKey||(event.key!=='ArrowUp'&&event.key!=='ArrowDown'))return;
    const placed=nudgeTask(ctx.get(),item.line,event.key==='ArrowUp'?-1:1);event.preventDefault();event.stopPropagation();
    if(placed){change(placed.text);ctx.focusItem(placed.line);}
  };
  return <li className={`note-item ${item.task?'task':''} ${item.checked?'checked':''} p${item.priority} ${drag.className(item.line)} ${editing?'editing':''}`} data-line={item.line}>
    <div className="note-item-row" {...(editing?{}:drag.row(item.line))} onKeyDown={rowKeys}>
      {change&&<span className="note-grip" aria-hidden="true"><GripVertical size={11}/></span>}
      {item.task&&(change
        ?<button type="button" role="checkbox" aria-checked={item.checked} aria-label={label} className={`note-check p${item.priority}`} onClick={()=>change(toggleTask(ctx.get(),item.line))}><Check size={9} strokeWidth={3}/></button>
        :<span className={`note-check p${item.priority}`} role="checkbox" aria-checked={item.checked} aria-label={label}><Check size={9} strokeWidth={3}/></span>)}
      {editing
        ?<ItemEditor item={item} ctx={{...ctx,change:change!}}/>
        :<span className="note-item-text" {...(change?{tabIndex:0,title:'Click to edit',onClick:()=>ctx.edit(item.line,'end'),onKeyDown:(event:KeyboardEvent)=>{if(event.key==='Enter'&&!event.metaKey&&!event.ctrlKey){event.preventDefault();event.stopPropagation();ctx.edit(item.line,'end');}}}:{})}><Text text={item.content}/>{item.more.map((line,i)=><Fragment key={i}>{'\n'}<Text text={line}/></Fragment>)}</span>}
      {change&&item.task&&<PriorityMenu priority={item.priority} onPick={p=>change(setPriority(ctx.get(),item.line,p))}/>}
      {change&&<button type="button" className="note-delete" aria-label={`Delete ${label}`} title="Delete item" onMouseDown={event=>event.preventDefault()} onClick={()=>{ctx.stopEditing(item.line);change(deleteTask(ctx.get(),item.line));}}><X size={11}/></button>}
      {!change&&item.priority<4&&!item.task&&<Flag size={10} className={`note-flag p${item.priority}`} aria-label={PRIORITY_NAMES[item.priority]}/>}
    </div>
    {groupLists(item.children).map((list,i)=><ListView key={i} list={list} ctx={ctx}/>)}
  </li>;
}

function ListView({list,ctx}:{list:List;ctx:Ctx}) {
  const items=list.items.map(item=><ItemView key={item.line} item={item} ctx={ctx}/>);
  return list.ordered?<ol className="note-list" start={list.start}>{items}</ol>:<ul className="note-list">{items}</ul>;
}

function AddItem({ctx,line,label='Add item'}:{ctx:Ctx;line?:number;label?:string}) {
  return <button type="button" className="note-add" onClick={()=>{const placed=addTask(ctx.get(),line);ctx.change!(placed.text);ctx.edit(placed.line,'end');}}><Plus size={12}/>{label}</button>;
}

function BlockView({block,ctx}:{block:Block;ctx:Ctx}) {
  if(block.t==='heading'){const H=`h${block.level+2}` as 'h3'|'h4'|'h5';return <H className={`note-h${block.level}`}><Text text={block.text}/></H>;}
  if(block.t==='para')return <p>{block.lines.map((line,i)=><Fragment key={i}>{i>0&&'\n'}<Text text={line}/></Fragment>)}</p>;
  if(block.t==='code')return <pre><code>{block.v}</code></pre>;
  // A checklist ends with an "Add item" row, like Keep.
  return <><ListView list={block} ctx={ctx}/>{ctx.change&&block.items.some(i=>i.task)&&<AddItem ctx={ctx} line={block.items[0].line}/>}</>;
}

/** Moves focus to an item's text once the note has re-rendered with it. */
function useFocusItem(root:RefObject<HTMLDivElement|null>,text:string) {
  const [line,setLine]=useState<number>();
  useEffect(()=>{if(line===undefined)return;setLine(undefined);(root.current?.querySelector<HTMLElement>(`li[data-line="${line}"]>.note-item-row>.note-item-text`)??root.current)?.focus();},[line,text,root]);
  return setLine;
}

/** A note rendered from Markdown. With `onChange` it is a working checklist: tick, add, edit in place, delete, drag or
 *  ⌥↑/⌥↓ to reorder, and set priorities; each edit hands back the new Markdown text, leaving other lines untouched. */
export function NoteMarkdown({text,onChange,className=''}:{text:string;onChange?:(text:string)=>void;className?:string}) {
  const latest=useRef(text);latest.current=text;
  const root=useRef<HTMLDivElement>(null);const [editing,setEditing]=useState<{line:number;caret:Caret}>();const focusItem=useFocusItem(root,text);
  const drag=useItemDrag(text,onChange);
  const change=onChange&&((next:string)=>{if(next===latest.current)return;latest.current=next;onChange(next);});
  const ctx:Ctx={get:()=>latest.current,change,drag,editing,
    edit:(line,caret='end')=>setEditing({line,caret}),
    stopEditing:line=>setEditing(v=>v?.line===line?undefined:v),
    focusItem:line=>{setEditing(undefined);focusItem(line);}};
  const blocks=parseBlocks(text);
  return <div ref={root} tabIndex={onChange?-1:undefined} className={`note-markdown ${onChange?'interactive':''} ${className}`}>
    {blocks.map((block,i)=><BlockView key={i} block={block} ctx={ctx}/>)}
    {change&&!blocks.some(b=>b.t==='list'&&b.items.some(i=>i.task))&&<AddItem ctx={ctx} label="Add a to-do"/>}
  </div>;
}
