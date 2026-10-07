import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { StickyNote } from 'lucide-react';
import type { Project, Session } from '../shared/types';
import { NoteMarkdown, taskCounts } from './NoteMarkdown';

export const NOTE_LIMIT = 20000;
export type NoteKind = 'chat' | 'project';
export type NoteAnchor = { kind: NoteKind; id: string; x: number; y: number };
export type Noted = Pick<Session | Project, 'id' | 'name' | 'note'>;
type Mode = 'edit' | 'view';
const MODE_KEY='harbor.noteMode';
const savedMode=():Mode=>{try{return localStorage.getItem(MODE_KEY)==='view'?'view':'edit';}catch{return 'edit';}};
export const saveNote=(kind:NoteKind,id:string,note:string)=>kind==='project'?window.harbor.updateProject(id,{note}):window.harbor.update(id,{note});
const clamp=(value:number,low:number,high:number)=>Math.max(low,Math.min(value,high));

/** Keeps a fixed-position box inside the viewport as it grows, is resized, or the window shrinks. */
function useInViewport(box:RefObject<HTMLElement|null>,x:number,y:number) {
  const [at,setAt]=useState({left:x,top:y});
  useLayoutEffect(()=>{
    const el=box.current;if(!el)return;
    const fit=()=>{const r=el.getBoundingClientRect();setAt(v=>{const next={left:clamp(x,8,innerWidth-r.width-8),top:clamp(y,8,innerHeight-r.height-8)};return v.left===next.left&&v.top===next.top?v:next;});};
    fit();const observer=new ResizeObserver(fit);observer.observe(el);addEventListener('resize',fit);
    return()=>{observer.disconnect();removeEventListener('resize',fit);};
  },[box,x,y]);
  return at;
}

function NotePeek({note,x,y}:{note?:string;x:number;y:number}) {
  const box=useRef<HTMLDivElement>(null),body=useRef<HTMLDivElement>(null);const [clipped,setClipped]=useState(false);
  const at=useInViewport(box,x,y-7);
  useLayoutEffect(()=>{const el=body.current;if(el)setClipped(el.scrollHeight>el.clientHeight+1);},[note]);
  const [done,total]=note?taskCounts(note):[0,0];
  return createPortal(<div ref={box} className={`chat-note-peek ${note?'':'hint'} ${clipped?'clipped':''}`} role="tooltip" style={at}>
    {note?<><div ref={body} className="chat-note-peek-body"><NoteMarkdown text={note}/></div>
      {(clipped||total>0)&&<footer>{total>0&&<span className="chat-note-tasks">{done} of {total} done</span>}{clipped&&<span className="chat-note-more">Continues · click to read it all</span>}</footer>}</>:'Add note'}
  </div>,document.body);
}

// Sits inside the chat row (itself a button) or project heading, so it is a pointer-only span; keyboard and assistive access go through the context menu.
export function ChatNoteMarker({item,kind='chat',onEdit}:{item:Noted;kind?:NoteKind;onEdit:(anchor:NoteAnchor)=>void}) {
  const ref=useRef<HTMLSpanElement>(null);const [peek,setPeek]=useState<{x:number;y:number}>();
  // Open beside the row so the popover never covers its pin or status icon.
  const place=()=>{const icon=ref.current!.getBoundingClientRect();const row=ref.current!.closest('.chat-row,.project-heading')?.getBoundingClientRect()??icon;return {x:row.right+8,y:icon.top};};
  const note=item.note;
  const edit=(event:MouseEvent)=>{event.preventDefault();event.stopPropagation();setPeek(undefined);const at=place();onEdit({kind,id:item.id,x:at.x,y:at.y-8});};
  return <span ref={ref} aria-hidden="true" title="" className={`chat-note ${note?'has-note':''}`} data-note={note?'saved':'empty'}
    onMouseEnter={()=>setPeek(place())} onMouseLeave={()=>setPeek(undefined)}
    onClick={edit}>
    <StickyNote size={11}/>
    {peek&&<NotePeek note={note} x={peek.x} y={peek.y}/>}
  </span>;
}

/** The note editor: a Markdown source view and a rendered view that works as a checklist (add, edit, tick, delete,
 *  reorder and prioritize items).
 *  Saving is explicit (⌘↩, Save) or by clicking away; Esc discards. `inline` sizes it for a page instead of a popover. */
