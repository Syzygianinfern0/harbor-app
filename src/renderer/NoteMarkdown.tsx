import { Fragment, useEffect, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type RefObject } from 'react';
import { Check, ChevronRight, Flag, GripVertical, Plus, X } from 'lucide-react';
import { groupLists, inlineText, parseBlocks, parseInline, scanLines, type Block, type Inline, type List, type ListNode, type Priority } from '../shared/markdown';
import { addTask, deleteTask, editTask, indentTask, insertTask, moveTask, nudgeTask, outdentTask, setPriority, toggleTask, type Placed } from '../shared/todos';
import { useDropCue } from './useDropCue';
import { reducedMotion } from './useTabMotion';

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
  /** The item shown above (-1) or below (1) a line, skipping a collapsed Completed section. */
  neighbor:(line:number,direction:-1|1)=>number|undefined;
  completedOpen:boolean;setCompletedOpen:(open:boolean)=>void;
}
interface Cue {line:number;after:boolean;x:number;y:number;width:number}
const rowOf=(li:Element)=>li.querySelector<HTMLElement>(':scope>.note-item-row');
const isChecked=(li:Element)=>li.classList.contains('checked');
/** Drag to reorder, the way tabs drag: the browser's drag (its threshold, image and Escape), the source dims, one mint
 *  line marks where the item lands, and the rows slide into place. The whole list is the target: the row nearest the
 *  pointer decides the spot, so gaps between rows never drop the cue. Every cue comes from the same move the drop
 *  applies; a move that changes nothing shows nothing. */
function useItemDrag(root:RefObject<HTMLDivElement|null>,get:()=>string,onChange?:(text:string)=>void) {
  const {source,setSource,cue,show,leave}=useDropCue<number,Cue>();
  const resolve=(event:DragEvent,from:number):Cue|undefined=>{
    const el=root.current;if(!el)return;
    const rows=[...el.querySelectorAll<HTMLElement>('li.note-item[data-line]>.note-item-row')].map(row=>({row,r:row.getBoundingClientRect()})).filter(v=>v.r.height);
    if(!rows.length)return;
    const y=event.clientY,dist=(r:DOMRect)=>y<r.top?r.top-y:y>r.bottom?y-r.bottom:0;
    let {row,r}=rows.reduce((a,b)=>dist(b.r)<dist(a.r)?b:a);
    let li=row.parentElement!,after=y>r.top+r.height/2;
    // The lower half of a parent's row means "before its first sub-item", so the line sits right under that row.
    const child=after?li.querySelector<HTMLElement>(':scope>.note-list>li.note-item[data-line]'):null;
    if(child){li=child;row=rowOf(child)!;r=row.getBoundingClientRect();after=false;}
    const line=Number(li.dataset.line),src=el.querySelector(`li.note-item[data-line="${from}"]`);
    // A top-level item shows in the open list or under Completed by its own tick, so it can only land among its kind.
    const topLevel=!li.parentElement?.closest('li.note-item');
    if(!src||topLevel&&isChecked(src)!==isChecked(li)||!moveTask(get(),from,line,after))return;
    // Centre the line in the gap to the neighbouring row, starting at the target's checkbox like the list it joins.
    const box=el.getBoundingClientRect(),edge=after?li.getBoundingClientRect().bottom:r.top;
    const near=rows.map(v=>v.r).filter(v=>after?v.top>=edge-1:v.bottom<=edge+1).sort((a,b)=>after?a.top-b.top:b.bottom-a.bottom)[0];
    const gap=near&&Math.abs((after?near.top:near.bottom)-edge)<12?((after?near.top:near.bottom)+edge)/2:edge+(after?1:-1);
    const left=(row.querySelector('.note-check')??row).getBoundingClientRect().left-2;
    return {line,after,x:Math.round(left-box.left),y:Math.round(gap-box.top+el.scrollTop),width:Math.round(box.right-left-4)};
  };
  const has=(event:DragEvent)=>event.dataTransfer.types.includes(TYPE);
  return {
    source,cue,
    row:(line:number)=>onChange?{draggable:true,
      onDragStart:(event:DragEvent)=>{event.stopPropagation();event.dataTransfer.setData(TYPE,String(line));event.dataTransfer.effectAllowed='move';setSource(line);},
      onDragEnd:()=>setSource(undefined)}:{},
    list:onChange?{
      onDragOver:(event:DragEvent)=>{
        if(!has(event)||source===undefined)return;const hit=resolve(event,source);show(hit);
        if(hit){event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='move';}
      },
      onDragLeave:(event:DragEvent)=>leave(event,()=>true),
      // The line comes from the drag's own data: a real drop runs after the window-level listener that clears `source`.
      onDrop:(event:DragEvent)=>{
        if(!has(event))return;event.preventDefault();event.stopPropagation();
        const from=Number(event.dataTransfer.getData(TYPE)),hit=Number.isInteger(from)?resolve(event,from):undefined;
        const next=hit&&moveTask(get(),from,hit.line,hit.after);if(next)onChange(next);
      }}:{},
  };
}

