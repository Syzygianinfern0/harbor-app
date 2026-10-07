import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, Pencil, Plus, StickyNote } from 'lucide-react';
import type { Project, Session } from '../shared/types';
import { AgentIcon } from './AgentIcon';
import { ChatStatusIcon } from './ChatStatusIcon';
import { NoteEditor, saveNote, type NoteKind, type Noted } from './ChatNote';
import { NoteMarkdown } from './NoteMarkdown';

/** A note shown in place: rendered as a working checklist that saves as items are added, edited, ticked, deleted,
 *  reordered or prioritized; Edit (or a double-click outside the list) swaps in the full editor. */
function NoteCard({item,kind,label,title,actions,onError}:{item:Noted;kind:NoteKind;label:string;title:ReactNode;actions?:ReactNode;onError:(message:string)=>void}) {
  const [editing,setEditing]=useState(false);const [pending,setPending]=useState<string>();const [expanded,setExpanded]=useState(false);const [clipped,setClipped]=useState(false);const body=useRef<HTMLDivElement>(null);
  // Edits show at once and save shortly after the last one, so typing an item in place is not a save per keystroke.
  // The saved note (trimmed by the engine) catching up with them ends the local copy; a failed save drops it.
  const timer=useRef<ReturnType<typeof setTimeout>>(undefined);const unsaved=useRef<string>(undefined);
  const flush=useRef(()=>{});flush.current=()=>{
    clearTimeout(timer.current);const text=unsaved.current;if(text===undefined)return;unsaved.current=undefined;
    saveNote(kind,item.id,text).then(()=>{if(unsaved.current===undefined)setPending(v=>v===text?undefined:v);},error=>{setPending(undefined);onError((error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /,''));});
  };
  useEffect(()=>()=>flush.current(),[]);
  useEffect(()=>setPending(v=>v!==undefined&&unsaved.current===undefined&&v.trim()===(item.note??'')?undefined:v),[item.note]);
  const shown=pending??item.note??'';
  // Long notes start folded so one note cannot bury the rest of the page.
  useLayoutEffect(()=>{const el=body.current;setClipped(!!el&&el.scrollHeight>el.clientHeight+1);},[shown,editing,expanded]);
  const change=(text:string)=>{setPending(text);unsaved.current=text;clearTimeout(timer.current);timer.current=setTimeout(()=>flush.current(),400);};
  return <article className={`project-note-card ${kind}`} aria-label={label}>
    <header>{title}<span className="spacer"/>{actions}{!editing&&shown&&<button type="button" className="icon-button" aria-label={`Edit ${label.toLowerCase()}`} title="Edit note" onClick={()=>{flush.current();setEditing(true);}}><Pencil size={13}/></button>}</header>
    {editing?<NoteEditor item={{...item,note:shown||undefined}} kind={kind} inline onClose={()=>setEditing(false)}/>
      :shown?<><div ref={body} className={`project-note-body ${expanded?'':'folded'} ${clipped?'clipped':''}`} onDoubleClick={event=>{if(!(event.target as Element).closest('button,.note-item-row'))setEditing(true);}}><NoteMarkdown text={shown} onChange={change}/></div>
        {(clipped||expanded)&&<button type="button" className="text-button project-note-more" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>{expanded?'Show less':'Show the whole note'}</button>}</>
      :<button type="button" className="text-button project-note-add" onClick={()=>setEditing(true)}><Plus size={13}/>Add a note for this project</button>}
  </article>;
}

/** The project page's notes: the project's own note, then every chat in it that has one. */
export function ProjectNotes({project,sessions,onOpen,onError}:{project:Project;sessions:Session[];onOpen:(session:Session)=>void;onError:(message:string)=>void}) {
  const noted=sessions.filter(s=>s.projectId===project.id&&!s.archived&&s.note).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.updatedAt.localeCompare(a.updatedAt));
  return <section className="project-notes" aria-label="Notes">
    <NoteCard key={project.id} item={project} kind="project" label="Project note" onError={onError} title={<h2><StickyNote size={13}/>Project note</h2>}/>
    {noted.length>0&&<>
      <h2 className="project-notes-heading">Chat notes <span>{noted.length}</span></h2>
      {noted.map(s=><NoteCard key={s.id} item={s} kind="chat" label={`Note for ${s.name}`} onError={onError}
        title={<button type="button" className="project-note-chat" title="Open chat" onClick={()=>onOpen(s)}><AgentIcon launcher={s.launcher} size={14}/><span>{s.name}</span></button>}
        actions={<><ChatStatusIcon session={s}/><button type="button" className="icon-button" aria-label={`Open ${s.name}`} title="Open chat" onClick={()=>onOpen(s)}><ArrowUpRight size={14}/></button></>}/>)}
    </>}
  </section>;
}
