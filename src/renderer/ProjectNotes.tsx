import { useEffect, useState, type ReactNode } from 'react';
import { ArrowUpRight, Pencil, Plus, StickyNote } from 'lucide-react';
import type { Project, Session } from '../shared/types';
import { AgentIcon } from './AgentIcon';
import { ChatStatusIcon } from './ChatStatusIcon';
import { NoteEditor, saveNote, type NoteKind, type Noted } from './ChatNote';
import { NoteMarkdown } from './NoteMarkdown';

/** A note shown in place: rendered, with tasks that save as they are checked, reordered or prioritized; Edit (or a
 *  double-click) swaps in the full editor. */
function NoteCard({item,kind,label,title,actions,onError}:{item:Noted;kind:NoteKind;label:string;title:ReactNode;actions?:ReactNode;onError:(message:string)=>void}) {
  const [editing,setEditing]=useState(false);const [pending,setPending]=useState<string>();
  useEffect(()=>setPending(undefined),[item.note]);
  const shown=pending??item.note??'';
  const change=(text:string)=>{setPending(text);saveNote(kind,item.id,text).catch(error=>{setPending(undefined);onError((error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /,''));});};
  return <article className={`project-note-card ${kind}`} aria-label={label}>
    <header>{title}<span className="spacer"/>{actions}{!editing&&shown&&<button type="button" className="icon-button" aria-label={`Edit ${label.toLowerCase()}`} title="Edit note" onClick={()=>setEditing(true)}><Pencil size={13}/></button>}</header>
    {editing?<NoteEditor item={{...item,note:shown||undefined}} kind={kind} inline onClose={()=>setEditing(false)}/>
      :shown?<div onDoubleClick={event=>{if(!(event.target as Element).closest('button'))setEditing(true);}}><NoteMarkdown text={shown} onChange={change}/></div>
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