// FLIP for note rows, timed like the tab strip's: rows that move slide from where they were painted. A row is known by
// its text (and which copy of that text it is), since its line number changes when it moves.
const EASE='cubic-bezier(.2,0,0,1)',MOVE=170;
const rowKeys=(el:HTMLElement)=>{const seen=new Map<string,number>();return [...el.querySelectorAll<HTMLElement>('li.note-item>.note-item-row')].map(row=>{
  const text=row.querySelector<HTMLTextAreaElement>('.note-item-input')?.value??row.querySelector('.note-item-text')?.textContent??'',n=seen.get(text)??0;seen.set(text,n+1);
  return [`${text}\u0000${n}`,row] as const;});};
function useRowMotion(root:RefObject<HTMLDivElement|null>,text:string) {
  const shown=useRef(text),before=useRef<Map<string,DOMRect>|null>(null),running=useRef<Animation[]>([]);
  // Measure the painted rows during the render that brings new text, before React commits it.
  if(shown.current!==text&&!before.current&&root.current&&!reducedMotion())before.current=new Map(rowKeys(root.current).map(([k,row])=>[k,row.getBoundingClientRect()]));
  shown.current=text;
  useLayoutEffect(()=>{
    const el=root.current,prev=before.current;before.current=null;if(!el||!prev)return;
    running.current.forEach(a=>a.cancel());running.current=[];
    for(const [key,row] of rowKeys(el)){
      const old=prev.get(key);if(!old)continue;const now=row.getBoundingClientRect(),dx=old.left-now.left,dy=old.top-now.top;
      if(Math.abs(dx)>.5||Math.abs(dy)>.5)running.current.push(row.animate([{transform:`translate(${dx}px,${dy}px)`},{transform:'none'}],{duration:MOVE,easing:EASE}));
    }
  },[text]);
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
 *  Backspace on an empty item deletes it, ↑/↓ at either end move between items, ⌥↑/⌥↓ move the item, Tab/⇧Tab nest
 *  and un-nest it, Esc finishes. */
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
      handled();const prev=ctx.neighbor(line,-1);
      ctx.change(deleteTask(ctx.get(),line));if(prev===undefined)ctx.stopEditing(line);else ctx.edit(prev,'end');return;
    }
    if((event.key==='ArrowUp'||event.key==='ArrowDown')&&event.altKey&&!event.metaKey&&!event.ctrlKey){event.preventDefault();event.stopPropagation();const placed=nudgeTask(ctx.get(),line,event.key==='ArrowUp'?-1:1);if(placed){handedOff.current=true;go(placed,start);}return;}
    if(event.key==='Tab'&&!event.metaKey&&!event.ctrlKey&&!event.altKey){
      // Tab stays in the list: nest under the item above, or (⇧) lift out of the parent; at either limit nothing moves.
      event.preventDefault();event.stopPropagation();const placed=(event.shiftKey?outdentTask:indentTask)(ctx.get(),line);
      if(placed){handedOff.current=true;go(placed,start);}return;
    }
    if(event.key==='ArrowUp'&&plain&&start===0&&end===0){const prev=ctx.neighbor(line,-1);if(prev!==undefined){handled();ctx.edit(prev,'end');}return;}
    if(event.key==='ArrowDown'&&plain&&start===draft.length&&end===draft.length){const next=ctx.neighbor(line,1);if(next!==undefined){handled();ctx.edit(next,0);}return;}
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
  return <li className={`note-item ${item.task?'task':''} ${item.checked?'checked':''} p${item.priority} ${drag.source===item.line?'drag-source':''} ${editing?'editing':''}`} data-line={item.line}>
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
  if(!ctx.change||!block.items.some(i=>i.task))return <ListView list={block} ctx={ctx}/>;
  // Like Keep: open items, an "Add item" row, then ticked items under a Completed toggle.
  const open=block.items.filter(i=>!i.checked),done=block.items.filter(i=>i.checked);
  return <>
    {open.length>0&&<ListView list={{...block,items:open,start:open[0].num}} ctx={ctx}/>}
    <AddItem ctx={ctx} line={block.items[0].line}/>
    {done.length>0&&<div className="note-completed">
      <button type="button" className="note-completed-toggle" aria-expanded={ctx.completedOpen} onClick={()=>ctx.setCompletedOpen(!ctx.completedOpen)}><ChevronRight size={12}/>Completed ({done.length})</button>
      {ctx.completedOpen&&<ListView list={{...block,items:done,start:done[0].num}} ctx={ctx}/>}
    </div>}
  </>;
}

