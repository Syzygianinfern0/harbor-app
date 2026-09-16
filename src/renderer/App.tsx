import { useCallback, useEffect, useRef, useState } from 'react';
import { Anchor, Bell, Check, ChevronDown, ChevronRight, Code2, Columns2, Folder, FolderPlus, LoaderCircle, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pin, Plus, RefreshCw, Search, Settings2, Sparkles, Terminal, X } from 'lucide-react';
import type { Launcher, Project, Session, Snapshot } from '../shared/types';
import { TerminalPane } from './TerminalPane';
import { PreferencesDialog } from './PreferencesDialog';
import { ProjectDialog, ChatDialog, RenameDialog } from './ProjectDialogs';

export const launcherName: Record<Launcher,string> = {codex:'Codex',claude:'Claude Code',shell:'Terminal',custom:'Custom'};
export function AgentIcon({launcher,size=16}:{launcher:Launcher;size?:number}) { return launcher==='codex'?<Code2 size={size}/>:launcher==='claude'?<Sparkles size={size}/>:<Terminal size={size}/>; }
function saved<T>(key:string,fallback:T):T {try{return JSON.parse(localStorage.getItem(key)||'null')??fallback;}catch{return fallback;}}
const activityLabel:Record<string,string>={starting:'Starting',working:'Working',attention:'Needs attention',idle:'Ready',closed:'Closed',error:'Needs attention',unknown:'Status unavailable',external:'Running elsewhere'};
function chatActivity(session:Session) {return session.externalActive&&session.status==='closed'?'external':session.status==='closed'?'closed':session.status==='unreachable'?'unknown':session.activity||'unknown';}