export function NoteEditor({item,kind,onClose,inline=false,style}:{item:Noted;kind:NoteKind;onClose:()=>void;inline?:boolean;style?:CSSProperties}) {
  const [text,setText]=useState(item.note??'');const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [mode,setModeState]=useState<Mode>(savedMode);
  const box=useRef<HTMLDivElement>(null);const field=useRef<HTMLTextAreaElement>(null);const userHeight=useRef(0);const setHeight=useRef(0);
  const latest=useRef({text,busy});latest.current={text,busy};
  const setMode=(next:Mode)=>{setModeState(next);try{localStorage.setItem(MODE_KEY,next);}catch{/* per-viewer convenience only */}};
  const save=async(value:string)=>{
    if(value.trim()===(item.note??'')){onClose();return;}
    setBusy(true);setError('');
    try{await saveNote(kind,item.id,value);onClose();}catch(err){setError((err as Error).message.replace(/^Error invoking remote method '[^']+': Error: /,''));setBusy(false);}
  };
  const saveRef=useRef(save);saveRef.current=save;
  useEffect(()=>{if(mode==='view'){box.current?.focus();return;}field.current?.focus();const end=field.current?.value.length??0;field.current?.setSelectionRange(end,end);},[mode]);
  useEffect(()=>{
    // Clicking away keeps what was written, like a sticky note.
    const away=(event:globalThis.MouseEvent)=>{if(!box.current?.contains(event.target as Node)&&!(event.target as Element).closest?.('.note-priority-menu')&&!latest.current.busy)void saveRef.current(latest.current.text);};
    document.addEventListener('mousedown',away);return()=>document.removeEventListener('mousedown',away);
  },[]);
  // The source grows with the note up to the space available; a height the user dragged it to is kept as a minimum.
  useLayoutEffect(()=>{
    const el=field.current;if(!el||mode!=='edit')return;
    const cap=inline?Math.max(240,innerHeight*.7):Math.max(160,innerHeight-150);
    el.style.height='auto';const next=Math.round(clamp(Math.max(el.scrollHeight+2,userHeight.current),160,cap));el.style.height=`${next}px`;setHeight.current=next;
  },[text,mode,inline]);
  const keys=(event:KeyboardEvent)=>{
    event.stopPropagation();
    if(event.key==='Escape'){event.preventDefault();onClose();}
    if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)){event.preventDefault();void save(text);}
    if(event.key.toLowerCase()==='e'&&(event.metaKey||event.ctrlKey)&&!event.shiftKey){event.preventDefault();setMode(mode==='edit'?'view':'edit');}
  };
  const over=text.length>NOTE_LIMIT;
  return <div ref={box} className={`chat-note-editor ${inline?'inline':'floating'}`} role="dialog" aria-label={`Note for ${item.name}`} tabIndex={-1} onKeyDown={keys} style={style}>
    <header>
      <div className="note-mode" role="radiogroup" aria-label="Note view">
        <button type="button" role="radio" aria-checked={mode==='edit'} onClick={()=>setMode('edit')}>Markdown</button>
        <button type="button" role="radio" aria-checked={mode==='view'} onClick={()=>setMode('view')}>Formatted</button>
      </div>
      <small className="note-mode-hint">⌘E switches</small>
    </header>
    {mode==='edit'
      ?<textarea ref={field} value={text} maxLength={NOTE_LIMIT} placeholder={'Write a note… Markdown works: # heading, **bold**, - [ ] to-do !p1'} aria-label="Note" disabled={busy} spellCheck
        onMouseUp={event=>{const h=event.currentTarget.offsetHeight;if(Math.abs(h-setHeight.current)>2)userHeight.current=h;}}
        onChange={e=>setText(e.target.value.replace(/\r\n?/g,'\n'))}/>
      :<div className="chat-note-rendered" aria-label="Formatted note">{!text.trim()&&<p className="chat-note-empty">Nothing yet. Add a to-do, or switch to Markdown to write.</p>}<NoteMarkdown text={text} onChange={setText}/></div>}
    {error&&<p role="alert" className="form-error">{error}</p>}
    <footer><small>⌘↩ to save{text.length>NOTE_LIMIT*.8&&<span className={over?'note-count over':'note-count'}> · {text.length.toLocaleString()}/{NOTE_LIMIT.toLocaleString()}</span>}</small>{item.note&&<button type="button" className="chat-note-remove" disabled={busy} onClick={()=>void save('')}>Remove</button>}<button type="button" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className="chat-note-save" disabled={busy||over} onClick={()=>void save(text)}>Save</button></footer>
  </div>;
}

export function ChatNoteEditor({item,anchor,onClose}:{item:Noted;anchor:NoteAnchor;onClose:()=>void}) {
  const holder=useRef<HTMLDivElement>(null);const at=useInViewport(holder,anchor.x,anchor.y);
  return createPortal(<div ref={holder} className="chat-note-popover" style={at}><NoteEditor item={item} kind={anchor.kind} onClose={onClose}/></div>,document.body);
}