// Which notes have their Completed section folded: a per-viewer convenience, never part of the note.
const FOLDED_KEY='harbor.noteCompletedFolded';
const readFolded=():string[]=>{try{const v=JSON.parse(localStorage.getItem(FOLDED_KEY)??'[]');return Array.isArray(v)?v.filter(x=>typeof x==='string'):[];}catch{return [];}};
function useCompletedOpen(id?:string):[boolean,(open:boolean)=>void] {
  const [open,setOpen]=useState(()=>!id||!readFolded().includes(id));
  useEffect(()=>setOpen(!id||!readFolded().includes(id)),[id]);
  return [open,(next:boolean)=>{setOpen(next);if(!id)return;try{const rest=readFolded().filter(x=>x!==id);localStorage.setItem(FOLDED_KEY,JSON.stringify(next?rest:[...rest,id].slice(-500)));}catch{/* per-viewer convenience only */}}];
}

/** Moves focus to an item's text once the note has re-rendered with it. */
function useFocusItem(root:RefObject<HTMLDivElement|null>,text:string) {
  const [line,setLine]=useState<number>();
  useEffect(()=>{if(line===undefined)return;setLine(undefined);(root.current?.querySelector<HTMLElement>(`li[data-line="${line}"]>.note-item-row>.note-item-text`)??root.current)?.focus();},[line,text,root]);
  return setLine;
}

/** A note rendered from Markdown. With `onChange` it is a working checklist: tick, add, edit in place, delete, drag or
 *  ⌥↑/⌥↓ to reorder, Tab/⇧Tab to nest, and set priorities; each edit hands back the new Markdown text, leaving other
 *  lines untouched. `id` names the note for remembering whether its Completed section is folded. */
export function NoteMarkdown({text,onChange,className='',id}:{text:string;onChange?:(text:string)=>void;className?:string;id?:string}) {
  const [completedOpen,setCompletedOpen]=useCompletedOpen(id);
  const latest=useRef(text);latest.current=text;
  const root=useRef<HTMLDivElement>(null);const [editing,setEditing]=useState<{line:number;caret:Caret}>();const focusItem=useFocusItem(root,text);
  const drag=useItemDrag(root,()=>latest.current,onChange);useRowMotion(root,text);
  const change=onChange&&((next:string)=>{if(next===latest.current)return;latest.current=next;onChange(next);});
  const ctx:Ctx={get:()=>latest.current,change,drag,editing,
    edit:(line,caret='end')=>setEditing({line,caret}),
    stopEditing:line=>setEditing(v=>v?.line===line?undefined:v),
    focusItem:line=>{setEditing(undefined);focusItem(line);},
    neighbor:(line,direction)=>{const shown=[...root.current?.querySelectorAll<HTMLElement>('li.note-item[data-line]')??[]].map(el=>Number(el.dataset.line)),k=shown.indexOf(line);return k<0?undefined:shown[k+direction];},
    completedOpen,setCompletedOpen};
  // An edit can remount the focused row (ticking moves it into Completed); keep focus in the note so its shortcuts
  // (⌘↩, Esc) still work. Removal fires no blur, so `inside` still holds when that happens.
  const inside=useRef(false);
  useEffect(()=>{if(inside.current&&(document.activeElement===document.body||!document.activeElement))root.current?.focus();},[text]);
  const blocks=parseBlocks(text);
  return <div ref={root} tabIndex={onChange?-1:undefined} className={`note-markdown ${onChange?'interactive':''} ${className}`}
    onFocus={()=>{inside.current=true;}} onBlur={event=>{if(!root.current?.contains(event.relatedTarget as Node|null))inside.current=false;}} {...drag.list}>
    {blocks.map((block,i)=><BlockView key={i} block={block} ctx={ctx}/>)}
    {drag.cue&&<span className="note-drop-caret" style={{left:drag.cue.x,top:drag.cue.y,width:drag.cue.width}} aria-hidden="true"/>}
    {change&&!blocks.some(b=>b.t==='list'&&b.items.some(i=>i.task))&&<AddItem ctx={ctx} label="Add a to-do"/>}
  </div>;
}