export function App() {
  const [snapshot,setSnapshot]=useState<Snapshot>();
  const [selected,setSelected]=useState<string>();
  const [projectId,setProjectId]=useState<string>(()=>saved('harbor.project',''));
  const projectRef=useRef(projectId); projectRef.current=projectId;
  const [tabs,setTabs]=useState<string[]>(()=>saved('harbor.tabs',[]));
  const [split,setSplit]=useState<string>();
  const [query,setQuery]=useState('');
  const [dialog,setDialog]=useState<'project'|'chat'|'preferences'|null>(null);
  const [rename,setRename]=useState<{kind:'chat'|'project';id:string;name:string}>();
  const [context,setContext]=useState<{id:string;x:number;y:number}>();
  const [menu,setMenu]=useState(false); const [splitMenu,setSplitMenu]=useState(false);
  const [busy,setBusy]=useState<string>(); const [toast,setToast]=useState('');
  const [collapsed,setCollapsed]=useState(()=>saved('harbor.sidebarCollapsed',false));
  const [peek,setPeek]=useState(false); const [folded,setFolded]=useState<string[]>(()=>saved('harbor.foldedProjects',[]));
  const loadedHistory=useRef(new Set<string>()); const search=useRef<HTMLInputElement>(null);
  const report=useCallback((message:string)=>setToast(message.replace(/^Error invoking remote method '[^']+': Error: /,'')),[]);
  const newChat=useCallback((id?:string)=>{if(id) setProjectId(id); setDialog(id||projectRef.current?'chat':'project');},[]);
  const toggleSidebar=()=>{setCollapsed(v=>!v);setPeek(false);};
  const sessions=snapshot?.sessions??[]; const projects=snapshot?.projects??[];
  const current=sessions.find(s=>s.id===selected); const second=sessions.find(s=>s.id===split&&s.id!==selected&&s.status!=='closed');
  const project=projects.find(p=>p.id===projectId);
  const open=useCallback((session:Session)=>{setSelected(session.id);if(session.projectId)setProjectId(session.projectId);setTabs(v=>v.includes(session.id)?v:[...v,session.id]);setMenu(false);setContext(undefined);},[]);
  const refreshHistory=async(id:string)=>{setBusy(id);try{await window.harbor.importHistory(id);}catch(error){report((error as Error).message);}finally{setBusy(undefined);}};
  useEffect(()=>{
    window.harbor.snapshot().then(data=>{setSnapshot(data);const restored=saved<string[]>('harbor.tabs',[]).filter(id=>data.sessions.some(s=>s.id===id));setTabs(restored);setSelected(restored[0]);setProjectId(saved('harbor.project','')||data.sessions.find(s=>s.id===restored[0])?.projectId||data.projects[0]?.id||'');}).catch(e=>report(e.message));
    const off=window.harbor.onSnapshot(setSnapshot); const offNew=window.harbor.onNewSession(()=>newChat());
    const offPrefs=window.harbor.onPreferences(()=>setDialog('preferences'));
    const offOpen=window.harbor.onOpenSession(id=>{void window.harbor.snapshot().then(data=>{const session=data.sessions.find(s=>s.id===id);if(session)open(session);});});
    return()=>{off();offNew();offPrefs();offOpen();};
  },[newChat,open,report]);
  useEffect(()=>{if(project && !loadedHistory.current.has(project.id)){loadedHistory.current.add(project.id);void refreshHistory(project.id);}},[project?.id]);
  useEffect(()=>{localStorage.setItem('harbor.tabs',JSON.stringify(tabs));},[tabs]);
  useEffect(()=>{localStorage.setItem('harbor.project',JSON.stringify(projectId));},[projectId]);
  useEffect(()=>{localStorage.setItem('harbor.sidebarCollapsed',JSON.stringify(collapsed));},[collapsed]);
  useEffect(()=>{localStorage.setItem('harbor.foldedProjects',JSON.stringify(folded));},[folded]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),10000);return()=>clearTimeout(timer);},[toast]);
  useEffect(()=>{
    if(!dialog&&!rename)return;const previous=document.activeElement as HTMLElement|null;
    document.querySelector<HTMLElement>('.modal button:not(:disabled)')?.focus();
    return()=>{if(previous?.isConnected)previous.focus();};
  },[dialog,rename]);
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){setDialog(null);setRename(undefined);setMenu(false);setSplitMenu(false);setContext(undefined);}
      if(dialog||rename){
        if(event.key==='Tab'){const fields=[...document.querySelectorAll<HTMLElement>('.modal button:not(:disabled),.modal input,.modal select,.modal textarea')].filter(e=>e.offsetParent!==null);const first=fields[0],last=fields.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
        return;
      }
      if(event.metaKey&&event.key.toLowerCase()==='n'){event.preventDefault();newChat();}
      if(event.metaKey&&event.key.toLowerCase()==='b'){event.preventDefault();toggleSidebar();}
      if(event.metaKey&&['k','f'].includes(event.key.toLowerCase())){event.preventDefault();setCollapsed(false);requestAnimationFrame(()=>search.current?.focus());}
    };
    const dismiss=()=>setContext(undefined);window.addEventListener('keydown',key);window.addEventListener('click',dismiss);window.addEventListener('blur',dismiss);
    return()=>{window.removeEventListener('keydown',key);window.removeEventListener('click',dismiss);window.removeEventListener('blur',dismiss);};
  },[dialog,rename]);
  const closeChat=async(session:Session)=>{setBusy(session.id);setMenu(false);setContext(undefined);try{await window.harbor.terminate(session.id);setTabs(v=>v.filter(id=>id!==session.id));if(selected===session.id)setSelected(undefined);if(split===session.id)setSplit(undefined);}catch(error){report((error as Error).message);}finally{setBusy(undefined);}};
  const resumeChat=async(session:Session,restart=false)=>{setBusy(session.id);setContext(undefined);setMenu(false);try{open(await window.harbor.resume(session.id,restart));}catch(error){report((error as Error).message);}finally{setBusy(undefined);}};
  const pin=async(session:Session)=>{setContext(undefined);setMenu(false);try{await window.harbor.update(session.id,{pinned:!session.pinned});}catch(error){report((error as Error).message);}};
  const chatMenu=(session:Session)=><><button role="menuitem" onClick={()=>{setRename({kind:'chat',id:session.id,name:session.name});setContext(undefined);setMenu(false);}}>Rename chat…</button><button role="menuitem" onClick={()=>void pin(session)}><Pin size={14}/>{session.pinned?'Unpin':'Pin'} chat</button>{session.status==='closed'?<button role="menuitem" disabled={busy===session.id||session.externalActive} onClick={()=>void resumeChat(session)}><RefreshCw size={14}/>{session.launcher==='shell'?'Reopen terminal':'Resume chat'}</button>:<><button role="menuitem" disabled={busy===session.id} onClick={()=>void resumeChat(session,true)}><RefreshCw size={14}/>Reconnect & resume</button><button role="menuitem" disabled={busy===session.id} onClick={()=>void closeChat(session)}><X size={14}/>Close chat</button></>}<hr/><button role="menuitem" onClick={async()=>{setContext(undefined);setMenu(false);if(await window.harbor.forget(session.id)){setTabs(v=>v.filter(id=>id!==session.id));if(selected===session.id)setSelected(undefined);}}}>Remove from sidebar…</button></>;
  const row=(session:Session)=>{const activity=chatActivity(session);return <button key={session.id} className={`session-row chat-row ${selected===session.id?'selected':''} ${activity==='closed'?'closed-chat':''}`} onClick={()=>open(session)} onContextMenu={event=>{event.preventDefault();setContext({id:session.id,x:Math.min(event.clientX,innerWidth-250),y:Math.min(event.clientY,innerHeight-255)});}} title={`${launcherName[session.launcher]} · ${activityLabel[activity]}\n${session.activityDetail||session.cwd}`}><AgentIcon launcher={session.launcher} size={15}/><span className="chat-title">{session.name}</span>{session.pinned&&<Pin size={11}/>}<span className={`chat-activity ${activity}`} aria-label={activityLabel[activity]} title={activityLabel[activity]}>{activity==='working'||activity==='starting'?<LoaderCircle size={12} className="spin"/>:activity==='attention'||activity==='error'?<Bell size={12}/>:activity==='closed'?<span className="closed-dot"/>:<span className="status-dot running"/>}</span></button>;};
  const matches=(session:Session)=>!query||`${session.name} ${projects.find(p=>p.id===session.projectId)?.name}`.toLowerCase().includes(query.toLowerCase());
  const peeking=collapsed&&peek&&snapshot?.preferences.sidebar.expandOnHover;
  return <div className="app-shell">
    <div className={`sidebar-dock ${collapsed?'is-collapsed':''} ${peeking?'is-peeking':''}`} onMouseEnter={()=>setPeek(true)} onMouseLeave={()=>setPeek(false)}>
      {collapsed&&<nav className="sidebar-rail" aria-label="Collapsed sidebar"><div className="traffic-spacer"/><button className="icon-button" aria-label="Expand sidebar" onClick={toggleSidebar}><PanelLeftOpen size={19}/></button><button className="rail-new" aria-label="New chat" onClick={()=>newChat()}><Plus size={20}/></button><div className="rail-sessions">{projects.map(p=><button key={p.id} className={`rail-session ${projectId===p.id?'active':''}`} title={p.name} aria-label={`Open project ${p.name}`} onClick={()=>{setProjectId(p.id);setSelected(undefined);}}><Folder size={19}/></button>)}</div><button className="icon-button rail-preferences" aria-label="Preferences" onClick={()=>setDialog('preferences')}><Settings2 size={19}/></button></nav>}
      <aside className="sidebar" inert={collapsed&&!peeking?true:undefined}><div className="traffic-spacer"><button className="icon-button sidebar-toggle" aria-label={collapsed?'Pin sidebar open':'Collapse sidebar'} title="Toggle sidebar (⌘ B)" onClick={toggleSidebar}>{collapsed?<PanelLeftOpen size={18}/>:<PanelLeftClose size={18}/>}</button></div>
        <div className="brand"><div className="brand-icon"><Anchor size={23}/></div><span>harbor<span className="brand-period">.</span></span></div>
        <button className="new-session-button" onClick={()=>newChat()}><Plus size={17}/>New chat<kbd>⌘ N</kbd></button>
        <div className="search-box"><Search size={14}/><input ref={search} aria-label="Search chats" placeholder="Find a chat…" value={query} onChange={e=>setQuery(e.target.value)}/></div>
        <div className="projects-list"><div className="section-label">PROJECTS<button className="icon-button" aria-label="Add project" title="Add a project directory" onClick={()=>setDialog('project')}><FolderPlus size={15}/></button></div>
          {projects.map(p=>{const chats=sessions.filter(s=>s.projectId===p.id&&!s.archived&&matches(s)).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.updatedAt.localeCompare(a.updatedAt));return <section className="project-section" key={p.id}><div className={`project-heading ${projectId===p.id?'active':''}`}><button className="project-disclosure" aria-label={`${folded.includes(p.id)?'Expand':'Collapse'} project ${p.name}`} onClick={()=>setFolded(v=>v.includes(p.id)?v.filter(id=>id!==p.id):[...v,p.id])}>{folded.includes(p.id)?<ChevronRight size={13}/>:<ChevronDown size={13}/>}</button><button className="project-name" title={`${p.hostLabel}\n${p.cwd}`} onClick={()=>{setProjectId(p.id);setSelected(undefined);}}><Folder size={14}/><span>{p.name}</span></button><button className="icon-button project-add" aria-label={`New chat in ${p.name}`} title="New chat in this project" onClick={()=>newChat(p.id)}><Plus size={15}/></button></div>{(!folded.includes(p.id)||query)&&<div className="project-chats">{chats.map(row)}{!chats.length&&<button className="project-empty" onClick={()=>newChat(p.id)}>Start a conversation</button>}</div>}</section>;})}
          {!projects.length&&<button className="sidebar-empty text-button" onClick={()=>setDialog('project')}>Add your first project</button>}
        </div>
        <div className="sidebar-footer"><button className="preferences-button" aria-label="Preferences" onClick={()=>setDialog('preferences')}><Settings2 size={16}/>Preferences<kbd>⌘ ,</kbd></button></div>
      </aside>
    </div>
    <main className={`workspace ${current?'has-terminal':''}`}>
      {current?<><div className="session-toolbar"><div className="tab-strip">{tabs.map(id=>{const s=sessions.find(v=>v.id===id);return s&&<div key={id} className={`tab ${id===selected?'active':''}`}><button onClick={()=>open(s)}><AgentIcon launcher={s.launcher} size={14}/><span>{s.name}</span></button><button className="tab-close" aria-label={`Close chat ${s.name}`} title="Close chat and stop its tmux session" onClick={()=>void closeChat(s)}><X size={12}/></button></div>;})}<button className="icon-button tab-add" aria-label="New chat tab" onClick={()=>newChat(current.projectId)}><Plus size={16}/></button></div><div className="session-actions">{current.status!=='closed'&&<div className="popover-anchor"><button className="icon-button" aria-label="Split view" title="Split view" onClick={()=>second?setSplit(undefined):setSplitMenu(v=>!v)}><Columns2 size={16}/></button>{splitMenu&&<div className="popover split-picker">{sessions.filter(s=>s.status==='running'&&s.id!==current.id).map(s=><button key={s.id} onClick={()=>{setSplit(s.id);setSplitMenu(false);}}><AgentIcon launcher={s.launcher}/>{s.name}</button>)}</div>}</div>}<div className="popover-anchor"><button className="icon-button" aria-label="Chat actions" onClick={()=>setMenu(v=>!v)}><MoreHorizontal size={19}/></button>{menu&&<div className="popover actions-menu" role="menu">{chatMenu(current)}</div>}</div></div></div><h1 className="sr-only">{current.name}</h1>
        {current.status==='closed'?<div className="closed-chat-panel"><AgentIcon launcher={current.launcher} size={30}/><h2>{current.name}</h2><p>{current.externalActive?'This conversation is running outside Harbor. Close it there and refresh this project to resume here.':current.launcher==='shell'?'This terminal is closed. Reopening starts a new shell in the project directory.':'This chat is closed. Resume to continue its saved conversation in a new terminal.'}</p><button className="primary-button" disabled={busy===current.id||current.externalActive} onClick={()=>void resumeChat(current)}>{busy===current.id?<LoaderCircle className="spin" size={16}/>:<RefreshCw size={16}/>} {current.launcher==='shell'?'Reopen terminal':'Resume chat'}</button>{current.imported&&<small>Imported from {launcherName[current.launcher]} history</small>}</div>:<div className={`terminal-grid ${second?'split':''}`}><TerminalPane key={current.id} session={current} preferences={snapshot!.preferences.terminal} showHeader={!!second} onReconnect={()=>void resumeChat(current,true)} report={report}/>{second&&<TerminalPane key={second.id} session={second} preferences={snapshot!.preferences.terminal} showHeader onClose={()=>void closeChat(second)} onReconnect={()=>void resumeChat(second,true)} report={report}/>}</div>}
      </>:<div className="project-overview"><div className="project-overview-heading"><div className="eyebrow">{project?'PROJECT':'YOUR WORK, IN ONE PLACE'}</div><h1>{project?.name||'A home for your projects.'}</h1><p>{project?`${project.hostLabel} · ${project.cwd}`:'Add a directory to see its past conversations and start something new.'}</p></div>{project?<><div className="project-overview-actions"><button className="primary-button" onClick={()=>newChat(project.id)}><Plus size={16}/>New chat</button><button className="secondary-button" disabled={busy===project.id} onClick={()=>void refreshHistory(project.id)}><RefreshCw size={14} className={busy===project.id?'spin':''}/>Refresh past chats</button><button className="icon-button" aria-label="Rename project" onClick={()=>setRename({kind:'project',id:project.id,name:project.name})}><Settings2 size={16}/></button></div>{project.historyError&&<p className="form-error">Some history could not be loaded: {project.historyError}</p>}<div className="project-conversations">{sessions.filter(s=>s.projectId===project.id&&!s.archived).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.updatedAt.localeCompare(a.updatedAt)).map(row)}</div></>:<button className="primary-button" onClick={()=>setDialog('project')}><FolderPlus size={17}/>Add project</button>}</div>}
    </main>
    {context&&sessions.find(s=>s.id===context.id)&&<div className="popover chat-context-menu" role="menu" style={{left:context.x,top:context.y}} onClick={e=>e.stopPropagation()}>{chatMenu(sessions.find(s=>s.id===context.id)!)}</div>}
    {toast&&<div className="toast" role="alert">{toast}<button aria-label="Dismiss message" onClick={()=>setToast('')}><X size={15}/></button></div>}
    {dialog==='preferences'&&snapshot&&<PreferencesDialog initial={snapshot.preferences} onClose={()=>setDialog(null)}/>}
    {dialog==='project'&&snapshot&&<ProjectDialog snapshot={snapshot} onPreferences={()=>setDialog('preferences')} onClose={()=>setDialog(null)} onCreated={p=>{setProjectId(p.id);setSelected(undefined);setDialog(null);loadedHistory.current.add(p.id);}}/>}
    {dialog==='chat'&&project&&<ChatDialog project={project} onClose={()=>setDialog(null)} onCreated={s=>{setDialog(null);open(s);}}/>}
    {rename&&<RenameDialog initial={rename.name} kind={rename.kind} onClose={()=>setRename(undefined)} onSave={async name=>{if(rename.kind==='chat')await window.harbor.update(rename.id,{name});else await window.harbor.updateProject(rename.id,name);setRename(undefined);}}/>}
  </div>;
}
