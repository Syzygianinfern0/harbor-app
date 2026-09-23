import { useCallback, useEffect, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { Anchor, Bell, Check, ChevronDown, ChevronRight, Columns2, ExternalLink, Folder, FolderPlus, LoaderCircle, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pin, Plus, RefreshCw, Search, Settings2, X } from 'lucide-react';
import type { Launcher, Project, Session, Snapshot, TabShortcut } from '../shared/types';
import { AgentIcon } from './AgentIcon';
import { ChatStatusIcon } from './ChatStatusIcon';
import { activityLabel, chatActivity } from '../shared/chatStatus';
import { ChatPreviewPanel } from './ChatPreviewPanel';
import { ChatUsageBar, SidebarCost, useHostUsage } from './UsagePanel';
import { PersistentChat } from './PersistentChat';
import { PaneLayout } from './PaneLayout';
import { ResizeHandle } from './ResizeHandle';
import { dropPane, leaf, paneIds, removePane, reorderTabs, replacePane, resizePane, restorePanes, type DropSide, type PaneNode } from '../shared/panes';
import { tabShortcut } from '../shared/shortcuts';
import { LaunchCommandDialog } from './LaunchCommandDialog';
import { TerminalPane } from './TerminalPane';
import { PreferencesDialog } from './PreferencesDialog';
import { ProjectDialog, ChatDialog, RenameDialog } from './ProjectDialogs';

export const launcherName: Record<Launcher,string> = {codex:'Codex',claude:'Claude Code',shell:'Terminal',custom:'Custom'};
export { AgentIcon } from './AgentIcon';
function saved<T>(key:string,fallback:T):T {try{return JSON.parse(localStorage.getItem(key)||'null')??fallback;}catch{return fallback;}}


function projectsForReachability(snapshot?:Snapshot) {return snapshot?.projects.map(p=>p.connection)??[];}

export function App() {
  const [snapshot,setSnapshot]=useState<Snapshot>();
  const [selected,setSelected]=useState<string>();
  const [projectId,setProjectId]=useState<string>(()=>saved('harbor.project',''));
  const projectRef=useRef(projectId); projectRef.current=projectId;
  const [tabs,setTabs]=useState<string[]>(()=>saved('harbor.tabs',[]));
  const [layout,setLayout]=useState<PaneNode|null>(null);
  const [hydrated,setHydrated]=useState(false);
  const [sidebarWidth,setSidebarWidth]=useState(()=>Math.max(200,Math.min(600,saved('harbor.sidebarWidth',272))));
  const [dragging,setDragging]=useState<string>();
  const [freshChats,setFreshChats]=useState<Set<string>>(()=>new Set());
  const workspaceRef=useRef({selected,tabs,layout});workspaceRef.current={selected,tabs,layout};
  const navigateTabs=useRef<(action:TabShortcut)=>void>(()=>{});
  const refreshLock=useRef(false);
  const refreshAction=useRef<()=>void>(()=>{});
  const [refreshing,setRefreshing]=useState(false);
  const [refreshVersion,setRefreshVersion]=useState(0);
  const usage=useHostUsage(refreshVersion,JSON.stringify(snapshot?.preferences.hosts??[]));
  const [preferencesTab,setPreferencesTab]=useState<'hosts'|'usage'>('hosts');
  const showUsage=()=>{setPreferencesTab('usage');setDialog('preferences');};
  const refreshAll=async()=>{if(refreshLock.current)return;refreshLock.current=true;setRefreshing(true);try{await window.harbor.refresh();const data=await window.harbor.snapshot();await Promise.all(data.projects.map(p=>window.harbor.importHistory(p.id)));setReachability(await window.harbor.checkReachability());const latest=await window.harbor.snapshot();setSnapshot(latest);setRefreshVersion(v=>v+1);const failures=latest.projects.filter(p=>p.historyError);setToast(failures.length?`Refreshed with errors: ${failures.map(p=>p.name+': '+p.historyError).join('; ')}`:'Chats and status are up to date.');}catch(error){report((error as Error).message);}finally{refreshLock.current=false;setRefreshing(false);}};
  refreshAction.current=()=>void refreshAll();
  useEffect(()=>window.harbor.onRefresh(()=>void refreshAll()),[refreshing]);
  const [query,setQuery]=useState('');
  const [hideClosed,setHideClosed]=useState(()=>saved('harbor.hideClosed',false));
  const [commandSession,setCommandSession]=useState<Session>();
  useEffect(()=>{localStorage.setItem('harbor.hideClosed',JSON.stringify(hideClosed));},[hideClosed]);
  const [limits,setLimits]=useState<Record<string,number>>({});
  const [reachability,setReachability]=useState<Record<string,boolean>>({});
  const projectConnections=JSON.stringify(projectsForReachability(snapshot));
  useEffect(()=>{let cancelled=false;let checking=false;const check=async()=>{if(checking)return;checking=true;try{const result=await window.harbor.checkReachability();if(!cancelled)setReachability(result);}catch{}finally{checking=false;}};void check();const timer=setInterval(()=>void check(),30000);return()=>{cancelled=true;clearInterval(timer);};},[projectConnections]);
  const [dialog,setDialog]=useState<'project'|'chat'|'preferences'|null>(null);
  const [rename,setRename]=useState<{kind:'chat'|'project';id:string;name:string}>();
  const [context,setContext]=useState<{id:string;x:number;y:number;kind?:'project'}>();
  const [menu,setMenu]=useState(false); const [splitMenu,setSplitMenu]=useState(false);
  const [busy,setBusy]=useState<string>(); const [toast,setToast]=useState('');
  const [collapsed,setCollapsed]=useState(()=>saved('harbor.sidebarCollapsed',false));
  const [peek,setPeek]=useState(false); const [folded,setFolded]=useState<string[]>(()=>saved('harbor.foldedProjects',[]));
  const closeSelected=useRef<()=>void>(()=>{});
  const loadedHistory=useRef(new Set<string>()); const search=useRef<HTMLInputElement>(null);
  const report=useCallback((message:string)=>setToast(message.replace(/^Error invoking remote method '[^']+': Error: /,'')),[]);
  const newChat=useCallback((id?:string)=>{if(id) setProjectId(id); setDialog(id||projectRef.current?'chat':'project');},[]);
  const toggleSidebar=()=>{setCollapsed(v=>!v);setPeek(false);};
  const sessions=snapshot?.sessions??[]; const projects=(snapshot?.projects??[]).filter(p=>!p.hidden);
  useEffect(()=>{if(hydrated&&!projects.some(p=>p.id===projectId))setProjectId(projects[0]?.id||'');},[snapshot?.projects,hydrated,projectId]);
  const current=sessions.find(s=>s.id===selected);
  const project=projects.find(p=>p.id===projectId);
  const open=useCallback((session:Session)=>{setLayout(v=>paneIds(v).includes(session.id)?v:replacePane(v,workspaceRef.current.selected??paneIds(v)[0],session.id));setSelected(session.id);if(session.projectId)setProjectId(session.projectId);setTabs(v=>v.includes(session.id)?v:[...v,session.id]);setMenu(false);setContext(undefined);},[]);
  const refreshHistory=async(id:string)=>{setBusy(id);try{await window.harbor.importHistory(id);}catch(error){report((error as Error).message);}finally{setBusy(undefined);}};
  useEffect(()=>{
    window.harbor.snapshot().then(data=>{setSnapshot(data);const restored=saved<string[]>('harbor.tabs',[]).filter(id=>data.sessions.some(s=>s.id===id));setTabs(restored);const tree=restorePanes(saved('harbor.layout',null),restored)??(restored[0]?leaf(restored[0]):null);setLayout(tree);const active=saved('harbor.selected','');setSelected(paneIds(tree).includes(active)?active:paneIds(tree)[0]);setHydrated(true);setProjectId(saved('harbor.project','')||data.sessions.find(s=>s.id===restored[0])?.projectId||data.projects[0]?.id||'');}).catch(e=>report(e.message));
    const off=window.harbor.onSnapshot(setSnapshot); const offNew=window.harbor.onNewSession(()=>newChat());
    const offPrefs=window.harbor.onPreferences(()=>setDialog('preferences'));
    const offOpen=window.harbor.onOpenSession(id=>{void window.harbor.snapshot().then(data=>{const session=data.sessions.find(s=>s.id===id);if(session)open(session);});});
    return()=>{off();offNew();offPrefs();offOpen();};
  },[newChat,open,report]);
  useEffect(()=>{if(project && !loadedHistory.current.has(project.id)){loadedHistory.current.add(project.id);void refreshHistory(project.id);}},[project?.id]);
  useEffect(()=>{if(!hydrated)return;localStorage.setItem('harbor.tabs',JSON.stringify(tabs));},[tabs,hydrated]);
  useEffect(()=>{if(!hydrated)return;localStorage.setItem('harbor.layout',JSON.stringify(layout));localStorage.setItem('harbor.selected',JSON.stringify(selected));},[layout,selected,hydrated]);
  useEffect(()=>{localStorage.setItem('harbor.sidebarWidth',JSON.stringify(sidebarWidth));},[sidebarWidth]);
  useEffect(()=>{document.querySelector('.tab.active')?.scrollIntoView({block:'nearest',inline:'nearest'});},[selected]);
  useEffect(()=>{localStorage.setItem('harbor.project',JSON.stringify(projectId));},[projectId]);
  useEffect(()=>{localStorage.setItem('harbor.sidebarCollapsed',JSON.stringify(collapsed));},[collapsed]);
  useEffect(()=>{localStorage.setItem('harbor.foldedProjects',JSON.stringify(folded));},[folded]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),10000);return()=>clearTimeout(timer);},[toast]);
  useEffect(()=>{
    if(!dialog&&!rename&&!commandSession)return;const previous=document.activeElement as HTMLElement|null;
    (document.querySelector<HTMLElement>('.chat-modal input, .rename-modal input') ?? document.querySelector<HTMLElement>('.modal input, .modal select, .modal textarea') ?? document.querySelector<HTMLElement>('.modal .primary-button'))?.focus();
    return()=>{if(previous?.isConnected)previous.focus();};
  },[dialog,rename,commandSession]);
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){setDialog(null);setRename(undefined);setCommandSession(undefined);setMenu(false);setSplitMenu(false);setContext(undefined);}
      if(dialog||rename||commandSession){
        if(event.key==='Tab'){const fields=[...document.querySelectorAll<HTMLElement>('.modal button:not(:disabled),.modal input,.modal select,.modal textarea')].filter(e=>e.offsetParent!==null);const first=fields[0],last=fields.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
        return;
      }
      if(event.metaKey&&event.key.toLowerCase()==='w'){event.preventDefault();closeSelected.current();}
      const tabAction=tabShortcut(event);if(tabAction!==undefined){event.preventDefault();navigateTabs.current(tabAction);return;}
      if(event.metaKey&&event.key.toLowerCase()==='r'){event.preventDefault();refreshAction.current();return;}
      if(event.metaKey&&['n','t'].includes(event.key.toLowerCase())){event.preventDefault();newChat();}
      if(event.metaKey&&event.key.toLowerCase()==='b'){event.preventDefault();toggleSidebar();}
      if(event.metaKey&&['k','f'].includes(event.key.toLowerCase())){event.preventDefault();setCollapsed(false);requestAnimationFrame(()=>search.current?.focus());}
    };
    const dismiss=()=>setContext(undefined);window.addEventListener('keydown',key);window.addEventListener('click',dismiss);window.addEventListener('blur',dismiss);
    return()=>{window.removeEventListener('keydown',key);window.removeEventListener('click',dismiss);window.removeEventListener('blur',dismiss);};
  },[dialog,rename,commandSession]);
  const removeFromWorkspace=(id:string,closeTab:boolean)=>{
    const state=workspaceRef.current;
    const remaining=closeTab?state.tabs.filter(tab=>tab!==id):state.tabs;
    let tree=removePane(state.layout,id);
    let active=state.selected===id?paneIds(tree)[0]:state.selected;
    if(!tree&&closeTab&&remaining.length){active=remaining[Math.min(Math.max(0,state.tabs.indexOf(id)),remaining.length-1)];tree=leaf(active);}
    if(closeTab)setTabs(remaining);setLayout(tree);setSelected(active);
  };
  const closeChat=async(session:Session)=>{setBusy(session.id);setMenu(false);setContext(undefined);try{if(!await window.harbor.terminate(session.id))return;removeFromWorkspace(session.id,true);setFreshChats(v=>{const next=new Set(v);next.delete(session.id);return next;});}catch(error){report((error as Error).message);}finally{setBusy(undefined);}};
  closeSelected.current=()=>{if(!dialog&&!rename&&!commandSession&&current&&!busy)void closeChat(current);};
  navigateTabs.current=action=>{
    if(dialog||rename||commandSession||!tabs.length)return;
    const index=tabs.indexOf(selected??'');
    const target=typeof action==='number'?tabs[action===9?tabs.length-1:action-1]:tabs[(index+(action==='next'?1:-1)+tabs.length)%tabs.length];
    const session=sessions.find(s=>s.id===target);if(session)open(session);
  };
  useEffect(()=>window.harbor.onCloseSession(()=>closeSelected.current()),[]);
  useEffect(()=>window.harbor.onTabShortcut(action=>navigateTabs.current(action)),[]);
  const beginDrag=(event:DragEvent,id:string)=>{event.dataTransfer.setData('application/x-harbor-chat',id);event.dataTransfer.effectAllowed='move';setDragging(id);};
  const drop=(target:string,id:string,side:DropSide)=>{
    if(!sessions.some(s=>s.id===id)||id===target)return;
    setLayout(v=>dropPane(v,target,id,side));setTabs(v=>v.includes(id)?v:[...v,id]);setSelected(id);setSplitMenu(false);setDragging(undefined);
  };
  const visibleChat=(session:Session)=>(!hideClosed||chatActivity(session)!=='closed')&&session.launcher!=='shell'&&(session.hasMessages!==false||freshChats.has(session.id));
  const resumeChat=async(session:Session,restart=false)=>{setBusy(session.id);setContext(undefined);setMenu(false);try{const resumed=await window.harbor.resume(session.id,restart);setFreshChats(v=>new Set(v).add(resumed.id));open(resumed);}catch(error){report((error as Error).message);}finally{setBusy(undefined);}};
  const pin=async(session:Session)=>{setContext(undefined);setMenu(false);try{await window.harbor.update(session.id,{pinned:!session.pinned});}catch(error){report((error as Error).message);}};
  const chatMenu=(session:Session)=><><button role="menuitem" onClick={()=>{setCommandSession(session);setMenu(false);setContext(undefined);}}>View launch command…</button><button role="menuitem" onClick={()=>{setRename({kind:'chat',id:session.id,name:session.name});setContext(undefined);setMenu(false);}}>Rename chat…</button><button role="menuitem" onClick={()=>void pin(session)}><Pin size={14}/>{session.pinned?'Unpin':'Pin'} chat</button>{session.status==='closed'?<button role="menuitem" disabled={busy===session.id||session.externalActive} onClick={()=>void resumeChat(session)}><RefreshCw size={14}/>{session.launcher==='shell'?'Reopen terminal':'Resume chat'}</button>:<><button role="menuitem" disabled={busy===session.id} onClick={()=>void resumeChat(session,true)}><RefreshCw size={14}/>Reconnect & resume</button><button role="menuitem" disabled={busy===session.id} onClick={()=>void closeChat(session)}><X size={14}/>Close chat</button></>}<hr/><button role="menuitem" onClick={async()=>{setContext(undefined);setMenu(false);if(await window.harbor.forget(session.id)){removeFromWorkspace(session.id,true);}}}>Remove from sidebar…</button></>;
  const row=(session:Session)=>{const activity=chatActivity(session);return <button key={session.id} draggable onDragStart={event=>beginDrag(event,session.id)} onDragEnd={()=>setDragging(undefined)} className={`session-row chat-row ${selected===session.id?'selected':''} ${activity==='closed'?'closed-chat':''}`} onClick={()=>open(session)} onContextMenu={event=>{event.preventDefault();setContext({id:session.id,x:Math.min(event.clientX,innerWidth-250),y:Math.min(event.clientY,innerHeight-255)});}} title={`${launcherName[session.launcher]} · ${activityLabel[activity]}\n${session.activityDetail||session.cwd}`}><AgentIcon launcher={session.launcher} size={15}/><span className="chat-title">{session.name}</span>{session.pinned&&<Pin size={11}/>}<ChatStatusIcon session={session}/></button>;};
  const matches=(session:Session)=>!query||`${session.name} ${projects.find(p=>p.id===session.projectId)?.name}`.toLowerCase().includes(query.toLowerCase());
  const refreshButton=<button className="global-refresh icon-button" aria-label="Refresh all chats and status" title="Refresh all chats and status (⌘ R)" aria-keyshortcuts="Meta+R" disabled={refreshing} onClick={()=>void refreshAll()}><RefreshCw size={16} className={refreshing?'spin':''}/><kbd aria-hidden="true">⌘ R</kbd></button>;
  const peeking=collapsed&&peek&&snapshot?.preferences.sidebar.expandOnHover;
  return <div className="app-shell" style={{'--sidebar-width':`${sidebarWidth}px`} as CSSProperties}>
    <div className={`sidebar-dock ${collapsed?'is-collapsed':''} ${peeking?'is-peeking':''}`} onMouseEnter={()=>setPeek(true)} onMouseLeave={()=>setPeek(false)}>
      {collapsed&&<nav className="sidebar-rail" aria-label="Collapsed sidebar"><div className="traffic-spacer"/><button className="icon-button" aria-label="Expand sidebar" onClick={toggleSidebar}><PanelLeftOpen size={19}/></button><button className="rail-new" aria-label="New chat" onClick={()=>newChat()}><Plus size={20}/></button><div className="rail-sessions">{projects.map(p=><button key={p.id} className={`rail-session ${projectId===p.id?'active':''}`} title={p.name} aria-label={`Open project ${p.name}`} onClick={()=>{setProjectId(p.id);setSelected(undefined);}}><Folder size={19}/></button>)}</div><SidebarCost state={usage} onDetails={showUsage} collapsed/><button className="icon-button rail-preferences" aria-label="Preferences" onClick={()=>setDialog('preferences')}><Settings2 size={19}/></button></nav>}
      <aside className="sidebar" inert={collapsed&&!peeking?true:undefined}><div className="traffic-spacer"><button className="icon-button sidebar-toggle" aria-label={collapsed?'Pin sidebar open':'Collapse sidebar'} title="Toggle sidebar (⌘ B)" onClick={toggleSidebar}>{collapsed?<PanelLeftOpen size={18}/>:<PanelLeftClose size={18}/>}</button></div>
        <div className="brand"><div className="brand-icon"><Anchor size={23}/></div><span>harbor<span className="brand-period">.</span></span></div>
        <button className="new-session-button" onClick={()=>newChat()}><Plus size={17}/>New chat<kbd>⌘ N</kbd></button>
        <div className="search-box"><Search size={14}/><input ref={search} aria-label="Search chats" placeholder="Find a chat…" value={query} onChange={e=>setQuery(e.target.value)}/></div>
        <label className="hide-closed-toggle"><span>Hide all closed chats</span><input type="checkbox" role="switch" checked={hideClosed} onChange={event=>setHideClosed(event.target.checked)}/><span className="toggle-track" aria-hidden="true"><span/></span></label>
        <div className="projects-list"><div className="section-label">PROJECTS<button className="icon-button" aria-label="Add project" title="Add a project directory" onClick={()=>setDialog('project')}><FolderPlus size={15}/></button></div>
          {projects.map(p=>{const chats=sessions.filter(s=>s.projectId===p.id&&!s.archived&&visibleChat(s)&&matches(s)).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.updatedAt.localeCompare(a.updatedAt));return <section className="project-section" key={p.id}><div draggable onDragStart={event=>{event.dataTransfer.setData('application/x-harbor-project',p.id);event.dataTransfer.effectAllowed='move';}} onDragOver={event=>{if(event.dataTransfer.types.includes('application/x-harbor-project'))event.preventDefault();}} onDrop={event=>{event.preventDefault();const source=event.dataTransfer.getData('application/x-harbor-project');const ordered=[...(snapshot?.projects??[])];const from=ordered.findIndex(v=>v.id===source),to=ordered.findIndex(v=>v.id===p.id);if(from<0||to<0)return;ordered.splice(to,0,ordered.splice(from,1)[0]);void window.harbor.manageProjects(ordered.map(v=>({id:v.id,hidden:!!v.hidden}))).catch(error=>report(error.message));}} onContextMenu={event=>{event.preventDefault();setContext({kind:'project',id:p.id,x:Math.min(event.clientX,innerWidth-250),y:Math.min(event.clientY,innerHeight-150)});}} className={`project-heading ${projectId===p.id?'active':''}`}><button className="project-disclosure" aria-label={`${folded.includes(p.id)?'Expand':'Collapse'} project ${p.name}`} onClick={()=>setFolded(v=>v.includes(p.id)?v.filter(id=>id!==p.id):[...v,p.id])}>{folded.includes(p.id)?<ChevronRight size={13}/>:<ChevronDown size={13}/>}</button><button className="project-name" title={`${p.hostLabel}\n${p.cwd}`} onClick={()=>{setProjectId(p.id);setSelected(undefined);}}><Folder size={14}/><span>{p.name}</span></button>{p.connection!=='local'&&<span className="project-host" title={`${p.hostLabel}: ${reachability[JSON.stringify(p.connection)]===undefined?'Checking reachability':reachability[JSON.stringify(p.connection)]?'Reachable':'Unreachable'}`}><span className={`host-dot ${reachability[JSON.stringify(p.connection)]===undefined?'checking':reachability[JSON.stringify(p.connection)]?'reachable':'unreachable'}`}/>{p.hostLabel}</span>}<button className="icon-button project-add" aria-label={`New chat in ${p.name}`} title="New chat in this project" onClick={()=>newChat(p.id)}><Plus size={15}/></button></div>{(!folded.includes(p.id)||query)&&<div className="project-chats">{chats.slice(0,query?chats.length:(limits[p.id]??5)).map(row)}{!query&&chats.length>(limits[p.id]??5)&&<button className="show-more-chats" onClick={()=>setLimits(v=>({...v,[p.id]:(v[p.id]??5)+5}))}>Show more <span>({chats.length-(limits[p.id]??5)})</span></button>}{!query&&(limits[p.id]??5)>5&&<button className="show-more-chats" onClick={()=>setLimits(v=>({...v,[p.id]:5}))}>Show fewer</button>}{!chats.length&&<button className="project-empty" onClick={()=>newChat(p.id)}>Start a conversation</button>}</div>}</section>;})}
          {!projects.length&&<button className="sidebar-empty text-button" onClick={()=>setDialog('project')}>Add your first project</button>}
        </div>
        <div className="sidebar-footer"><SidebarCost state={usage} onDetails={showUsage}/><button className="preferences-button" aria-label="Preferences" onClick={()=>setDialog('preferences')}><Settings2 size={16}/>Preferences<kbd>⌘ ,</kbd></button></div>
      </aside>
      {!collapsed&&<ResizeHandle className="sidebar-resizer" label="Resize sidebar" axis="horizontal" value={sidebarWidth} onDrag={delta=>setSidebarWidth(v=>Math.max(200,Math.min(Math.min(600,innerWidth*.55),v+delta)))} onStep={delta=>setSidebarWidth(v=>Math.max(200,Math.min(600,v+delta*20)))} onReset={()=>setSidebarWidth(272)}/>}
    </div>

    <main className={`workspace ${current?'has-terminal':''}`}>
      {current?<><div className="session-toolbar"><div className="tab-strip">{tabs.map(id=>{const s=sessions.find(v=>v.id===id);return s&&<div key={id} data-tab-id={id} onMouseDown={event=>{if(event.button===1)event.preventDefault();}} onAuxClick={event=>{if(event.button===1){event.preventDefault();void closeChat(s);}}} draggable onDragStart={event=>beginDrag(event,id)} onDragEnd={()=>setDragging(undefined)} onDragOver={event=>{if(dragging){event.preventDefault();event.dataTransfer.dropEffect='move';}}} onDrop={event=>{event.preventDefault();const source=event.dataTransfer.getData('application/x-harbor-chat');const bounds=event.currentTarget.getBoundingClientRect();setTabs(v=>reorderTabs(v,source,id,event.clientX>bounds.x+bounds.width/2));setDragging(undefined);}} className={`tab ${id===selected?'active':''} ${dragging===id?'dragging':''}`}><button onClick={()=>open(s)}><AgentIcon launcher={s.launcher} size={14}/><span>{s.name}</span><ChatStatusIcon session={s}/></button><button className="tab-close" disabled={busy===s.id} aria-label={`Close chat ${s.name}`} title="Close chat and stop its tmux session" onClick={()=>void closeChat(s)}><X size={12}/></button></div>;})}<button className="icon-button tab-add" aria-label="New chat tab" onClick={()=>newChat(current.projectId)}><Plus size={16}/></button></div><div className="session-actions">{<div className="popover-anchor"><button className="icon-button" aria-label="Split view" title="Split view" onClick={()=>setSplitMenu(v=>!v)}><Columns2 size={16}/></button>{splitMenu&&<div className="popover split-picker">{sessions.filter(s=>s.id!==current.id&&visibleChat(s)).map(s=><button key={s.id} onClick={()=>drop(current.id,s.id,'right')}><AgentIcon launcher={s.launcher}/>{s.name}</button>)}</div>}</div>}<div className="popover-anchor"><button className="icon-button" aria-label="Chat actions" onClick={()=>setMenu(v=>!v)}><MoreHorizontal size={19}/></button>{menu&&<div className="popover actions-menu" role="menu">{chatMenu(current)}</div>}</div>{refreshButton}</div></div><h1 className="sr-only">{current.name}</h1>
        <div className="pane-workspace">{layout&&<PaneLayout node={layout} sessions={sessions} selected={selected} dragging={dragging} multiple={paneIds(layout).length>1} onFocus={id=>{setSelected(id);const p=sessions.find(s=>s.id===id)?.projectId;if(p)setProjectId(p);}} onDrop={drop} onResize={(id,ratio)=>setLayout(v=>v?resizePane(v,id,ratio):v)} onRemove={id=>removeFromWorkspace(id,false)} onDragStart={beginDrag} onDragEnd={()=>setDragging(undefined)} render={session=><div className="chat-slot" data-chat-slot={session.id}/>}/>}</div>
      </>:<><div className="overview-toolbar">{refreshButton}</div><div className="project-overview"><div className="project-overview-heading"><div className="eyebrow">{project?'PROJECT':'YOUR WORK, IN ONE PLACE'}</div><h1>{project?.name||'A home for your projects.'}</h1><p>{project?`${project.hostLabel} · ${project.cwd}`:'Add a directory to see its past conversations and start something new.'}</p></div>{project?<><div className="project-overview-actions"><button className="primary-button" onClick={()=>newChat(project.id)}><Plus size={16}/>New chat</button><button className="secondary-button" disabled={busy===project.id} onClick={()=>void refreshHistory(project.id)}><RefreshCw size={14} className={busy===project.id?'spin':''}/>Refresh past chats</button><button className="icon-button" aria-label="Rename project" onClick={()=>setRename({kind:'project',id:project.id,name:project.name})}><Settings2 size={16}/></button></div>{project.historyError&&<p className="form-error">Some history could not be loaded: {project.historyError}</p>}<div className="project-conversations">{sessions.filter(s=>s.projectId===project.id&&!s.archived&&visibleChat(s)).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.updatedAt.localeCompare(a.updatedAt)).map(row)}</div></>:<button className="primary-button" onClick={()=>setDialog('project')}><FolderPlus size={17}/>Add project</button>}</div></>}
      {tabs.map(id=>sessions.find(s=>s.id===id)).filter((session):session is Session=>!!session).map(session=><PersistentChat key={session.id} id={session.id} onFocus={()=>{setSelected(session.id);if(session.projectId)setProjectId(session.projectId);}} placement={current?layout:null}><ChatUsageBar session={session} active={!!current&&paneIds(layout).includes(session.id)} version={refreshVersion}/>{session.status==='closed'?<div className="closed-chat-panel"><AgentIcon launcher={session.launcher} size={30}/><h2>{session.name}</h2><p>{session.externalActive?'This conversation is running outside Harbor. Close it there and refresh this project to resume here.':session.launcher==='shell'?'This terminal is closed. Reopening starts a new shell in the project directory.':'This chat is closed. Resume to continue its saved conversation in a new terminal.'}</p><button className="primary-button" disabled={busy===session.id||session.externalActive} onClick={()=>void resumeChat(session)}>{busy===session.id?<LoaderCircle className="spin" size={16}/>:<RefreshCw size={16}/>} {session.launcher==='shell'?'Reopen terminal':'Resume chat'}</button><ChatPreviewPanel session={session} version={refreshVersion}/>{session.imported&&<small>Imported from {launcherName[session.launcher]} history</small>}</div>:<TerminalPane active={selected===session.id} session={session} preferences={snapshot!.preferences.terminal} onReconnect={()=>void resumeChat(session,true)} report={report}/>}</PersistentChat>)}
    </main>
    {context?.kind==='project'&&projects.find(p=>p.id===context.id)&&<div className="popover chat-context-menu" role="menu" aria-label="Project actions" style={{left:context.x,top:context.y}} onClick={event=>event.stopPropagation()}><button role="menuitem" onClick={()=>{const id=context.id;setContext(undefined);void window.harbor.openProjectInCursor(id).catch(error=>report(error.message));}}><ExternalLink size={14}/>Open in Cursor</button><button role="menuitem" onClick={()=>{const p=projects.find(p=>p.id===context.id)!;setRename({kind:'project',id:p.id,name:p.name});setContext(undefined);}}>Rename project…</button></div>}
    {context&&!context.kind&&sessions.find(s=>s.id===context.id)&&<div className="popover chat-context-menu" role="menu" style={{left:context.x,top:context.y}} onClick={e=>e.stopPropagation()}>{chatMenu(sessions.find(s=>s.id===context.id)!)}</div>}
    {toast&&<div className="toast" role="alert">{toast}<button aria-label="Dismiss message" onClick={()=>setToast('')}><X size={15}/></button></div>}
    {dialog==='preferences'&&snapshot&&<PreferencesDialog initial={snapshot.preferences} projects={snapshot.projects} initialTab={preferencesTab} usage={usage} onClose={()=>{setDialog(null);setPreferencesTab('hosts');}}/>}
    {dialog==='project'&&snapshot&&<ProjectDialog snapshot={snapshot} onPreferences={()=>setDialog('preferences')} onClose={()=>setDialog(null)} onCreated={p=>{setProjectId(p.id);setSelected(undefined);setDialog(null);loadedHistory.current.add(p.id);}}/>}
    {dialog==='chat'&&project&&<ChatDialog project={project} defaults={snapshot!.preferences.agents} onClose={()=>setDialog(null)} onCreated={s=>{setFreshChats(v=>new Set(v).add(s.id));setDialog(null);open(s);}}/>}
    {commandSession&&<LaunchCommandDialog session={commandSession} onClose={()=>setCommandSession(undefined)}/>}
    {rename&&<RenameDialog initial={rename.name} kind={rename.kind} onClose={()=>setRename(undefined)} onSave={async name=>{if(rename.kind==='chat')await window.harbor.update(rename.id,{name});else await window.harbor.updateProject(rename.id,name);setRename(undefined);}}/>}
  </div>;
}
