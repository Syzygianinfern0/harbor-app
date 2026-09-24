import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { StickyNote } from 'lucide-react';
import type { Project, Session } from '../shared/types';

export const NOTE_LIMIT = 4000;
export type NoteKind = 'chat' | 'project';
export type NoteAnchor = { kind: NoteKind; id: string; x: number; y: number };
type Noted = Pick<Session | Project, 'id' | 'name' | 'note'>;

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
    {peek&&createPortal(<div className={`chat-note-peek ${note?'':'hint'}`} role="tooltip" style={{left:Math.min(peek.x,innerWidth-296),top:Math.max(8,Math.min(peek.y-7,innerHeight-120))}}>{note||'Add note'}</div>,document.body)}
  </span>;
}

export function ChatNoteEditor({item,anchor,onClose}:{item:Noted;anchor:NoteAnchor;onClose:()=>void}) {
  const [text,setText]=useState(item.note??'');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const box=useRef<HTMLDivElement>(null);const field=useRef<HTMLTextAreaElement>(null);
  const latest=useRef({text,busy});latest.current={text,busy};
  const save=async(value:string)=>{
    if(value.trim()===(item.note??'')){onClose();return;}
    setBusy(true);setError('');
    try{if(anchor.kind==='project')await window.harbor.updateProject(item.id,{note:value});else await window.harbor.update(item.id,{note:value});onClose();}catch(err){setError((err as Error).message);setBusy(false);}
  };
  const saveRef=useRef(save);saveRef.current=save;
  useEffect(()=>{field.current?.focus();const end=field.current?.value.length??0;field.current?.setSelectionRange(end,end);},[]);
  useEffect(()=>{
    // Clicking away keeps what was written, like a sticky note.
    const away=(event:globalThis.MouseEvent)=>{if(!box.current?.contains(event.target as Node)&&!latest.current.busy)void saveRef.current(latest.current.text);};
    document.addEventListener('mousedown',away);return()=>document.removeEventListener('mousedown',away);
  },[]);
  const keys=(event:KeyboardEvent)=>{
    event.stopPropagation();
    if(event.key==='Escape'){event.preventDefault();onClose();}
    if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)){event.preventDefault();void save(text);}
  };
  return createPortal(<div ref={box} className="chat-note-editor" role="dialog" aria-label={`Note for ${item.name}`} onKeyDown={keys}
    style={{left:Math.max(8,Math.min(anchor.x,innerWidth-328)),top:Math.max(8,Math.min(anchor.y,innerHeight-236))}}>
    <textarea ref={field} value={text} maxLength={NOTE_LIMIT} placeholder="Write a note…" aria-label="Note" disabled={busy} onChange={e=>setText(e.target.value.replace(/\r\n?/g,'\n'))}/>
    {error&&<p role="alert" className="form-error">{error}</p>}
    <footer><small>⌘↩ to save</small>{item.note&&<button type="button" className="chat-note-remove" disabled={busy} onClick={()=>void save('')}>Remove</button>}<button type="button" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className="chat-note-save" disabled={busy} onClick={()=>void save(text)}>Save</button></footer>
  </div>,document.body);
}
