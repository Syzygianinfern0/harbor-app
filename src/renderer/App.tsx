import { useCallback, useEffect, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { Anchor, Bell, Check, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Columns2, ExternalLink, Eye, EyeOff, Folder, FolderPlus, Layers, LoaderCircle, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pin, Plus, RefreshCw, Search, Settings2, StickyNote, Trash2, X } from 'lucide-react';
import type { Launcher, Project, Session, Snapshot, TabShortcut } from '../shared/types';
import { AgentIcon } from './AgentIcon';
import { ChatStatusIcon, StatusIcon, UnreadDot } from './ChatStatusIcon';
import { useChatView } from './useChatView';
import { activityLabel, chatActivity, type ChatStatus } from '../shared/chatStatus';
import { chatVisible, nextReveal } from '../shared/chatFilter';
import { ChatPreviewPanel } from './ChatPreviewPanel';
import { ChatUsageBar, SidebarCost, useHostUsage } from './UsagePanel';
import { SidebarUpdateButton, useAppUpdate } from './AppUpdate';
import { PersistentChat } from './PersistentChat';
import { PaneLayout } from './PaneLayout';
import { ResizeHandle } from './ResizeHandle';
import { dropPane, leaf, paneIds, removePane, resizePane, restorePanes, type DropSide, type PaneNode } from '../shared/panes';
import { groupShortcut, tabShortcut, type GroupShortcut } from '../shared/shortcuts';
import { addToGroup, assignProjectColors, createGroup, groupEntry, groupKeys, groupTabs, isCollapsed, layoutTabs, pruneGroups, removeFromGroups, restoreTabGroups, rollup, setCollapsed as setGroupCollapsed, stripTabs, ungroup, updateGroup, GROUP_COLORS, type TabGroups } from '../shared/tabGroups';
import { TabStrip, groupInfo } from './TabStrip';
import { GroupsOverview } from './GroupsOverview';
import { foldView, splitFor } from '../shared/folding';
import { liveParked, restoreParked, showTab, splitSets } from '../shared/splits';
import { LaunchCommandDialog } from './LaunchCommandDialog';
import { TerminalPane } from './TerminalPane';
import { PreferencesDialog } from './PreferencesDialog';
import { ProjectDialog, ChatDialog, RenameDialog, DeleteProjectDialog } from './ProjectDialogs';
import { ChatNoteEditor, ChatNoteMarker, type NoteAnchor } from './ChatNote';
import { ProjectNotes } from './ProjectNotes';
import { useListReorder } from './useDropCue';
import { ForkChatItem } from './ForkChat';
import { forkBlocker, placeFork } from '../shared/fork';

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
  // Splits switched away from stay parked, linked in the strip, until one of their tabs brings them back.
  const [parkedState,setParked]=useState<PaneNode[]>([]);const parked=liveParked(parkedState,layout,tabs);
  useEffect(()=>{if(parked!==parkedState)setParked(parked);},[parked]);
  const [hydrated,setHydrated]=useState(false);
  const [sidebarWidth,setSidebarWidth]=useState(()=>Math.max(200,Math.min(600,saved('harbor.sidebarWidth',272))));
  const [dragging,setDragging]=useState<string>();
  const [freshChats,setFreshChats]=useState<Set<string>>(()=>new Set());
  const workspaceRef=useRef({selected,tabs,layout,parked});workspaceRef.current={selected,tabs,layout,parked};
  const navigateTabs=useRef<(action:TabShortcut)=>void>(()=>{});
  const groupAction=useRef<(action:GroupShortcut)=>void>(()=>{});
  const [groups,setGroups]=useState<TabGroups>(()=>restoreTabGroups(saved('harbor.tabGroups',null)));
  const [selection,setSelection]=useState<Set<string>>(()=>new Set());
  const [groupsMenu,setGroupsMenu]=useState(false);
  const pendingRename=useRef<string>(undefined);
  const chatShortcut=useRef<(index:number)=>void>(()=>{});
  const refreshLock=useRef(false);
  const refreshAction=useRef<()=>void>(()=>{});
  const [refreshing,setRefreshing]=useState(false);
  const [refreshVersion,setRefreshVersion]=useState(0);
  const usage=useHostUsage(refreshVersion,JSON.stringify(snapshot?.preferences.hosts??[]));
  const appUpdate=useAppUpdate();
  const [preferencesTab,setPreferencesTab]=useState<'hosts'|'usage'>('hosts');
  const showUsage=()=>{setPreferencesTab('usage');setDialog('preferences');};
  const refreshAll=async()=>{if(refreshLock.current)return;refreshLock.current=true;setRefreshing(true);try{await window.harbor.refresh();const data=await window.harbor.snapshot();await Promise.all(data.projects.map(p=>window.harbor.importHistory(p.id)));setReachability(await window.harbor.checkReachability());const latest=await window.harbor.snapshot();setSnapshot(latest);setRefreshVersion(v=>v+1);const failures=latest.projects.filter(p=>p.historyError);setToast(failures.length?`Refreshed with errors: ${failures.map(p=>p.name+': '+p.historyError).join('; ')}`:'Chats and status are up to date.');}catch(error){report((error as Error).message);}finally{refreshLock.current=false;setRefreshing(false);}};
  refreshAction.current=()=>void refreshAll();
  useEffect(()=>window.harbor.onRefresh(()=>void refreshAll()),[refreshing]);
  const [query,setQuery]=useState('');
  const [hideClosed,setHideClosed]=useState(()=>saved('harbor.hideClosed',false));
  // The project whose name was clicked shows its closed chats despite the toggle, only while its page is showing; opening a chat or flipping the toggle ends it.
  const [reveal,setReveal]=useState<string>();
  // Set by clicking a project name so its page shows even when no tab is left in the strip (focus mode, everything folded).
  const [projectPage,setProjectPage]=useState(false);
  const [notesOnly,setNotesOnly]=useState(()=>saved('harbor.notesOnly',false));
  const [commandSession,setCommandSession]=useState<Session>();
  useEffect(()=>{localStorage.setItem('harbor.hideClosed',JSON.stringify(hideClosed));},[hideClosed]);
  useEffect(()=>{localStorage.setItem('harbor.notesOnly',JSON.stringify(notesOnly));},[notesOnly]);
  const [limits,setLimits]=useState<Record<string,number>>({});
  const [reachability,setReachability]=useState<Record<string,boolean>>({});
  const projectConnections=JSON.stringify(projectsForReachability(snapshot));
  useEffect(()=>{let cancelled=false;let checking=false;const check=async()=>{if(checking)return;checking=true;try{const result=await window.harbor.checkReachability();if(!cancelled)setReachability(result);}catch{}finally{checking=false;}};void check();const timer=setInterval(()=>void check(),30000);return()=>{cancelled=true;clearInterval(timer);};},[projectConnections]);
  const [dialog,setDialog]=useState<'project'|'chat'|'preferences'|'delete-project'|null>(null);
  const [deleting,setDeleting]=useState<string>();
  // Hidden projects are listed, dimmed, below the others while this is on.
  const [showHidden,setShowHidden]=useState(false);
  const [rename,setRename]=useState<{kind:'chat'|'project';id:string;name:string}>();
  const [context,setContext]=useState<{id:string;x:number;y:number;kind?:'project'|'tab'|'group';rename?:boolean}>(); const [noteEditor,setNoteEditor]=useState<NoteAnchor>();
  const [menu,setMenu]=useState(false); const [splitMenu,setSplitMenu]=useState(false);
  const [busy,setBusy]=useState<string>(); const [toast,setToast]=useState('');
  const [collapsed,setCollapsed]=useState(()=>saved('harbor.sidebarCollapsed',false));
  const [peek,setPeek]=useState(false); const [folded,setFolded]=useState<string[]>(()=>saved('harbor.foldedProjects',[]));
  const closeSelected=useRef<()=>void>(()=>{});
  const loadedHistory=useRef(new Set<string>()); const search=useRef<HTMLInputElement>(null);
  const report=useCallback((message:string)=>setToast(message.replace(/^Error invoking remote method '[^']+': Error: /,'')),[]);
  const newChat=useCallback((id?:string)=>{if(id) setProjectId(id); setDialog(id||projectRef.current?'chat':'project');},[]);
  // Hover intent: a short delay before peeking lets the pointer reach the rail's Expand button, and a grace
  // period before hiding survives macOS title-bar drag regions, which swallow mouse events on the way to the toggle.
  const peekTimer=useRef<ReturnType<typeof setTimeout>>(undefined);
  const schedulePeek=(value:boolean,delay:number)=>{clearTimeout(peekTimer.current);peekTimer.current=setTimeout(()=>setPeek(value),delay);};
  const hoverDock=(event:{target:EventTarget})=>{if((event.target as Element).closest?.('.rail-expand'))schedulePeek(peek,0);else if(!peek)schedulePeek(true,150);else clearTimeout(peekTimer.current);};
  useEffect(()=>()=>clearTimeout(peekTimer.current),[]);
  const toggleSidebar=()=>{clearTimeout(peekTimer.current);setCollapsed(v=>!v);setPeek(false);};
  const sessions=snapshot?.sessions??[]; const projects=(snapshot?.projects??[]).filter(p=>!p.hidden); const hiddenProjects=(snapshot?.projects??[]).filter(p=>p.hidden);
  useEffect(()=>{if(!hiddenProjects.length)setShowHidden(false);},[hiddenProjects.length]);
  useEffect(()=>{if(hydrated&&!projects.some(p=>p.id===projectId))setProjectId(projects[0]?.id||'');},[snapshot?.projects,hydrated,projectId]);
  const current=sessions.find(s=>s.id===selected);
  const project=projects.find(p=>p.id===projectId);
  const openTabs=tabs.filter(id=>sessions.some(s=>s.id===id));
  const projectOf=(id:string)=>sessions.find(s=>s.id===id)?.projectId;
  const tabSplits=splitSets(layout,parked);const tabLayout=layoutTabs(openTabs,groups,projectOf,projects.map(p=>p.id),tabSplits);
  const arrangedTabs=tabLayout.segments.flatMap(s=>s.kind==='tab'?[s.id]:s.tabs);
  const visibleTabs=stripTabs(tabLayout.segments,groups,selected);
  const selectedKey=selected?tabLayout.keyOf.get(selected):undefined;
  const showOverview=!current&&!projectPage&&openTabs.length>0&&visibleTabs.length===0;
  const projectColor=(id?:string)=>(id&&groups.projectColors[id])||GROUP_COLORS[0].value;
  const colorSwatches=(label:string,current:string,pick:(value:string)=>void)=><div className="group-colors" role="group" aria-label={label}>{GROUP_COLORS.map(c=><button key={c.value} role="menuitemradio" aria-checked={current===c.value} aria-label={c.name} title={c.name} className={current===c.value?'current':''} style={{'--swatch':c.value} as CSSProperties} onClick={()=>pick(c.value)}/>)}</div>;
  const liveChats=(id:string)=>sessions.filter(s=>s.projectId===id&&!s.archived&&s.launcher!=='shell'&&!['closed','external'].includes(chatActivity(s)));
  const open=useCallback((session:Session)=>{const w=workspaceRef.current,view=showTab(w.layout,w.parked,session.id);setLayout(view.layout);if(view.parked!==w.parked)setParked(view.parked);setSelected(session.id);if(session.projectId)setProjectId(session.projectId);setTabs(v=>v.includes(session.id)?v:[...v,session.id]);setMenu(false);setContext(undefined);},[]);
  const refreshHistory=async(id:string)=>{setBusy(id);try{await window.harbor.importHistory(id);}catch(error){report((error as Error).message);}finally{setBusy(undefined);}};
  useEffect(()=>{
    window.harbor.snapshot().then(data=>{setSnapshot(data);const restored=saved<string[]>('harbor.tabs',[]).filter(id=>data.sessions.some(s=>s.id===id));setTabs(restored);const tree=restorePanes(saved('harbor.layout',null),restored)??(restored[0]?leaf(restored[0]):null);setLayout(tree);setParked(restoreParked(saved('harbor.splits',[]),restored,new Set(paneIds(tree))));const active=saved('harbor.selected','');setSelected(paneIds(tree).includes(active)?active:paneIds(tree)[0]);setHydrated(true);setProjectId(saved('harbor.project','')||data.sessions.find(s=>s.id===restored[0])?.projectId||data.projects[0]?.id||'');}).catch(e=>report(e.message));
    const off=window.harbor.onSnapshot(setSnapshot); const offNew=window.harbor.onNewSession(()=>newChat());
    const offPrefs=window.harbor.onPreferences(()=>setDialog('preferences'));
    const offOpen=window.harbor.onOpenSession(id=>{void window.harbor.snapshot().then(data=>{const session=data.sessions.find(s=>s.id===id);if(session)open(session);});});
    return()=>{off();offNew();offPrefs();offOpen();};
  },[newChat,open,report]);
  useEffect(()=>{if(project && !loadedHistory.current.has(project.id)){loadedHistory.current.add(project.id);void refreshHistory(project.id);}},[project?.id]);
  useEffect(()=>{if(!hydrated)return;localStorage.setItem('harbor.tabs',JSON.stringify(tabs));},[tabs,hydrated]);
  useEffect(()=>{if(!hydrated)return;localStorage.setItem('harbor.layout',JSON.stringify(layout));localStorage.setItem('harbor.selected',JSON.stringify(selected));localStorage.setItem('harbor.splits',JSON.stringify(parked));},[layout,selected,parked,hydrated]);
  useEffect(()=>{localStorage.setItem('harbor.sidebarWidth',JSON.stringify(sidebarWidth));},[sidebarWidth]);
  useEffect(()=>{if(hydrated)localStorage.setItem('harbor.tabGroups',JSON.stringify(groups));},[groups,hydrated]);
  useEffect(()=>{if(hydrated)setGroups(v=>pruneGroups(v,tabs));setSelection(v=>[...v].every(id=>tabs.includes(id))?v:new Set([...v].filter(id=>tabs.includes(id))));},[tabs,hydrated]);
  useEffect(()=>{if(snapshot)setGroups(v=>assignProjectColors(v,snapshot.projects.map(p=>p.id)));},[snapshot?.projects]);
  useEffect(()=>{localStorage.setItem('harbor.project',JSON.stringify(projectId));},[projectId]);
  useEffect(()=>{localStorage.setItem('harbor.sidebarCollapsed',JSON.stringify(collapsed));},[collapsed]);
  useEffect(()=>{localStorage.setItem('harbor.foldedProjects',JSON.stringify(folded));},[folded]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),10000);return()=>clearTimeout(timer);},[toast]);
  useEffect(()=>{
    if(!dialog&&!rename&&!commandSession)return;const previous=document.activeElement as HTMLElement|null;
    (document.querySelector<HTMLElement>('.chat-modal input, .rename-modal input, .delete-project-modal .secondary-button') ?? document.querySelector<HTMLElement>('.modal input, .modal select, .modal textarea') ?? document.querySelector<HTMLElement>('.modal .primary-button'))?.focus();
    return()=>{if(previous?.isConnected)previous.focus();};
  },[dialog,rename,commandSession]);
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){setDialog(null);setRename(undefined);setCommandSession(undefined);setMenu(false);setSplitMenu(false);setContext(undefined);setGroupsMenu(false);setSelection(v=>v.size?new Set():v);}
      if(dialog||rename||commandSession){
        const launcherAction=dialog==='chat'?tabShortcut(event):undefined;if(typeof launcherAction==='number'){event.preventDefault();chatShortcut.current(launcherAction);return;}
        if(event.key==='Tab'){const fields=[...document.querySelectorAll<HTMLElement>('.modal button:not(:disabled),.modal input,.modal select,.modal textarea')].filter(e=>e.offsetParent!==null);const first=fields[0],last=fields.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
        return;
      }
      if(event.metaKey&&event.key.toLowerCase()==='w'){event.preventDefault();closeSelected.current();}
      const groupKey=groupShortcut(event);if(groupKey!==undefined){event.preventDefault();groupAction.current(groupKey);return;}
      const tabAction=tabShortcut(event);if(tabAction!==undefined){event.preventDefault();navigateTabs.current(tabAction);return;}
      if(event.metaKey&&event.key.toLowerCase()==='r'){event.preventDefault();refreshAction.current();return;}
      if(event.metaKey&&['n','t'].includes(event.key.toLowerCase())){event.preventDefault();newChat();}
      if(event.metaKey&&event.key.toLowerCase()==='b'){event.preventDefault();toggleSidebar();}
      if(event.metaKey&&['k','f'].includes(event.key.toLowerCase())){event.preventDefault();setCollapsed(false);requestAnimationFrame(()=>search.current?.focus());}
    };
    const dismiss=()=>{setContext(undefined);setGroupsMenu(false);};window.addEventListener('keydown',key);window.addEventListener('click',dismiss);window.addEventListener('blur',dismiss);
    return()=>{window.removeEventListener('keydown',key);window.removeEventListener('click',dismiss);window.removeEventListener('blur',dismiss);};
  },[dialog,rename,commandSession]);
  const removeFromWorkspace=(id:string,closeTab:boolean)=>{
    const state=workspaceRef.current;
    const remaining=closeTab?state.tabs.filter(tab=>tab!==id):state.tabs;
    let tree=removePane(state.layout,id);
    let active=state.selected===id?paneIds(tree)[0]:state.selected;
    const shown=visibleTabs.filter(tab=>tab!==id&&remaining.includes(tab));
    if(!tree&&closeTab&&shown.length){const at=Math.max(0,visibleTabs.indexOf(id));active=shown[Math.min(at,shown.length-1)];tree=leaf(active);}
    if(closeTab)setTabs(remaining);setLayout(tree);setSelected(active);
  };
  const closeChat=async(session:Session)=>{setBusy(session.id);setMenu(false);setContext(undefined);try{if(!await window.harbor.terminate(session.id))return;removeFromWorkspace(session.id,true);setFreshChats(v=>{const next=new Set(v);next.delete(session.id);return next;});}catch(error){report((error as Error).message);}finally{setBusy(undefined);}};
  closeSelected.current=()=>{if(!dialog&&!rename&&!commandSession&&current&&!busy)void closeChat(current);};
  navigateTabs.current=action=>{
    if(dialog==='chat'&&typeof action==='number'){chatShortcut.current(action);return;}
    const shown=visibleTabs;if(dialog||rename||commandSession||!shown.length)return;
    const index=shown.indexOf(selected??'');
    const target=typeof action==='number'?shown[action===9?shown.length-1:action-1]:shown[(index+(action==='next'?1:-1)+shown.length)%shown.length];
    const session=sessions.find(s=>s.id===target);if(session)open(session);
  };
  // Folding puts a group away: its panes leave the view, which moves to the most recently used chat still shown.
  const recent=useRef<string[]>([]);
  useEffect(()=>{if(selected)setProjectPage(false);},[selected]);
  useEffect(()=>{if(selected)recent.current=[selected,...recent.current.filter(id=>id!==selected)].slice(0,100);},[selected]);
  const foldMemory=useRef<{keys:string;before:PaneNode|null;after:PaneNode|null;selected?:string}>(undefined);
  const savedSplits=useRef<Record<string,PaneNode>>({});
  const foldGroups=(requested:string[])=>{
    // In focus mode only the open group can fold; its stored fold flag is left alone.
    const keys=requested.filter(k=>!isCollapsed(groups,k,selectedKey));if(!keys.length)return;
    const next=groups.focus?groups:keys.reduce((g,k)=>setGroupCollapsed(g,k,true),groups);
    const hidden=keys.flatMap(k=>groupTabs(tabLayout.segments,k));
    for(const k of keys){const split=splitFor(layout,groupTabs(tabLayout.segments,k));if(split)savedSplits.current[k]=split;}
    const shown=stripTabs(layoutTabs(openTabs,next,projectOf,projects.map(p=>p.id)).segments,next,undefined);
    let view=foldView(layout,selected,hidden,shown,recent.current);
    // A folded group's split is parked with it, so its tabs stay linked and bring it back; a chat shown in its place brings its own split.
    const kept=keys.map(k=>splitFor(layout,groupTabs(tabLayout.segments,k))).filter((s):s is PaneNode=>paneIds(s).length>1);
    const moved=view.selected&&!paneIds(layout).includes(view.selected)?showTab(null,parked,view.selected):undefined;if(moved)view={...view,layout:moved.layout};
    if(kept.length||moved)setParked([...(moved?.parked??parked),...kept]);
    foldMemory.current={keys:JSON.stringify([...keys].sort()),before:layout,after:view.layout,selected};
    setGroups(next);setLayout(view.layout);setSelected(view.selected);
  };
  const unfoldGroups=(requested:string[])=>{
    const keys=requested.filter(k=>isCollapsed(groups,k,selectedKey));if(!keys.length)return;
    if(!groups.focus)setGroups(v=>keys.reduce((g,k)=>setGroupCollapsed(g,k,false),v));
    else if(current){const entry=sessions.find(s=>s.id===groupEntry(groups,tabLayout.segments,keys[0]));if(entry)open(entry);return;}
    const memory=foldMemory.current;foldMemory.current=undefined;
    // Unfolding right after folding is an exact undo.
    if(memory&&memory.keys===JSON.stringify([...keys].sort())&&JSON.stringify(memory.after)===JSON.stringify(layout)&&paneIds(memory.before).every(id=>openTabs.includes(id))){setLayout(memory.before);setSelected(memory.selected);return;}
    if(current)return;
    // From the overview, unfolding brings the group back into view with its split.
    const key=keys[0];const split=savedSplits.current[key];const entry=groupEntry(groups,tabLayout.segments,key);
    if(split&&paneIds(split).every(id=>openTabs.includes(id))){const ids=paneIds(split);setLayout(split);setSelected(entry&&ids.includes(entry)?entry:ids[0]);}
    else if(entry){setLayout(leaf(entry));setSelected(entry);}
  };
  const toggleGroup=(key:string)=>isCollapsed(groups,key,selectedKey)?unfoldGroups([key]):foldGroups([key]);
  // Opening a chat from a folded group (sidebar, bell, ⌘J) unfolds that group.
  useEffect(()=>{if(!selected||groups.focus)return;const key=tabLayout.keyOf.get(selected);if(key&&isCollapsed(groups,key,key))setGroups(v=>setGroupCollapsed(v,key,false));},[selected]);
  const openGroup=(key:string)=>{if(!current&&isCollapsed(groups,key,selectedKey)){unfoldGroups([key]);return;}if(!groups.focus)setGroups(v=>setGroupCollapsed(v,key,false));const entry=sessions.find(s=>s.id===groupEntry(groups,tabLayout.segments,key));if(entry)open(entry);};
  const makeGroup=(ids:string[])=>{
    if(!ids.length)return;const shownProjects=groupKeys(tabLayout.segments).filter(k=>k.startsWith('p:')).map(k=>groups.projectColors[k.slice(2)]).filter(Boolean);
    const created=createGroup(groups,ids,shownProjects);setGroups(created.state);setSelection(new Set());setContext(undefined);pendingRename.current=`g:${created.id}`;
  };
  groupAction.current=action=>{
    if(dialog||rename||commandSession)return;
    if(action==='group-selected'){makeGroup(selection.size?[...selection]:selected&&tabs.includes(selected)?[selected]:[]);return;}
    if(action==='toggle-project-groups'){setToast(groups.byProject?'Project groups off. Custom groups are unchanged.':'Tabs grouped by project.');setGroups(v=>({...v,byProject:!v.byProject}));return;}
    if(action==='next-attention'){
      const waiting=(s:Session)=>chatActivity(s)==='attention';const ordered=[...arrangedTabs.map(id=>sessions.find(s=>s.id===id)!),...sessions.filter(s=>!tabs.includes(s.id)&&!s.archived)].filter(s=>s&&waiting(s));
      if(!ordered.length){setToast('No chat needs input right now.');return;}
      const at=ordered.findIndex(s=>s.id===selected);const next=ordered[(at+1)%ordered.length];const key=tabLayout.keyOf.get(next.id);if(key&&!groups.focus)setGroups(v=>setGroupCollapsed(v,key,false));open(next);return;
    }
    const keys=groupKeys(tabLayout.segments);if(!keys.length)return;
    if(typeof action==='number'){if(keys[action-1])openGroup(keys[action-1]);return;}
    const at=keys.indexOf(selectedKey??'');const dir=action==='next-group'?1:-1;
    openGroup(at<0?(dir>0?keys[0]:keys.at(-1)!):keys[(at+dir+keys.length)%keys.length]);
  };
  const moveProject=(source:string,target:string,after:boolean)=>{
    const ordered=[...(snapshot?.projects??[])];const from=ordered.findIndex(v=>v.id===source);if(from<0)return;const [moved]=ordered.splice(from,1);
    const to=ordered.findIndex(v=>v.id===target);if(to<0)return;ordered.splice(to+(after?1:0),0,moved);
    void window.harbor.manageProjects(ordered.map(v=>({id:v.id,hidden:!!v.hidden}))).catch(error=>report(error.message));
  };
  const projectDrag=useListReorder('application/x-harbor-project',projects.map(p=>p.id),moveProject);
  useEffect(()=>{if(!selected)return;const key=tabLayout.keyOf.get(selected);if(key&&groups.lastActive[key]!==selected)setGroups(v=>({...v,lastActive:{...v.lastActive,[key]:selected}}));},[selected,tabLayout.keyOf.get(selected??'')]);
  useEffect(()=>{const key=pendingRename.current;if(!key)return;pendingRename.current=undefined;const chip=document.querySelector(`[data-group-key="${CSS.escape(key)}"]`);if(!chip)return;chip.scrollIntoView({block:'nearest',inline:'nearest'});const r=chip.getBoundingClientRect();setContext({kind:'group',id:key,x:Math.min(r.left,innerWidth-250),y:r.bottom+6,rename:true});},[groups]);
  useEffect(()=>window.harbor.onCloseSession(()=>closeSelected.current()),[]);
  useEffect(()=>window.harbor.onTabShortcut(action=>navigateTabs.current(action)),[]);
  const beginDrag=(event:DragEvent,id:string)=>{event.dataTransfer.setData('application/x-harbor-chat',id);event.dataTransfer.effectAllowed='move';setDragging(id);};
  const drop=(target:string,id:string,side:DropSide)=>{
    if(!sessions.some(s=>s.id===id)||id===target)return;
    setLayout(v=>dropPane(v,target,id,side));setTabs(v=>v.includes(id)?v:[...v,id]);setSelected(id);setSplitMenu(false);setDragging(undefined);
  };
  const revealed=!current&&reveal===projectId?reveal:undefined;
  const visibleChat=(session:Session,shown=revealed)=>chatVisible(session,{hideClosed,notesOnly,reveal:shown,fresh:freshChats});
  // Showing a project's page also expands it in the sidebar. If nothing from it gets opened before moving on, it folds back.
  const autoExpanded=useRef<string>(undefined);
  const openProject=(id:string)=>{
    const previous=autoExpanded.current!==id?autoExpanded.current:undefined;
    if(folded.includes(id)||previous){setFolded(v=>[...new Set([...v.filter(f=>f!==id),...(previous?[previous]:[])])]);autoExpanded.current=folded.includes(id)?id:undefined;}
    setProjectPage(true);setReveal(v=>nextReveal(v,id,projectId===id&&!current));setProjectId(id);setSelected(undefined);
  };
  useEffect(()=>{
    const id=autoExpanded.current;if(!id)return;
    const opened=selected?sessions.find(s=>s.id===selected)?.projectId:undefined;
    if(selected||projectId!==id){autoExpanded.current=undefined;if(opened!==id)setFolded(v=>v.includes(id)?v:[...v,id]);}
  },[selected,projectId]);
  const toggleFolded=(id:string)=>{if(autoExpanded.current===id)autoExpanded.current=undefined;setFolded(v=>v.includes(id)?v.filter(f=>f!==id):[...v,id]);};
  const setProjectHidden=async(id:string,hidden:boolean)=>{
    const all=snapshot?.projects??[];const name=all.find(p=>p.id===id)?.name;
    await window.harbor.manageProjects(all.map(v=>({id:v.id,hidden:v.id===id?hidden:!!v.hidden})));
    if(hidden)setToast(`Hid “${name}”. Show it again with the eye button next to PROJECTS, or in Preferences → Projects.`);
  };
  const deleteProject=async(id:string)=>{
    await window.harbor.manageProjects((snapshot?.projects??[]).filter(v=>v.id!==id).map(v=>({id:v.id,hidden:!!v.hidden})));
    setFolded(v=>v.filter(f=>f!==id));
  };
  const resumeChat=async(session:Session,restart=false)=>{setBusy(session.id);setContext(undefined);setMenu(false);try{const resumed=await window.harbor.resume(session.id,restart);setFreshChats(v=>new Set(v).add(resumed.id));open(resumed);}catch(error){report((error as Error).message);}finally{setBusy(undefined);}};
  // A fork opens beside its original: next tab, same custom group, and a split to its right (the original is shown first if it was off screen).
  const forkChat=async(session:Session)=>{setContext(undefined);setMenu(false);const blocked=forkBlocker(session);if(blocked){report(blocked);return;}setBusy(session.id);try{const fork=await window.harbor.fork(session.id);setFreshChats(v=>new Set(v).add(fork.id));const group=groups.custom.find(g=>g.members.includes(session.id));if(group)setGroups(v=>addToGroup(v,group.id,[fork.id]));const w=workspaceRef.current,view=showTab(w.layout,w.parked,session.id);if(view.parked!==w.parked)setParked(view.parked);const {tabs:placed,layout:split}=placeFork(w.tabs,view.layout,session.id,fork.id);setLayout(split!);setSelected(fork.id);if(fork.projectId)setProjectId(fork.projectId);setTabs(placed);}catch(error){report((error as Error).message);}finally{setBusy(undefined);}};
  const pin=async(session:Session)=>{setContext(undefined);setMenu(false);try{await window.harbor.update(session.id,{pinned:!session.pinned});}catch(error){report((error as Error).message);}};
  const chatMenu=(session:Session)=><><button role="menuitem" onClick={()=>{setCommandSession(session);setMenu(false);setContext(undefined);}}>View launch command…</button><button role="menuitem" onClick={()=>{setRename({kind:'chat',id:session.id,name:session.name});setContext(undefined);setMenu(false);}}>Rename chat…</button><button role="menuitem" onClick={()=>{setNoteEditor(context&&(!context.kind||context.kind==='tab')?{kind:'chat',id:session.id,x:context.x,y:context.y}:{kind:'chat',id:session.id,x:innerWidth/2-160,y:innerHeight/3});setContext(undefined);setMenu(false);}}><StickyNote size={14}/>{session.note?'Edit note…':'Add note…'}</button><button role="menuitem" onClick={()=>void pin(session)}><Pin size={14}/>{session.pinned?'Unpin':'Pin'} chat</button>{session.status==='closed'?<button role="menuitem" disabled={busy===session.id||session.externalActive} onClick={()=>void resumeChat(session)}><RefreshCw size={14}/>{session.launcher==='shell'?'Reopen terminal':'Resume chat'}</button>:<><button role="menuitem" disabled={busy===session.id} onClick={()=>void resumeChat(session,true)}><RefreshCw size={14}/>Reconnect & resume</button><button role="menuitem" disabled={busy===session.id} onClick={()=>void closeChat(session)}><X size={14}/>Close chat</button></>}<ForkChatItem session={session} busy={busy===session.id} onFork={s=>void forkChat(s)}/><hr/><button role="menuitem" onClick={async()=>{setContext(undefined);setMenu(false);if(await window.harbor.forget(session.id)){removeFromWorkspace(session.id,true);}}}>Remove from sidebar…</button></>;
  const row=(session:Session)=>{const activity=chatActivity(session);return <button key={session.id} draggable onDragStart={event=>beginDrag(event,session.id)} onDragEnd={()=>setDragging(undefined)} className={`session-row chat-row ${dragging===session.id?'drag-source':''} ${selected===session.id?'selected':''} ${activity==='closed'?'closed-chat':''} ${tabs.includes(session.id)?'open-tab':''}`} style={{'--project-color':projectColor(session.projectId)} as CSSProperties} onClick={()=>open(session)} onContextMenu={event=>{event.preventDefault();setContext({id:session.id,x:Math.min(event.clientX,innerWidth-250),y:Math.min(event.clientY,innerHeight-255)});}} title={`${launcherName[session.launcher]} · ${activityLabel[activity]}${tabs.includes(session.id)?' · open as a tab':''}\n${session.activityDetail||session.cwd}`}><AgentIcon launcher={session.launcher} size={15}/><span className="chat-title">{session.name}</span><ChatNoteMarker item={session} onEdit={setNoteEditor}/>{session.pinned&&<Pin size={11}/>}<ChatStatusIcon session={session}/></button>;};
  const matches=(session:Session)=>!query||`${session.name} ${projects.find(p=>p.id===session.projectId)?.name}`.toLowerCase().includes(query.toLowerCase());
  const refreshButton=<button className="global-refresh icon-button" aria-label="Refresh all chats and status" title="Refresh all chats and status (⌘ R)" aria-keyshortcuts="Meta+R" disabled={refreshing} onClick={()=>void refreshAll()}><RefreshCw size={16} className={refreshing?'spin':''}/><kbd aria-hidden="true">⌘ R</kbd></button>;
  const noteTarget=noteEditor&&(noteEditor.kind==='project'?projects.find(p=>p.id===noteEditor.id):sessions.find(s=>s.id===noteEditor.id));
  const peeking=collapsed&&peek&&snapshot?.preferences.sidebar.expandOnHover;
  const allFolded=projects.length>0&&projects.every(p=>folded.includes(p.id));
  useChatView(current&&layout?selected??null:null,current?paneIds(layout):[]);
  return <div className={`app-shell ${peeking?'sidebar-peeking':''}`} style={{'--sidebar-width':`${sidebarWidth}px`} as CSSProperties}>
    <div className={`sidebar-dock ${collapsed?'is-collapsed':''} ${peeking?'is-peeking':''}`} onMouseOver={hoverDock} onMouseLeave={()=>schedulePeek(false,350)}>
      {collapsed&&<nav className="sidebar-rail" aria-label="Collapsed sidebar"><div className="traffic-spacer"/><button className="icon-button rail-expand" aria-label="Expand sidebar" onClick={toggleSidebar}><PanelLeftOpen size={19}/></button><button className="rail-new" aria-label="New chat" onClick={()=>newChat()}><Plus size={20}/></button><div className="rail-sessions">{projects.map(p=>{const summary=rollup(liveChats(p.id),s=>chatActivity(s));const key=`p:${p.id}`;return <button key={p.id} className={`rail-session ${projectId===p.id?'active':''}`} title={`${p.name}${summary?` · ${activityLabel[summary.activity as ChatStatus]}: ${summary.item.name}`:''}`} aria-label={`Open project ${p.name}`} onClick={()=>{if(groups.focus&&key!==selectedKey&&groupKeys(tabLayout.segments).includes(key)){openGroup(key);return;}openProject(p.id);}}><Folder size={19} style={{color:projectColor(p.id)}} fill={projectColor(p.id)} fillOpacity={.18}/>{summary&&<span className="rail-badge" aria-hidden="true"><StatusIcon activity={summary.activity as ChatStatus}/></span>}<UnreadDot sessions={sessions.filter(s=>s.projectId===p.id)} rollup/></button>;})}</div><SidebarUpdateButton state={appUpdate} collapsed/><SidebarCost state={usage} onDetails={showUsage} collapsed/><button className="icon-button rail-preferences" aria-label="Preferences" onClick={()=>setDialog('preferences')}><Settings2 size={19}/></button></nav>}
      <aside className="sidebar" inert={collapsed&&!peeking?true:undefined}><div className="traffic-spacer"><button className="icon-button sidebar-toggle" aria-label={collapsed?'Pin sidebar open':'Collapse sidebar'} title="Toggle sidebar (⌘ B)" onClick={toggleSidebar}>{collapsed?<PanelLeftOpen size={18}/>:<PanelLeftClose size={18}/>}</button></div>
        <div className="brand"><div className="brand-icon"><Anchor size={23}/></div><span>harbor<span className="brand-period">.</span></span></div>
        <button className="new-session-button" onClick={()=>newChat()}><Plus size={17}/>New chat<kbd>⌘ N</kbd></button>
        <div className="search-box"><Search size={14}/><input ref={search} aria-label="Search chats" placeholder="Find a chat…" value={query} onChange={e=>setQuery(e.target.value)}/></div>
        <label className="hide-closed-toggle"><span>Hide all closed chats</span><input type="checkbox" role="switch" checked={hideClosed} onChange={event=>{setHideClosed(event.target.checked);setReveal(undefined);}}/><span className="toggle-track" aria-hidden="true"><span/></span></label>
        <label className="hide-closed-toggle"><span>Only show chats with notes</span><input type="checkbox" role="switch" checked={notesOnly} onChange={event=>setNotesOnly(event.target.checked)}/><span className="toggle-track" aria-hidden="true"><span/></span></label>
        <div className="projects-list"><div className="section-label">PROJECTS<span className="section-actions">{projects.length>0&&<button className="icon-button" aria-label={allFolded?'Expand all projects':'Collapse all projects'} title={allFolded?'Expand all projects':'Collapse all projects'} onClick={()=>{autoExpanded.current=undefined;const ids=projects.map(p=>p.id);setFolded(v=>allFolded?v.filter(id=>!ids.includes(id)):[...new Set([...v,...ids])]);}}>{allFolded?<ChevronsUpDown size={15}/>:<ChevronsDownUp size={15}/>}</button>}{hiddenProjects.length>0&&<button className={`icon-button hidden-projects-toggle ${showHidden?'active':''}`} aria-pressed={showHidden} aria-label={`${showHidden?'Hide':'Show'} hidden projects (${hiddenProjects.length})`} title={`${showHidden?'Hide':'Show'} ${hiddenProjects.length} hidden ${hiddenProjects.length===1?'project':'projects'}`} onClick={()=>setShowHidden(v=>!v)}>{showHidden?<Eye size={15}/>:<EyeOff size={15}/>}<span>{hiddenProjects.length}</span></button>}<button className="icon-button" aria-label="Add project" title="Add a project directory" onClick={()=>setDialog('project')}><FolderPlus size={15}/></button></span></div>
          {projects.map(p=>{const chats=sessions.filter(s=>s.projectId===p.id&&!s.archived&&visibleChat(s)&&matches(s)).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.updatedAt.localeCompare(a.updatedAt));if(notesOnly&&!p.note&&!chats.length)return null;return <section className={`project-section ${projectDrag.className(p.id)}`} key={p.id} {...projectDrag.target(p.id)}><div {...projectDrag.source(p.id)} onContextMenu={event=>{event.preventDefault();setContext({kind:'project',id:p.id,x:Math.min(event.clientX,innerWidth-250),y:Math.min(event.clientY,innerHeight-300)});}} data-project-id={p.id} className={`project-heading ${projectId===p.id?'active':''} ${hideClosed&&revealed===p.id?'reveals-closed':''}`}><button className="project-disclosure" aria-label={`${folded.includes(p.id)?'Expand':'Collapse'} project ${p.name}`} onClick={()=>toggleFolded(p.id)}>{folded.includes(p.id)?<ChevronRight size={13}/>:<ChevronDown size={13}/>}</button><button className="project-name" title={`${p.hostLabel}\n${p.cwd}${hideClosed&&revealed===p.id?'\nShowing closed chats · click again to hide them':''}`} onClick={()=>openProject(p.id)}><Folder size={14} className="project-folder" style={{color:projectColor(p.id)}} fill={projectColor(p.id)} fillOpacity={.18}/><span>{p.name}</span></button><ChatNoteMarker item={p} kind="project" onEdit={setNoteEditor}/>{folded.includes(p.id)&&!query&&(()=>{const live=liveChats(p.id);const summary=rollup(live,s=>chatActivity(s));return live.length>0&&<span className="project-rollup" title={`${live.length} live ${live.length===1?'chat':'chats'}${summary?` · ${activityLabel[summary.activity as ChatStatus]}: ${summary.item.name}`:''}`}><span className="project-rollup-count">{live.length}</span>{summary&&<StatusIcon activity={summary.activity as ChatStatus}/>}</span>;})()}<UnreadDot sessions={sessions.filter(s=>s.projectId===p.id&&(folded.includes(p.id)&&!query||!chats.slice(0,query?chats.length:(limits[p.id]??5)).includes(s)))} rollup/>{p.connection!=='local'&&<span className="project-host" title={`${p.hostLabel}: ${reachability[JSON.stringify(p.connection)]===undefined?'Checking reachability':reachability[JSON.stringify(p.connection)]?'Reachable':'Unreachable'}`}><span className={`host-dot ${reachability[JSON.stringify(p.connection)]===undefined?'checking':reachability[JSON.stringify(p.connection)]?'reachable':'unreachable'}`}/>{p.hostLabel}</span>}<button className="icon-button project-add" aria-label={`New chat in ${p.name}`} title="New chat in this project" onClick={()=>newChat(p.id)}><Plus size={15}/></button></div>{(!folded.includes(p.id)||query)&&<div className="project-chats">{chats.slice(0,query?chats.length:(limits[p.id]??5)).map(row)}{!query&&chats.length>(limits[p.id]??5)&&<button className="show-more-chats" onClick={()=>setLimits(v=>({...v,[p.id]:(v[p.id]??5)+5}))}>Show more <span>({chats.length-(limits[p.id]??5)})</span></button>}{!query&&(limits[p.id]??5)>5&&<button className="show-more-chats" onClick={()=>setLimits(v=>({...v,[p.id]:5}))}>Show fewer</button>}{!chats.length&&(notesOnly?<p className="project-empty">No chats with notes</p>:<button className="project-empty" onClick={()=>newChat(p.id)}>Start a conversation</button>)}</div>}</section>;})}
          {!projects.length&&!hiddenProjects.length&&<button className="sidebar-empty text-button" onClick={()=>setDialog('project')}>Add your first project</button>}
          {showHidden&&<div className="hidden-projects" aria-label="Hidden projects" role="group"><div className="hidden-projects-label">HIDDEN</div>{hiddenProjects.map(p=><div key={p.id} data-project-id={p.id} className="project-heading hidden-project" title={`${p.hostLabel}\n${p.cwd}\nHidden · right-click for options`} onContextMenu={event=>{event.preventDefault();setContext({kind:'project',id:p.id,x:Math.min(event.clientX,innerWidth-250),y:Math.min(event.clientY,innerHeight-150)});}}><EyeOff size={13} className="project-folder"/><span className="hidden-project-name">{p.name}</span>{p.connection!=='local'&&<span className="project-host">{p.hostLabel}</span>}<button className="text-button" aria-label={`Show project ${p.name}`} onClick={()=>void setProjectHidden(p.id,false).catch(error=>report(error.message))}>Show</button></div>)}</div>}
        </div>
        <div className="sidebar-footer"><SidebarUpdateButton state={appUpdate}/><SidebarCost state={usage} onDetails={showUsage}/><button className="preferences-button" aria-label="Preferences" onClick={()=>setDialog('preferences')}><Settings2 size={16}/>Preferences<kbd>⌘ ,</kbd></button></div>
      </aside>
      {!collapsed&&<ResizeHandle className="sidebar-resizer" label="Resize sidebar" axis="horizontal" value={sidebarWidth} onDrag={delta=>setSidebarWidth(v=>Math.max(200,Math.min(Math.min(600,innerWidth*.55),v+delta)))} onStep={delta=>setSidebarWidth(v=>Math.max(200,Math.min(600,v+delta*20)))} onReset={()=>setSidebarWidth(272)}/>}
    </div>

    <main className={`workspace ${current?'has-terminal':''}`}>
      {current||showOverview?<><div className="session-toolbar"><TabStrip tabs={tabs} splits={tabSplits} view={paneIds(layout)} sessions={sessions} projects={projects} groups={groups} selected={selected} selection={selection} busy={busy} dragging={dragging} onOpen={open} onClose={session=>void closeChat(session)} onSelection={setSelection} setTabs={setTabs} setGroups={setGroups} onDragStart={beginDrag} onDragEnd={()=>setDragging(undefined)} onToggleGroup={toggleGroup} onNewChat={()=>newChat(current?.projectId)} onTabMenu={(id,x,y)=>setContext({kind:'tab',id,x:Math.min(x,innerWidth-250),y:Math.min(y,innerHeight-420)})} onGroupMenu={(key,x,y)=>setContext({kind:'group',id:key,x:Math.min(x,innerWidth-250),y:Math.min(y,innerHeight-260)})} onMoveProject={moveProject}/><div className="session-actions"><div className="popover-anchor"><button className={`icon-button ${groupsMenu?'active':''}`} aria-label="Tab groups" title="Tab groups" aria-expanded={groupsMenu} onClick={event=>{event.stopPropagation();setGroupsMenu(v=>!v);setMenu(false);setSplitMenu(false);}}><Layers size={16}/></button>{groupsMenu&&<div className="popover groups-menu" role="menu" aria-label="Tab groups" onClick={event=>event.stopPropagation()}>
          <div className="popover-title">TAB GROUPS</div>
          {([['byProject','Group tabs by project','⌘ ⇧ G'],['focus','Focus mode: one group open',''],['shrink','Shrink tabs before scrolling','']] as const).map(([key,label,keys])=><label key={key} className="hide-closed-toggle menu-toggle"><span>{label}{keys&&<kbd>{keys}</kbd>}</span><input type="checkbox" role="switch" checked={groups[key]} onChange={event=>setGroups(v=>({...v,[key]:event.target.checked}))}/><span className="toggle-track" aria-hidden="true"><span/></span></label>)}
          <hr/>
          <button role="menuitem" disabled={!groupKeys(tabLayout.segments).length||(groups.focus&&!selectedKey)} onClick={()=>{foldGroups(groupKeys(tabLayout.segments));setGroupsMenu(false);}}>Collapse all groups</button>
          <button role="menuitem" disabled={groups.focus||!groupKeys(tabLayout.segments).length} onClick={()=>{unfoldGroups(groupKeys(tabLayout.segments));setGroupsMenu(false);}}>Expand all groups</button>
          <button role="menuitem" disabled={!selection.size&&!selected} onClick={()=>{setGroupsMenu(false);makeGroup(selection.size?[...selection]:[selected!]);}}><span>{selection.size>1?`Group ${selection.size} selected tabs`:'Group current tab'}</span><kbd>⌘ G</kbd></button>
        </div>}</div>{current&&<><div className="popover-anchor"><button className="icon-button" aria-label="Split view" title="Split view" onClick={()=>setSplitMenu(v=>!v)}><Columns2 size={16}/></button>{splitMenu&&<div className="popover split-picker">{sessions.filter(s=>s.id!==current.id&&visibleChat(s)).map(s=><button key={s.id} onClick={()=>drop(current.id,s.id,'right')}><AgentIcon launcher={s.launcher}/>{s.name}</button>)}</div>}</div><div className="popover-anchor"><button className="icon-button" aria-label="Chat actions" onClick={()=>setMenu(v=>!v)}><MoreHorizontal size={19}/></button>{menu&&<div className="popover actions-menu" role="menu">{chatMenu(current)}</div>}</div></>}{refreshButton}</div></div><h1 className="sr-only">{current?.name??'Open chats'}</h1>
        {showOverview&&<GroupsOverview segments={tabLayout.segments} groups={groups} sessions={sessions} projects={projects} onOpen={open} onUnfold={key=>unfoldGroups([key])}/>}<div className="pane-workspace" hidden={showOverview}>{layout&&<PaneLayout node={layout} sessions={sessions} selected={selected} dragging={dragging} multiple={paneIds(layout).length>1} onFocus={id=>{setSelected(id);const p=sessions.find(s=>s.id===id)?.projectId;if(p)setProjectId(p);}} onDrop={drop} onResize={(id,ratio)=>setLayout(v=>v?resizePane(v,id,ratio):v)} onRemove={id=>removeFromWorkspace(id,false)} onDragStart={beginDrag} onDragEnd={()=>setDragging(undefined)} render={session=><div className="chat-slot" data-chat-slot={session.id}/>}/>}</div>
      </>:<><div className="overview-toolbar">{refreshButton}</div><div className="project-overview"><div className="project-overview-heading"><div className="eyebrow">{project?'PROJECT':'YOUR WORK, IN ONE PLACE'}</div><h1>{project?.name||'A home for your projects.'}</h1><p>{project?`${project.hostLabel} · ${project.cwd}`:'Add a directory to see its past conversations and start something new.'}</p></div>{project?<><div className="project-overview-actions"><button className="primary-button" onClick={()=>newChat(project.id)}><Plus size={16}/>New chat</button><button className="secondary-button" disabled={busy===project.id} onClick={()=>void refreshHistory(project.id)}><RefreshCw size={14} className={busy===project.id?'spin':''}/>Refresh past chats</button><button className="icon-button" aria-label="Rename project" onClick={()=>setRename({kind:'project',id:project.id,name:project.name})}><Settings2 size={16}/></button></div>{project.historyError&&<p className="form-error">Some history could not be loaded: {project.historyError}</p>}<ProjectNotes project={project} sessions={sessions} onOpen={open} onError={report}/><div className="project-conversations">{sessions.filter(s=>s.projectId===project.id&&!s.archived&&visibleChat(s,project.id)).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.updatedAt.localeCompare(a.updatedAt)).map(row)}</div></>:<button className="primary-button" onClick={()=>setDialog('project')}><FolderPlus size={17}/>Add project</button>}</div></>}
      {tabs.map(id=>sessions.find(s=>s.id===id)).filter((session):session is Session=>!!session).map(session=><PersistentChat key={session.id} id={session.id} onFocus={()=>{setSelected(session.id);if(session.projectId)setProjectId(session.projectId);}} placement={current?layout:null}><ChatUsageBar session={session} active={!!current&&paneIds(layout).includes(session.id)} version={refreshVersion}/>{session.status==='closed'?<div className="closed-chat-panel"><AgentIcon launcher={session.launcher} size={30}/><h2>{session.name}</h2><p>{session.externalActive?'This conversation is running outside Harbor. Close it there and refresh this project to resume here.':session.launcher==='shell'?'This terminal is closed. Reopening starts a new shell in the project directory.':'This chat is closed. Resume to continue its saved conversation in a new terminal.'}</p><button className="primary-button" disabled={busy===session.id||session.externalActive} onClick={()=>void resumeChat(session)}>{busy===session.id?<LoaderCircle className="spin" size={16}/>:<RefreshCw size={16}/>} {session.launcher==='shell'?'Reopen terminal':'Resume chat'}</button><ChatPreviewPanel session={session} version={refreshVersion}/>{session.imported&&<small>Imported from {launcherName[session.launcher]} history</small>}</div>:<TerminalPane active={selected===session.id} session={session} preferences={snapshot!.preferences.terminal} onReconnect={()=>void resumeChat(session,true)} report={report}/>}</PersistentChat>)}
    </main>
    {context?.kind==='project'&&projects.find(p=>p.id===context.id)&&<div className="popover chat-context-menu" role="menu" aria-label="Project actions" style={{left:context.x,top:context.y}} onClick={event=>event.stopPropagation()}><div className="popover-title">COLOR</div>{colorSwatches('Project color',projectColor(context.id),value=>{const id=context.id;setGroups(v=>({...v,projectColors:{...v.projectColors,[id]:value}}));})}<hr/>{groupKeys(tabLayout.segments).includes(`p:${context.id}`)&&<><button role="menuitem" onClick={()=>{const key=`p:${context.id}`;setContext(undefined);openGroup(key);}}><Layers size={14}/>Show tabs</button>{!groups.focus&&<button role="menuitem" onClick={()=>{const key=`p:${context.id}`;setContext(undefined);foldGroups([key]);}}>Fold in tab bar</button>}<hr/></>}<button role="menuitem" onClick={()=>{const id=context.id;setContext(undefined);void window.harbor.openProjectInCursor(id).catch(error=>report(error.message));}}><ExternalLink size={14}/>Open in Cursor</button><button role="menuitem" onClick={()=>{const p=projects.find(p=>p.id===context.id)!;setRename({kind:'project',id:p.id,name:p.name});setContext(undefined);}}>Rename project…</button><button role="menuitem" onClick={()=>{setNoteEditor({kind:'project',id:context.id,x:context.x,y:context.y});setContext(undefined);}}><StickyNote size={14}/>{projects.find(p=>p.id===context.id)?.note?'Edit note…':'Add note…'}</button><hr/><button role="menuitem" onClick={()=>{const id=context.id;setContext(undefined);void setProjectHidden(id,true).catch(error=>report(error.message));}}><EyeOff size={14}/>Hide project</button><button role="menuitem" className="danger" onClick={()=>{setDeleting(context.id);setDialog('delete-project');setContext(undefined);}}><Trash2 size={14}/>Delete project…</button></div>}
    {context?.kind==='project'&&hiddenProjects.find(p=>p.id===context.id)&&<div className="popover chat-context-menu" role="menu" aria-label="Hidden project actions" style={{left:context.x,top:context.y}} onClick={event=>event.stopPropagation()}><button role="menuitem" onClick={()=>{const id=context.id;setContext(undefined);void setProjectHidden(id,false).catch(error=>report(error.message));}}><Eye size={14}/>Show project</button><button role="menuitem" className="danger" onClick={()=>{setDeleting(context.id);setDialog('delete-project');setContext(undefined);}}><Trash2 size={14}/>Delete project…</button></div>}
    {context?.kind==='tab'&&sessions.find(s=>s.id===context.id)&&(()=>{const id=context.id;const ids=selection.size?[...new Set([...selection,id])]:[id];const key=tabLayout.keyOf.get(id);return <div className="popover chat-context-menu" role="menu" aria-label="Tab actions" style={{left:context.x,top:context.y}} onClick={e=>e.stopPropagation()}>
      <button role="menuitem" onClick={()=>makeGroup(ids)}><Layers size={14}/><span>{ids.length>1?`New group with ${ids.length} tabs`:'New group with this tab'}</span><kbd>⌘ G</kbd></button>
      {groups.custom.filter(g=>!ids.every(i=>g.members.includes(i))).map(g=><button role="menuitem" key={g.id} onClick={()=>{setGroups(v=>addToGroup(v,g.id,ids));setSelection(new Set());setContext(undefined);}}><span className="menu-swatch" style={{background:g.color}}/>Add to “{g.name}”</button>)}
      {key?.startsWith('g:')&&<button role="menuitem" onClick={()=>{setGroups(v=>removeFromGroups(v,[id]));setContext(undefined);}}>Remove from group</button>}
      <hr/>{chatMenu(sessions.find(s=>s.id===id)!)}</div>;})()}
    {context?.kind==='group'&&(()=>{const key=context.id;const info=groupInfo(key,groups,projects);const custom=groups.custom.find(g=>`g:${g.id}`===key);if(!custom&&!key.startsWith('p:'))return null;const folded=isCollapsed(groups,key,selectedKey);return <div className="popover chat-context-menu group-menu" role="menu" aria-label={`${info.name} group`} style={{left:context.x,top:context.y}} onClick={e=>e.stopPropagation()}>
      <div className="popover-title">{custom?'CUSTOM GROUP':`PROJECT${info.detail?` · ${info.detail}`:''}`}</div>
      {custom&&<input className="group-rename" aria-label="Group name" defaultValue={custom.name} maxLength={60} autoFocus={context.rename} onFocus={event=>event.currentTarget.select()} onKeyDown={event=>{if(event.key==='Enter'){setGroups(v=>updateGroup(v,custom.id,{name:event.currentTarget.value}));setContext(undefined);}}} onBlur={event=>{const name=event.currentTarget.value;setGroups(v=>updateGroup(v,custom.id,{name}));}}/>}
      {colorSwatches('Group color',info.color,value=>setGroups(v=>custom?updateGroup(v,custom.id,{color:value}):{...v,projectColors:{...v.projectColors,[key.slice(2)]:value}}))}
      {groups.focus&&key===selectedKey&&<><hr/><button role="menuitem" onClick={()=>{foldGroups([key]);setContext(undefined);}}>Collapse group</button></>}
      {!groups.focus&&<><hr/><button role="menuitem" onClick={()=>{toggleGroup(key);setContext(undefined);}}>{folded?'Expand group':'Collapse group'}</button>
      <button role="menuitem" onClick={()=>{foldGroups(groupKeys(tabLayout.segments).filter(k=>k!==key));setContext(undefined);}}>Collapse other groups</button></>}
      {custom&&<><hr/><button role="menuitem" onClick={()=>{setGroups(v=>ungroup(v,custom.id));setContext(undefined);}}>Ungroup</button></>}
    </div>;})()}
    {context&&!context.kind&&sessions.find(s=>s.id===context.id)&&<div className="popover chat-context-menu" role="menu" style={{left:context.x,top:context.y}} onClick={e=>e.stopPropagation()}>{chatMenu(sessions.find(s=>s.id===context.id)!)}</div>}
    {toast&&<div className="toast" role="alert">{toast}<button aria-label="Dismiss message" onClick={()=>setToast('')}><X size={15}/></button></div>}
    {dialog==='preferences'&&snapshot&&<PreferencesDialog initial={snapshot.preferences} projects={snapshot.projects} initialTab={preferencesTab} usage={usage} onClose={()=>{setDialog(null);setPreferencesTab('hosts');}}/>}
    {dialog==='project'&&snapshot&&<ProjectDialog snapshot={snapshot} onPreferences={()=>setDialog('preferences')} onClose={()=>setDialog(null)} onCreated={p=>{setProjectId(p.id);setSelected(undefined);setProjectPage(true);setDialog(null);loadedHistory.current.add(p.id);}}/>}
    {dialog==='chat'&&project&&<ChatDialog project={project} defaults={snapshot!.preferences.agents} shortcut={chatShortcut} onClose={()=>setDialog(null)} onCreated={s=>{setFreshChats(v=>new Set(v).add(s.id));setDialog(null);const key=selected?tabLayout.keyOf.get(selected):undefined;if(key?.startsWith('g:')&&sessions.find(v=>v.id===selected)?.projectId===s.projectId)setGroups(v=>addToGroup(v,key.slice(2),[s.id]));open(s);}}/>}
    {dialog==='delete-project'&&(()=>{const target=snapshot?.projects.find(p=>p.id===deleting);if(!target)return null;const close=()=>{setDialog(null);setDeleting(undefined);};return <DeleteProjectDialog project={target} running={sessions.filter(s=>s.projectId===target.id&&!s.archived&&s.status!=='closed')} onClose={close} onHide={async()=>{await setProjectHidden(target.id,true);close();}} onDelete={async()=>{await deleteProject(target.id);close();setToast(`Deleted project “${target.name}”. Its files and saved conversations were kept.`);}}/>;})()}
    {commandSession&&<LaunchCommandDialog session={commandSession} onClose={()=>setCommandSession(undefined)}/>}
    {noteEditor&&noteTarget&&<ChatNoteEditor key={noteEditor.kind+noteEditor.id} item={noteTarget} anchor={noteEditor} onClose={()=>setNoteEditor(undefined)}/>}
    {rename&&<RenameDialog initial={rename.name} kind={rename.kind} onClose={()=>setRename(undefined)} onSave={async name=>{if(rename.kind==='chat')await window.harbor.update(rename.id,{name});else await window.harbor.updateProject(rename.id,{name});setRename(undefined);}}/>}
  </div>;
}
